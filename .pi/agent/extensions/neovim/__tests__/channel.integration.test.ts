import { afterEach, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { PiAskChannel } from "../channel";
import { initializeNeovim } from "../extension";
import { startEditor } from "./fixtures/editor";

type Handler = (event: { previousSessionFile?: string }, context: ExtensionContext) => unknown;
function getHandler(handlers: Map<string, Handler>, name: string): Handler {
  const handler = handlers.get(name);
  if (handler === undefined) throw new Error(`Missing handler: ${name}`);
  return handler;
}
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

for (const state of ["idle", "streaming", "blocked"] as const) {
  test(`PiAsk crosses the real Neovim editor and acknowledges ${state}`, async () => {
    const editor = await startEditor(false, state === "idle");
    cleanups.push(editor.close);
    const handlers = new Map<string, Handler>();
    const sent: { text: string; options: unknown }[] = [];
    const pi = {
      on: (name: string, handler: Handler) => {
        handlers.set(name, handler);
      },
      sendUserMessage: (text: string, options: unknown) => {
        sent.push({ text, options });
      },
    } as unknown as ExtensionAPI;
    initializeNeovim(pi, { socketPath: editor.socket, launchId: editor.launchId });
    const context = {
      cwd: editor.cwd,
      mode: "tui",
      hasUI: true,
      isIdle: () => state !== "streaming",
      signal: state === "streaming" ? new AbortController().signal : undefined,
      sessionManager: { getSessionId: () => "fixture-session" },
      ui: { getEditorText: () => "", notify: () => {} },
    } as unknown as ExtensionContext;
    // Block before binding: a queued host prompt must not bypass an active confirmation dialog.
    const start = getHandler(handlers, "session_start")({}, context);
    if (state === "blocked") getHandler(handlers, "ui_prompt_start")({}, context);
    await start;
    expect(await editor.exited).toBe(0);
    const acknowledgement = editor.messages.at(-1);
    expect(acknowledgement).toMatchObject({
      acknowledged: {
        outcome: state === "blocked" ? "rejected" : "accepted",
        ...(state === "blocked" ? { code: "PI_BUSY" } : {}),
      },
    });
    if (state !== "blocked") {
      expect(sent).toHaveLength(1);
      expect(sent[0]?.text).toContain("example.lua:1:1: explain æøå");
      expect(sent[0]?.text).toContain('"lines":["første æøå"]');
      expect(sent[0]?.options).toEqual({
        expandPromptTemplates: false,
        ...(state === "streaming" ? { deliverAs: "steer" } : {}),
      });
    }
    getHandler(handlers, "session_shutdown")({}, context);
  });
}

test("replacement binding waits for the host to observe the old channel disconnect", async () => {
  const editor = await startEditor(true);
  cleanups.push(editor.close);
  const handlers = {
    dispatch: () => {
      throw new Error("unexpected prompt");
    },
    reject: () => {
      throw new Error("unexpected prompt");
    },
    disconnect: () => {},
  };
  const first = new PiAskChannel(editor.socket, editor.cwd, editor.launchId, handlers);
  const next = new PiAskChannel(editor.socket, editor.cwd, editor.launchId, handlers);
  try {
    await first.open("original-session");
    const replacing = next.open("replacement-session");
    first.close();
    expect((await replacing).sessionId).toBe("replacement-session");
  } finally {
    first.close();
    next.close();
  }
});
