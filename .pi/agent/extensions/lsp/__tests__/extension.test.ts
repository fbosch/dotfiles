import { expect, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  MessageEndEvent,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { createLspExtension } from "../index";
import type { LspServerManager } from "../server-manager";
import type { ResolvedLspSettings } from "../settings";

type Handler = (event: never, context: ExtensionContext) => Promise<unknown> | unknown;

test("appends diagnostics from the finalized post-format tool result", async () => {
  const handlers = new Map<string, Handler>();
  let formatted = false;
  let diagnosticsObservedFormatting = false;
  const fakeManager = {
    diagnostics: async () => {
      diagnosticsObservedFormatting = formatted;
      return { matched: true, text: "LSP diagnostics: none", warnings: [] };
    },
    shutdown: async () => {},
    status: () => "ready",
  } as unknown as LspServerManager;
  const settings: ResolvedLspSettings = {
    servers: [],
    timeouts: { diagnosticsMs: 100, requestMs: 100, shutdownMs: 100, startupMs: 100 },
    warnings: [],
  };
  const pi = {
    on(event: string, handler: Handler) {
      handlers.set(event, handler);
    },
    registerTool() {},
  } as unknown as ExtensionAPI;
  const context = {
    cwd: "/project",
    isProjectTrusted: () => true,
    signal: undefined,
    ui: { notify() {} },
  } as unknown as ExtensionContext;
  createLspExtension({
    createManager: async () => fakeManager,
    readSettings: () => settings,
  })(pi);
  await handlers.get("session_start")?.({} as never, context);

  const toolResult = {
    type: "tool_result",
    toolCallId: "call-1",
    toolName: "write",
    input: { path: "example.ts", content: "formatted" },
    content: [{ type: "text", text: "write complete" }],
    details: undefined,
    isError: false,
  } as ToolResultEvent;
  await handlers.get("tool_result")?.(toolResult as never, context);
  formatted = true;

  const messageEnd = {
    type: "message_end",
    message: {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "write",
      content: [{ type: "text", text: "formatter complete" }],
      isError: false,
      timestamp: Date.now(),
    },
  } as MessageEndEvent;
  const result = (await handlers.get("message_end")?.(messageEnd as never, context)) as {
    message: { content: Array<{ text: string }> };
  };

  expect(diagnosticsObservedFormatting).toBeTrue();
  expect(result.message.content.map(({ text }) => text)).toEqual([
    "formatter complete",
    "LSP diagnostics after formatting:\nLSP diagnostics: none",
  ]);
});
