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

test("only appends post-format LSP output when diagnostics are present", async () => {
  const handlers = new Map<string, Handler>();
  let formatted = false;
  let diagnosticsObservedFormatting = false;
  let diagnosticCount = 0;
  const fakeManager = {
    diagnostics: async () => {
      diagnosticsObservedFormatting = formatted;
      return {
        diagnosticCount,
        matched: true,
        text:
          diagnosticCount === 0
            ? "LSP diagnostics: none"
            : "example.ts:1:1-1:2 [error] broken (fake)",
        warnings: [],
      };
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
    diagnosticsDebounceMs: 0,
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
  const cleanResult = await handlers.get("message_end")?.(messageEnd as never, context);

  expect(diagnosticsObservedFormatting).toBeTrue();
  expect(cleanResult).toBeUndefined();

  diagnosticCount = 1;
  const diagnosticToolResult = { ...toolResult, toolCallId: "call-2" };
  await handlers.get("tool_result")?.(diagnosticToolResult as never, context);
  const diagnosticResult = (await handlers.get("message_end")?.(
    {
      ...messageEnd,
      message: { ...messageEnd.message, toolCallId: "call-2" },
    } as never,
    context,
  )) as { message: { content: Array<{ text: string }> } };

  expect(diagnosticResult.message.content.map(({ text }) => text)).toEqual([
    "formatter complete",
    "LSP diagnostics after formatting:\nexample.ts:1:1-1:2 [error] broken (fake)",
  ]);
});

test("coalesces automatic diagnostics for rapid edits to the same file", async () => {
  const handlers = new Map<string, Handler>();
  let diagnosticCalls = 0;
  let promptGuidelines: readonly string[] = [];
  const fakeManager = {
    diagnostics: async () => {
      diagnosticCalls += 1;
      return {
        diagnosticCount: 1,
        matched: true,
        text: "example.ts:1:1-1:2 [error] broken (fake)",
        warnings: [],
      };
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
    registerTool(definition: { promptGuidelines?: readonly string[] }) {
      promptGuidelines = definition.promptGuidelines ?? [];
    },
  } as unknown as ExtensionAPI;
  const context = {
    cwd: "/project",
    isProjectTrusted: () => true,
    signal: undefined,
    ui: { notify() {} },
  } as unknown as ExtensionContext;
  createLspExtension({
    createManager: async () => fakeManager,
    diagnosticsDebounceMs: 10,
    readSettings: () => settings,
  })(pi);
  await handlers.get("session_start")?.({} as never, context);

  const toolResult = (toolCallId: string, path = "example.ts") =>
    ({
      type: "tool_result",
      toolCallId,
      toolName: "write",
      input: { path, content: "updated" },
      content: [{ type: "text", text: "write complete" }],
      details: undefined,
      isError: false,
    }) as ToolResultEvent;
  const messageEnd = (toolCallId: string) =>
    ({
      type: "message_end",
      message: {
        role: "toolResult",
        toolCallId,
        toolName: "write",
        content: [{ type: "text", text: "write complete" }],
        isError: false,
        timestamp: Date.now(),
      },
    }) as MessageEndEvent;

  await handlers.get("tool_result")?.(toolResult("call-1") as never, context);
  await handlers.get("tool_result")?.(toolResult("call-2") as never, context);
  const [first, second] = await Promise.all([
    handlers.get("message_end")?.(messageEnd("call-1") as never, context),
    handlers.get("message_end")?.(messageEnd("call-2") as never, context),
  ]);

  expect(first).toBeUndefined();
  expect(
    (second as { message: { content: Array<{ type: string; text: string }> } }).message.content,
  ).toEqual([
    { type: "text", text: "write complete" },
    {
      type: "text",
      text: "LSP diagnostics after formatting:\nexample.ts:1:1-1:2 [error] broken (fake)",
    },
  ]);

  await handlers.get("tool_result")?.(toolResult("call-3", "other.ts") as never, context);
  const otherFile = await handlers.get("message_end")?.(messageEnd("call-3") as never, context);

  expect(otherFile).toBeDefined();
  expect(diagnosticCalls).toBe(2);
  expect(promptGuidelines).toContain(
    "For diagnostics, wait until a file's edit burst is complete and query each changed file once; do not query after every individual edit.",
  );
});

test("warms LSP diagnostics once after a successful native file read", async () => {
  const handlers = new Map<string, Handler>();
  const warmedPaths: string[] = [];
  const fakeManager = {
    warm: async (path: string) => {
      warmedPaths.push(path);
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
  createLspExtension({ createManager: async () => fakeManager, readSettings: () => settings })(pi);
  await handlers.get("session_start")?.({} as never, context);

  const readResult = {
    type: "tool_result",
    toolCallId: "read-1",
    toolName: "read",
    input: { path: "src/example.ts" },
    content: [{ type: "text", text: "source" }],
    details: undefined,
    isError: false,
  } as ToolResultEvent;
  expect(await handlers.get("tool_result")?.(readResult as never, context)).toBeUndefined();
  await handlers.get("tool_result")?.({ ...readResult, toolCallId: "read-2" } as never, context);

  expect(warmedPaths).toEqual(["src/example.ts"]);
});
