import { expect, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  MessageEndEvent,
  ToolDefinition,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { createLspExtension } from "../index";
import type { LspServerManager } from "../server-manager";
import type { ResolvedLspSettings } from "../settings";

type Handler = (event: never, context: ExtensionContext) => Promise<unknown> | unknown;

interface SentMessage {
  readonly content: string;
  readonly customType: string;
  readonly display: boolean;
}

function mutationResult(toolCallId: string, path = "example.ts"): ToolResultEvent {
  return {
    type: "tool_result",
    toolCallId,
    toolName: "write",
    input: { path, content: "updated" },
    content: [{ type: "text", text: "write complete" }],
    details: undefined,
    isError: false,
  } as ToolResultEvent;
}

function mutationMessage(toolCallId: string): MessageEndEvent {
  return {
    type: "message_end",
    message: {
      role: "toolResult",
      toolCallId,
      toolName: "write",
      content: [{ type: "text", text: "formatter complete" }],
      isError: false,
      timestamp: Date.now(),
    },
  } as MessageEndEvent;
}

function turnEnd(...toolCallIds: string[]) {
  return {
    toolResults: toolCallIds.map((toolCallId) => mutationMessage(toolCallId).message),
  };
}

test("registers the tool immediately and creates one manager on first use", async () => {
  const handlers = new Map<string, Handler>();
  let managerCreations = 0;
  let tool: ToolDefinition | undefined;
  const fakeManager = {
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
    registerTool(definition: ToolDefinition) {
      tool = definition;
    },
  } as unknown as ExtensionAPI;
  const context = {
    cwd: "/project",
    isProjectTrusted: () => true,
    signal: undefined,
    ui: { notify() {} },
  } as unknown as ExtensionContext;

  createLspExtension({
    createManager: async () => {
      managerCreations += 1;
      return fakeManager;
    },
    readSettings: () => settings,
  })(pi);

  if (tool === undefined) throw new Error("lsp tool was not registered");
  expect(managerCreations).toBe(0);
  await handlers.get("session_start")?.({} as never, context);
  expect(managerCreations).toBe(0);

  const first = await tool.execute("lsp-1", { operation: "status" }, undefined, undefined, context);
  const second = await tool.execute(
    "lsp-2",
    { operation: "status" },
    undefined,
    undefined,
    context,
  );

  expect(first.content).toEqual([{ type: "text", text: "ready" }]);
  expect(second.content).toEqual([{ type: "text", text: "ready" }]);
  expect(managerCreations).toBe(1);
});

test("loads the default manager when the tool is first used", async () => {
  let tool: ToolDefinition | undefined;
  const settings: ResolvedLspSettings = {
    servers: [],
    timeouts: { diagnosticsMs: 100, requestMs: 100, shutdownMs: 100, startupMs: 100 },
    warnings: [],
  };
  const pi = {
    on() {},
    registerTool(definition: ToolDefinition) {
      tool = definition;
    },
  } as unknown as ExtensionAPI;
  const context = {
    cwd: process.cwd(),
    isProjectTrusted: () => true,
  } as ExtensionContext;

  createLspExtension({ readSettings: () => settings })(pi);

  if (tool === undefined) throw new Error("lsp tool was not registered");
  const result = await tool.execute(
    "lsp-1",
    { operation: "status" },
    undefined,
    undefined,
    context,
  );

  expect(result.content).toEqual([{ type: "text", text: "No LSP servers configured" }]);
});

test("starts diagnostics after formatting and only reports non-clean results", async () => {
  const handlers = new Map<string, Handler>();
  const deliveryModes: Array<string | undefined> = [];
  const sentMessages: SentMessage[] = [];
  let formatted = false;
  let diagnosticsObservedFormatting = false;
  let diagnosticCount = 0;
  let diagnosticCalls = 0;
  const fakeManager = {
    diagnostics: async () => {
      diagnosticCalls += 1;
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
    sendMessage(message: SentMessage, options?: { deliverAs?: string }) {
      sentMessages.push(message);
      deliveryModes.push(options?.deliverAs);
    },
  } as unknown as ExtensionAPI;
  const context = {
    cwd: "/project",
    isProjectTrusted: () => true,
    signal: undefined,
    ui: { notify() {} },
  } as unknown as ExtensionContext;
  createLspExtension({ createManager: async () => fakeManager, readSettings: () => settings })(pi);
  await handlers.get("session_start")?.({} as never, context);

  await handlers.get("tool_result")?.(mutationResult("call-1") as never, context);
  formatted = true;
  expect(
    await handlers.get("message_end")?.(mutationMessage("call-1") as never, context),
  ).toBeUndefined();
  expect(diagnosticCalls).toBe(1);
  expect(diagnosticsObservedFormatting).toBeTrue();
  await handlers.get("turn_end")?.(turnEnd("call-1") as never, context);
  expect(sentMessages).toEqual([]);

  diagnosticCount = 1;
  await handlers.get("tool_result")?.(mutationResult("call-2") as never, context);
  await handlers.get("message_end")?.(mutationMessage("call-2") as never, context);
  expect(diagnosticCalls).toBe(2);
  await handlers.get("turn_end")?.(turnEnd("call-2") as never, context);

  expect(sentMessages).toEqual([
    {
      content: "Automatic LSP diagnostics after edits:\nexample.ts:1:1-1:2 [error] broken (fake)",
      customType: "lsp-diagnostics",
      display: true,
    },
  ]);
  expect(deliveryModes).toEqual(["steer"]);
});

test("reports only the latest immediate diagnostic result per file and turn", async () => {
  const handlers = new Map<string, Handler>();
  const diagnosticCalls: string[] = [];
  const sentMessages: SentMessage[] = [];
  let promptGuidelines: readonly string[] = [];
  const fakeManager = {
    diagnostics: async (path: string) => {
      diagnosticCalls.push(path);
      return {
        diagnosticCount: 1,
        matched: true,
        text: `${path} diagnostic ${diagnosticCalls.length}`,
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
    sendMessage(message: SentMessage) {
      sentMessages.push(message);
    },
  } as unknown as ExtensionAPI;
  const context = {
    cwd: "/project",
    isProjectTrusted: () => true,
    signal: undefined,
    ui: { notify() {} },
  } as unknown as ExtensionContext;
  createLspExtension({ createManager: async () => fakeManager, readSettings: () => settings })(pi);
  await handlers.get("session_start")?.({} as never, context);

  for (const [toolCallId, path] of [
    ["call-1", "example.ts"],
    ["call-2", "example.ts"],
    ["call-3", "other.ts"],
  ] as const) {
    await handlers.get("tool_result")?.(mutationResult(toolCallId, path) as never, context);
    await handlers.get("message_end")?.(mutationMessage(toolCallId) as never, context);
  }

  expect(diagnosticCalls).toEqual(["example.ts", "example.ts", "other.ts"]);
  expect(sentMessages).toEqual([]);
  await handlers.get("turn_end")?.(turnEnd("call-1", "call-2", "call-3") as never, context);

  expect(sentMessages).toEqual([
    {
      content:
        "Automatic LSP diagnostics after edits:\nexample.ts diagnostic 2\n\nother.ts diagnostic 3",
      customType: "lsp-diagnostics",
      display: true,
    },
  ]);
  expect(promptGuidelines.some((guideline) => guideline.includes("diagnostic"))).toBeFalse();
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
