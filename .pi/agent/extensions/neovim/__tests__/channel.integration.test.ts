import { afterEach, expect, test } from "bun:test";
import { once } from "node:events";
import { existsSync, statSync } from "node:fs";
import { createConnection } from "node:net";
import { createInterface } from "node:readline";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { PiAskChannel } from "../channel";
import { initializeNeovim } from "../extension";
import { startBroker } from "./fixtures/broker";

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
  test(`PiAsk crosses the real Neovim broker and acknowledges ${state}`, async () => {
    const broker = await startBroker(false, state === "idle");
    cleanups.push(broker.close);
    expect(statSync(broker.socket).mode & 0o777).toBe(0o600);
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
    initializeNeovim(pi, { socketPath: broker.socket, launchId: broker.launchId });
    const context = {
      cwd: broker.cwd,
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
    expect(await broker.exited).toBe(0);
    const acknowledgement = broker.messages.at(-1);
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
    expect(existsSync(broker.socket)).toBe(false);
  });
}

test("broker rejects malformed frames, wrong identities and host-execution requests", async () => {
  const broker = await startBroker(true);
  cleanups.push(broker.close);
  const bind = {
    type: "bind",
    version: 1,
    launchId: broker.launchId,
    sessionId: "fixture-session",
    cwd: broker.cwd,
  };
  for (const frame of [
    "not-json\n",
    `${"x".repeat(64 * 1024 + 1)}\n`,
    `${JSON.stringify({ ...bind, launchId: "0".repeat(32) })}\n`,
    `${JSON.stringify({ ...bind, cwd: "/" })}\n`,
    `${JSON.stringify({ ...bind, replacePending: true })}\n`,
    `${JSON.stringify({ ...bind, code: "vim.cmd('!touch unsafe')" })}\n`,
    `${JSON.stringify({ type: "exec", code: "vim.cmd('!touch unsafe')" })}\n`,
  ]) {
    const socket = createConnection(broker.socket);
    socket.on("error", () => {});
    await once(socket, "connect");
    const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
    socket.write(frame);
    await closed;
  }
  // An established session still cannot request generic RPC or provide a forged acknowledgement.
  for (const message of [
    { type: "rpc", method: "nvim_exec_lua", args: ["vim.cmd('!touch unsafe')"] },
    { type: "ack", payload: { outcome: "accepted" } },
  ]) {
    const socket = createConnection(broker.socket);
    socket.on("error", () => {});
    const output = createInterface({ input: socket });
    const bound = once(output, "line");
    socket.write(`${JSON.stringify(bind)}\n`);
    expect(JSON.parse(String((await bound)[0]))).toMatchObject({ type: "bound" });
    const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
    socket.write(`${JSON.stringify(message)}\n`);
    await closed;
    output.close();
  }
  expect(existsSync(`${broker.cwd}/unsafe`)).toBe(false);
});

test("replacement binding waits for the host to observe the old channel disconnect", async () => {
  const broker = await startBroker(true);
  cleanups.push(broker.close);
  const handlers = {
    dispatch: () => {
      throw new Error("unexpected prompt");
    },
    reject: () => {
      throw new Error("unexpected prompt");
    },
    disconnect: () => {},
  };
  const first = new PiAskChannel(broker.socket, broker.cwd, broker.launchId, handlers);
  const next = new PiAskChannel(broker.socket, broker.cwd, broker.launchId, handlers);
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
