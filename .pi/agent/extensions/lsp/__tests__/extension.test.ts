import { expect, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  MessageEndEvent,
  ToolDefinition,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { createLspExtension } from "../index";
import type { DiagnosticVerdict, LspServerManager } from "../server-manager";
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
    registerMessageRenderer() {},
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
  expect(tool.description).toContain("project files read from disk");
  expect(tool.description).toContain("does not inspect Neovim or its unsaved in-memory buffers");
  expect(tool.description).toContain("do not query both diagnostic sources by default");
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
    registerMessageRenderer() {},
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

test("returns unavailable diagnostics as an honest tool result", async () => {
  let tool: ToolDefinition | undefined;
  const fakeManager = {
    diagnostics: async () => ({
      diagnosticCount: 0,
      diagnosticEvidence: [],
      diagnosticVerdict: "unavailable" as const,
      matched: false,
      text: "LSP diagnostics: none",
      unconfirmedServers: [],
      warnings: ["fake: spawn failed"],
    }),
    shutdown: async () => {},
    status: () => "ready",
  } as unknown as LspServerManager;
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
    registerMessageRenderer() {},
  } as unknown as ExtensionAPI;
  const context = {
    cwd: "/project",
    isProjectTrusted: () => true,
  } as ExtensionContext;

  createLspExtension({ createManager: async () => fakeManager, readSettings: () => settings })(pi);

  if (tool === undefined) throw new Error("lsp tool was not registered");
  const result = await tool.execute(
    "lsp-1",
    { operation: "diagnostics", path: "example.ts" },
    undefined,
    undefined,
    context,
  );

  expect(result.content).toEqual([
    {
      type: "text",
      text: "LSP diagnostics: unavailable. No matching server completed a diagnostic check.\nLSP-native evidence: none.\nfake: spawn failed",
    },
  ]);
  expect(result.details).toEqual({
    diagnosticEvidence: [],
    diagnosticVerdict: "unavailable",
    operation: "diagnostics",
    unconfirmedServers: [],
    warnings: ["fake: spawn failed"],
  });
});

test.each(["clean", "unconfirmed", "partial", "unavailable"] as const)(
  "includes the %s verdict and evidence in model-visible content",
  async (verdict) => {
    let tool: ToolDefinition | undefined;
    const unconfirmedServers = verdict === "unconfirmed" ? ["fake"] : [];
    const diagnosticEvidence =
      verdict === "unavailable"
        ? []
        : verdict === "unconfirmed"
          ? [{ kind: "push-publication" as const, serverId: "fake" }]
          : [{ kind: "pull-report" as const, reportKind: "full" as const, serverId: "fake" }];
    const fakeManager = {
      diagnostics: async () => ({
        diagnosticCount: 0,
        diagnosticEvidence,
        diagnosticVerdict: verdict,
        matched: verdict !== "unavailable",
        text: "LSP diagnostics: none",
        unconfirmedServers,
        warnings: verdict === "partial" ? ["other: server failed"] : [],
      }),
    } as unknown as LspServerManager;
    createLspExtension({
      createManager: async () => fakeManager,
      readSettings: () => ({
        servers: [],
        timeouts: { diagnosticsMs: 100, requestMs: 100, shutdownMs: 100, startupMs: 100 },
        warnings: [],
      }),
    })({
      on() {},
      registerMessageRenderer() {},
      registerTool(definition: ToolDefinition) {
        tool = definition;
      },
    } as unknown as ExtensionAPI);
    if (tool === undefined) throw new Error("lsp tool was not registered");
    const context = { cwd: "/project", isProjectTrusted: () => true } as ExtensionContext;
    const result = await tool.execute(
      "diagnostics",
      { operation: "diagnostics", path: "example.ts" },
      undefined,
      undefined,
      context,
    );
    const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
    expect(text).toContain(`LSP diagnostics: ${verdict}.`);
    expect(text).not.toContain("LSP diagnostics: none");
    if (verdict === "unavailable") expect(text).toContain("LSP-native evidence: none.");
    if (verdict === "clean" || verdict === "partial")
      expect(text).toContain("fake returned a full diagnostic report");
    if (verdict === "unconfirmed") {
      expect(text).toContain("without a document version");
      expect(text).toContain("Unconfirmed servers: fake.");
    }
    if (verdict === "partial") expect(text).toContain("other: server failed");
  },
);

