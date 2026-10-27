import { expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { initializeNeovim } from "../extension";

type Handler = (event: object, context: ExtensionContext) => unknown;
function getHandler(handlers: Map<string, Handler>, name: string): Handler {
  const handler = handlers.get(name);
  if (handler === undefined) throw new Error(`Missing handler: ${name}`);
  return handler;
}
function fixture() {
  const handlers = new Map<string, Handler>();
  const notices: string[] = [];
  initializeNeovim(
    {
      on: (name: string, handler: Handler) => {
        handlers.set(name, handler);
      },
    } as unknown as ExtensionAPI,
    { launchId: "0123456789abcdef0123456789abcdef", socketPath: "/missing/pi-ask-broker.sock" },
  );
  const context = {
    mode: "tui",
    cwd: process.cwd(),
    sessionManager: { getSessionId: () => "fixture-session" },
    ui: {
      notify: (text: string) => {
        notices.push(text);
      },
    },
  } as unknown as ExtensionContext;
  return { handlers, notices, context };
}

test("PiAsk reports a disconnected broker without preventing standalone Pi use", async () => {
  const { handlers, notices, context } = fixture();
  await getHandler(handlers, "session_start")({}, context);
  expect(notices).toHaveLength(1);
  expect(notices[0]).toContain("Pi Ask could not connect");
  getHandler(handlers, "session_shutdown")({}, context);
});

test("non-TUI sessions do not attach to the editor broker", async () => {
  const { handlers, notices, context } = fixture();
  await getHandler(handlers, "session_start")({}, { ...context, mode: "rpc" });
  expect(notices).toEqual([]);
});