test("starts diagnostics after formatting and suppresses empty results", async () => {
  const handlers = new Map<string, Handler>();
  const deliveryModes: Array<string | undefined> = [];
  const sentMessages: SentMessage[] = [];
  let formatted = false;
  let diagnosticsObservedFormatting = false;
  let diagnosticVerdict: DiagnosticVerdict = "clean";
  let diagnosticWarnings: readonly string[] = [];
  let diagnosticCalls = 0;
  const fakeManager = {
    diagnostics: async () => {
      diagnosticCalls += 1;
      diagnosticsObservedFormatting = formatted;
      const hasIssues = diagnosticVerdict === "issues";
      return {
        diagnosticCount: hasIssues ? 1 : 0,
        diagnosticEvidence:
          diagnosticVerdict === "clean"
            ? [{ kind: "pull-report", reportKind: "full", serverId: "fake" }]
            : hasIssues
              ? [{ documentVersion: 1, kind: "push-publication", serverId: "fake" }]
              : [],
        diagnosticVerdict,
        matched: true,
        text:
          diagnosticVerdict === "clean"
            ? "LSP diagnostics: none"
            : diagnosticVerdict === "unconfirmed"
              ? "LSP diagnostics: none"
              : diagnosticVerdict === "unavailable"
                ? "LSP diagnostics: none"
                : "example.ts:1:1-1:2 [error] broken (fake)",
        unconfirmedServers: diagnosticVerdict === "unconfirmed" ? ["fake"] : [],
        warnings: diagnosticWarnings,
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
    registerMessageRenderer() {},
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

  diagnosticVerdict = "unconfirmed";
  await handlers.get("tool_result")?.(mutationResult("call-2") as never, context);
  await handlers.get("message_end")?.(mutationMessage("call-2") as never, context);
  await handlers.get("turn_end")?.(turnEnd("call-2") as never, context);
  expect(sentMessages).toEqual([]);

  diagnosticVerdict = "unavailable";
  diagnosticWarnings = ["fake: LSP path is outside project root"];
  await handlers.get("tool_result")?.(mutationResult("call-3") as never, context);
  await handlers.get("message_end")?.(mutationMessage("call-3") as never, context);
  await handlers.get("turn_end")?.(turnEnd("call-3") as never, context);
  expect(sentMessages).toEqual([]);

  diagnosticVerdict = "issues";
  diagnosticWarnings = [];
  await handlers.get("tool_result")?.(mutationResult("call-4") as never, context);
  await handlers.get("message_end")?.(mutationMessage("call-4") as never, context);
  expect(diagnosticCalls).toBe(4);
  await handlers.get("turn_end")?.(turnEnd("call-4") as never, context);

  expect(sentMessages).toEqual([
    {
      content:
        "LSP diagnostics: issues. Diagnostics were reported for the current document.\nLSP-native evidence: fake published diagnostics for document version 1.\nexample.ts:1:1-1:2 [error] broken (fake)",
      customType: "lsp-diagnostics",
      display: true,
    },
  ]);
  expect(deliveryModes).toEqual(["steer"]);
});

test("cancels superseded automatic diagnostics for the same file", async () => {
  const handlers = new Map<string, Handler>();
  const sentMessages: SentMessage[] = [];
  const signals: AbortSignal[] = [];
  const fakeManager = {
    diagnostics: async (_path: string, signal: AbortSignal | undefined) => {
      if (signal === undefined) throw new Error("expected automatic diagnostic signal");
      signals.push(signal);
      if (signals.length === 1) {
        await new Promise<void>((_resolve, reject) => {
          const cancel = () => {
            const error = new Error("LSP diagnostics cancelled");
            error.name = "AbortError";
            reject(error);
          };
          if (signal.aborted) cancel();
          else signal.addEventListener("abort", cancel, { once: true });
        });
      }
      return {
        diagnosticCount: 0,
        diagnosticEvidence: [{ kind: "pull-report", reportKind: "full", serverId: "fake" }],
        diagnosticVerdict: "clean" as const,
        matched: true,
        text: "LSP diagnostics: none",
        unconfirmedServers: [],
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
    registerMessageRenderer() {},
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

  await handlers.get("tool_result")?.(mutationResult("call-1") as never, context);
  await handlers.get("message_end")?.(mutationMessage("call-1") as never, context);
  await handlers.get("tool_result")?.(mutationResult("call-2") as never, context);
  await handlers.get("message_end")?.(mutationMessage("call-2") as never, context);

  expect(signals).toHaveLength(2);
  expect(signals[0]?.aborted).toBeTrue();
  await handlers.get("turn_end")?.(turnEnd("call-1", "call-2") as never, context);
  expect(sentMessages).toEqual([]);
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
        diagnosticEvidence: [{ kind: "push-publication", documentVersion: 1, serverId: "fake" }],
        diagnosticVerdict: "issues",
        matched: true,
        text: `${path} diagnostic ${diagnosticCalls.length}`,
        unconfirmedServers: [],
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
    registerMessageRenderer() {},
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
        "LSP diagnostics: issues. Diagnostics were reported for the current document.\nLSP-native evidence: fake published diagnostics for document version 1.\nexample.ts diagnostic 2\n\nLSP diagnostics: issues. Diagnostics were reported for the current document.\nLSP-native evidence: fake published diagnostics for document version 1.\nother.ts diagnostic 3",
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
    registerMessageRenderer() {},
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
