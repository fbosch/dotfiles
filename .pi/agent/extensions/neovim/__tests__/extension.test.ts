import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { Value } from "typebox/value";
import type { NvimConnection } from "../channel";
import { bridgeLua, bridgeOperations } from "../channel";
import { createNeovimExtension } from "../index";
import { PROMPT_NOTIFICATION } from "../prompt-protocol";

type Handler = (event: never, context: ExtensionContext) => Promise<unknown> | unknown;

class FakeConnection extends EventEmitter implements NvimConnection {
  readonly channelId = Promise.resolve(12);
  boundSessionArguments: unknown;
  closed = false;
  promptAcknowledgement: unknown;
  readonly openedPaths: unknown[] = [];

  async close(): Promise<void> {
    this.closed = true;
  }

  async executeLua(code: string, args?: unknown[]): Promise<unknown> {
    if (code !== bridgeLua.dispatch) throw new Error("unexpected Lua");
    const request = args?.[0];
    if (typeof request !== "object" || request === null || Array.isArray(request)) {
      throw new Error("invalid bridge request");
    }
    const operation = (request as Record<string, unknown>).operation;
    const payload = (request as Record<string, unknown>).payload as Record<string, unknown>;
    if (operation === bridgeOperations.installNotifications) {
      return { channelId: 12, cwd: "/project", pid: 80 };
    }
    if (
      operation === bridgeOperations.diagnosticSummary ||
      operation === bridgeOperations.diagnostics
    ) {
      return {
        buffer: {
          buftype: "",
          filetype: "typescript",
          loaded: true,
          modified: true,
          name: "/project/example.ts",
          number: 2,
        },
        counts: { error: 1, hint: 0, information: 0, total: 1, warning: 0 },
        cwd: "/project",
        diagnostics: [
          {
            end: { column: 8, line: 1 },
            message: "unsaved error",
            severity: "error",
            source: "neovim-lsp",
            start: { column: 1, line: 1 },
          },
        ],
        pid: 80,
        truncated: false,
      };
    }
    if (operation === bridgeOperations.bindSession) {
      this.boundSessionArguments = payload;
      return payload.launchId === undefined
        ? true
        : {
            channelId: 12,
            cwd: "/project",
            editorPid: 80,
            launchId: payload.launchId,
            ownerId: "fixture",
            sessionId: payload.sessionId,
            version: 1,
          };
    }
    if (operation === bridgeOperations.openFile) {
      this.openedPaths.push(payload.path);
      return true;
    }
    if (operation === bridgeOperations.promptAck) {
      this.promptAcknowledgement = payload;
      return true;
    }
    if (operation === bridgeOperations.quickfix) {
      return {
        cwd: "/project",
        items: [],
        owner: { kind: "quickfix", listId: 2 },
        pid: 80,
        title: "quickfix fixture",
        total: 0,
        truncated: false,
      };
    }
    if (operation === bridgeOperations.readBuffer) {
      return {
        buffer: {
          buftype: "",
          filetype: "typescript",
          loaded: true,
          modified: true,
          name: "/project/example.ts",
          number: 2,
        },
        changedtick: 12,
        cwd: "/project",
        endLine: 1,
        lines: ["const unsaved = true;"],
        pid: 80,
        startLine: 1,
        totalLines: 1,
      };
    }
    if (operation === bridgeOperations.reveal) {
      return {
        buffer: {
          buftype: "",
          filetype: "typescript",
          loaded: true,
          modified: true,
          name: "/project/example.ts",
          number: 2,
        },
        cwd: "/project",
        focused: false,
        focusPreserved: true,
        pid: 80,
        position: { column: 4, line: 3 },
        split: "none",
        splitCreated: false,
        window: 7,
      };
    }
    if (operation === bridgeOperations.annotate) {
      return {
        annotations: [
          {
            annotationId: 11,
            column: 7,
            inputIndex: 1,
            kind: "warning",
            line: 3,
            placement: "callout",
            sourceLineBytes: 24,
            text: "Review this call",
          },
        ],
        batchId: payload.batchId,
        buffer: {
          buftype: "",
          filetype: "typescript",
          loaded: true,
          modified: true,
          name: "/project/example.ts",
          number: 2,
        },
        cwd: "/project",
        expiresInMs: 2_000,
        pid: 80,
        totalLines: 3,
      };
    }
    if (operation === bridgeOperations.highlight) {
      return {
        buffer: {
          buftype: "",
          filetype: "typescript",
          loaded: true,
          modified: true,
          name: "/project/example.ts",
          number: 2,
        },
        cwd: "/project",
        expiresInMs: 2_000,
        highlightId: 7,
        pid: 80,
        start: { column: 1, line: 3 },
        end: { column: 6, line: 3 },
      };
    }
    if (operation === bridgeOperations.clearHighlight) {
      return {
        buffer: {
          buftype: "",
          filetype: "typescript",
          loaded: true,
          modified: true,
          name: "/project/example.ts",
          number: 2,
        },
        cleared: true,
        cwd: "/project",
        highlightId: 7,
        pid: 80,
      };
    }
    if (operation === bridgeOperations.removeNotifications) return true;
    throw new Error("unexpected Lua");
  }

  setClientInfo(): void {}
}

test("registers one fixed-socket tool and cleans it up with the session", async () => {
  const handlers = new Map<string, Handler>();
  const sockets: string[] = [];
  const connection = new FakeConnection();
  let tool: ToolDefinition | undefined;
  let modelTurns = 0;
  const submittedPrompts: string[] = [];
  const pi = {
    on(event: string, handler: Handler) {
      handlers.set(event, handler);
    },
    registerTool(definition: ToolDefinition) {
      tool = definition;
    },
    sendMessage() {
      modelTurns += 1;
    },
    sendUserMessage(text: string) {
      modelTurns += 1;
      submittedPrompts.push(text);
    },
  } as unknown as ExtensionAPI;
  const context = {
    cwd: "/project",
    hasUI: true,
    isIdle: () => true,
    mode: "tui",
    sessionManager: { getSessionId: () => "pi-assigned-session" },
    ui: { getEditorText: () => "", setEditorText: () => undefined, setWidget() {} },
  } as unknown as ExtensionContext;

  await createNeovimExtension({
    createConnection: async (socket) => {
      sockets.push(socket);
      return connection;
    },
    launchId: "0123456789abcdef0123456789abcdef",
    socketPath: "/tmp/launching-nvim.sock",
  })(pi);

  if (tool === undefined) throw new Error("neovim tool was not registered");
  await handlers.get("session_start")?.({} as never, context);
  expect(connection.boundSessionArguments).toEqual({
    launchId: "0123456789abcdef0123456789abcdef",
    replacePending: false,
    sessionId: "pi-assigned-session",
  });
  const parameters = JSON.stringify(tool.parameters);
  expect(parameters).toContain("status");
  expect(parameters).toContain("context");
  expect(parameters).toContain("visible_windows");
  expect(parameters).toContain("list_buffers");
  expect(parameters).toContain("read_buffer");
  expect(parameters).toContain("diagnostic_summary");
  expect(parameters).toContain("diagnostics");
  expect(parameters).toContain("quickfix");
  expect(parameters).toContain("reveal");
  expect(parameters).toContain("highlight");
  expect(parameters).toContain("clear_highlight");
  expect(parameters).toContain("annotate");
  expect(parameters).toContain("annotations");
  expect(parameters).toContain("anchor");
  expect(parameters).toContain("location");
  expect(parameters).toContain("window");
  expect(parameters).toContain("maxItems");
  expect(parameters).toContain("startLine");
  expect(parameters).toContain("endLine");
  expect(parameters).toContain("expectedPath");
  expect(parameters).toContain("expectedChangedtick");
  expect(parameters).toContain("path");
  expect(parameters).toContain("column");
  expect(parameters).toContain("focus");
  expect(parameters).toContain("split");
  expect(parameters).toContain("durationMs");
  expect(parameters).toContain("highlightId");
  expect(parameters).not.toContain("open_file");
  expect(parameters).not.toContain("focus_context");
  expect(parameters).not.toContain("selection");
  expect(tool.promptGuidelines?.join("\n")).toContain(
    "If context reports NVIM_NO_FOCUS_CONTEXT, call visible_windows and then list_buffers before asking the user",
  );
  expect(tool.promptGuidelines?.join("\n")).toContain(
    "Given a filepath and range, use read_buffer directly with path",
  );
  expect(Value.Check(tool.parameters, { operation: "quickfix" })).toBe(true);
  expect(
    Value.Check(tool.parameters, { kind: "location", operation: "quickfix", window: 12 }),
  ).toBe(true);
  expect(Value.Check(tool.parameters, { kind: "location", operation: "quickfix" })).toBe(false);
  expect(
    Value.Check(tool.parameters, {
      kind: "location",
      operation: "quickfix",
      window: Number.MAX_SAFE_INTEGER + 1,
    }),
  ).toBe(false);
  expect(Value.Check(tool.parameters, { maxItems: 51, operation: "quickfix" })).toBe(false);
  expect(
    Value.Check(tool.parameters, {
      buffer: 2,
      expectedChangedtick: 0,
      expectedPath: "/project/example.ts",
      operation: "read_buffer",
    }),
  ).toBe(true);
  expect(
    Value.Check(tool.parameters, {
      operation: "read_buffer",
      path: "src/example.ts",
      startLine: 1,
    }),
  ).toBe(true);
  expect(
    Value.Check(tool.parameters, {
      buffer: 2,
      operation: "read_buffer",
      path: "src/example.ts",
    }),
  ).toBe(false);
  expect(
    Value.Check(tool.parameters, {
      expectedChangedtick: -1,
      operation: "read_buffer",
      path: "src/example.ts",
    }),
  ).toBe(false);
  expect(
    Value.Check(tool.parameters, {
      buffer: 2,
      expectedChangedtick: Number.MAX_SAFE_INTEGER + 1,
      operation: "read_buffer",
    }),
  ).toBe(false);
  expect(
    Value.Check(tool.parameters, {
      buffer: 2,
      expectedPath: "x".repeat(4097),
      operation: "read_buffer",
    }),
  ).toBe(false);
  expect(Value.Check(tool.parameters, { buffer: 2, column: 4, line: 3, operation: "reveal" })).toBe(
    true,
  );
  expect(
    Value.Check(tool.parameters, {
      buffer: 2,
      column: 4,
      focus: true,
      line: 3,
      operation: "reveal",
      split: "vertical",
    }),
  ).toBe(true);
  expect(
    Value.Check(tool.parameters, {
      buffer: 2,
      column: 4,
      line: 3,
      operation: "reveal",
      split: "diagonal",
    }),
  ).toBe(false);
  expect(Value.Check(tool.parameters, { buffer: 2, column: 0, line: 3, operation: "reveal" })).toBe(
    false,
  );
  expect(Value.Check(tool.parameters, { buffer: 2, operation: "highlight", startLine: 3 })).toBe(
    true,
  );
  expect(
    Value.Check(tool.parameters, {
      buffer: 2,
      durationMs: 30_001,
      operation: "highlight",
      startLine: 3,
    }),
  ).toBe(false);
  expect(
    Value.Check(tool.parameters, {
      annotations: [{ anchor: "target", kind: "warning", line: 3, text: "Review this call" }],
      buffer: 2,
      operation: "annotate",
    }),
  ).toBe(true);
  expect(
    Value.Check(tool.parameters, {
      annotations: [],
      buffer: 2,
      operation: "annotate",
    }),
  ).toBe(false);
  expect(
    Value.Check(tool.parameters, {
      buffer: 2,
      highlightId: 7,
      operation: "clear_highlight",
    }),
  ).toBe(true);
  expect(tool.description).toContain("live, in-memory state");
  expect(tool.description).toContain("do not query Pi's separate disk-backed LSP integration");
  expect(tool.description).toContain("explicit list ownership");
  const result = await tool.execute(
    "neovim-1",
    { operation: "status" },
    undefined,
    undefined,
    context,
  );

  expect(sockets).toEqual(["/tmp/launching-nvim.sock"]);
  expect(result.details).toEqual({ ok: true, operation: "status" });
  expect(result.content[0]).toMatchObject({ type: "text" });
  const readResult = await tool.execute(
    "neovim-2",
    { operation: "read_buffer", buffer: 2 },
    undefined,
    undefined,
    context,
  );
  expect(readResult.details).toEqual({ ok: true, operation: "read_buffer" });
  expect(readResult.content[0]).toMatchObject({
    text: expect.stringContaining("const unsaved = true;"),
    type: "text",
  });
  const diagnosticResult = await tool.execute(
    "neovim-3",
    { operation: "diagnostic_summary" },
    undefined,
    undefined,
    context,
  );
  expect(diagnosticResult.details).toEqual({ ok: true, operation: "diagnostic_summary" });
  expect(diagnosticResult.content[0]).toMatchObject({
    text: expect.stringContaining("unsaved error"),
    type: "text",
  });
  const quickfixResult = await tool.execute(
    "neovim-4",
    { operation: "quickfix" },
    undefined,
    undefined,
    context,
  );
  expect(quickfixResult.details).toEqual({ ok: true, operation: "quickfix" });
  expect(quickfixResult.content[0]).toMatchObject({
    text: expect.stringContaining("quickfix fixture"),
    type: "text",
  });
  const revealResult = await tool.execute(
    "neovim-5",
    { buffer: 2, column: 4, line: 3, operation: "reveal" },
    undefined,
    undefined,
    context,
  );
  expect(revealResult.details).toEqual({ ok: true, operation: "reveal" });
  expect(revealResult.content[0]).toMatchObject({
    text: expect.stringContaining('"focused": false'),
    type: "text",
  });
  const highlightResult = await tool.execute(
    "neovim-6",
    { buffer: 2, endColumn: 6, operation: "highlight", startLine: 3 },
    undefined,
    undefined,
    context,
  );
  expect(highlightResult.details).toEqual({ ok: true, operation: "highlight" });
  expect(highlightResult.content[0]).toMatchObject({
    text: expect.stringContaining('"highlightId": 7'),
    type: "text",
  });
  const clearHighlightResult = await tool.execute(
    "neovim-7",
    { buffer: 2, highlightId: 7, operation: "clear_highlight" },
    undefined,
    undefined,
    context,
  );
  expect(clearHighlightResult.details).toEqual({ ok: true, operation: "clear_highlight" });
  expect(clearHighlightResult.content[0]).toMatchObject({
    text: expect.stringContaining('"cleared": true'),
    type: "text",
  });
  const annotateResult = await tool.execute(
    "neovim-8",
    {
      annotations: [{ anchor: "target", kind: "warning", line: 3, text: "Review this call" }],
      buffer: 2,
      operation: "annotate",
    },
    undefined,
    undefined,
    context,
  );
  expect(annotateResult.details).toEqual({ ok: true, operation: "annotate" });
  expect(annotateResult.content[0]).toMatchObject({
    text: expect.stringContaining('"placement": "callout"'),
    type: "text",
  });
  connection.emit("notification", "pi:focus", [
    {
      buffer: {
        buftype: "",
        filetype: "typescript",
        loaded: true,
        modified: false,
        name: "/project/example.ts",
        number: 2,
      },
      cursor: { column: 1, line: 1 },
      cwd: "/project",
      pid: 80,
    },
  ]);
  expect(modelTurns).toBe(0);

  const promptRequest = {
    context: null,
    cwd: "/project",
    editorPid: 80,
    launchId: "0123456789abcdef0123456789abcdef",
    operation: "submit",
    ownerId: "fixture",
    requestId: "nvim:0123456789abcdef0123456789abcdef:1",
    sequence: 1,
    sessionId: "pi-assigned-session",
    text: "literal prompt",
    version: 1,
  } as const;
  connection.emit("notification", PROMPT_NOTIFICATION, [promptRequest]);
  await new Promise((resolve) => setImmediate(resolve));
  expect(submittedPrompts).toEqual(["literal prompt"]);
  expect(modelTurns).toBe(1);
  expect(connection.promptAcknowledgement).toMatchObject({
    outcome: "accepted",
    requestId: promptRequest.requestId,
  });

  await handlers.get("ui_prompt_start")?.({} as never, context);
  connection.emit("notification", PROMPT_NOTIFICATION, [
    {
      ...promptRequest,
      requestId: "nvim:0123456789abcdef0123456789abcdef:2",
      sequence: 2,
      text: "blocked prompt",
    },
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  expect(submittedPrompts).toEqual(["literal prompt"]);
  expect(connection.promptAcknowledgement).toMatchObject({
    code: "PI_BUSY",
    outcome: "rejected",
  });
  await handlers.get("ui_prompt_end")?.({} as never, context);

  connection.emit("notification", PROMPT_NOTIFICATION, [
    {
      ...promptRequest,
      forged: true,
      requestId: "nvim:0123456789abcdef0123456789abcdef:3",
      sequence: 3,
    },
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  expect(submittedPrompts).toEqual(["literal prompt"]);
  expect(connection.promptAcknowledgement).toMatchObject({
    code: "PI_INVALID_REQUEST",
    outcome: "rejected",
  });

  connection.emit("notification", PROMPT_NOTIFICATION, [
    {
      ...promptRequest,
      requestId: "nvim:0123456789abcdef0123456789abcdef:4",
      sequence: 4,
      text: "after malformed request",
    },
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  expect(submittedPrompts).toEqual(["literal prompt", "after malformed request"]);
  expect(connection.promptAcknowledgement).toMatchObject({ outcome: "accepted" });

  const replacementContext = {
    ...context,
    sessionManager: { getSessionId: () => "pi-replacement-session" },
  } as ExtensionContext;
  await handlers.get("session_start")?.(
    { previousSessionFile: "/tmp/previous.jsonl", reason: "new" } as never,
    replacementContext,
  );
  expect(connection.boundSessionArguments).toEqual({
    launchId: "0123456789abcdef0123456789abcdef",
    replacePending: true,
    sessionId: "pi-replacement-session",
  });
  connection.emit("notification", PROMPT_NOTIFICATION, [
    {
      ...promptRequest,
      requestId: "nvim:0123456789abcdef0123456789abcdef:5",
      sequence: 5,
      sessionId: "pi-replacement-session",
      text: "replacement session prompt",
    },
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  expect(submittedPrompts).toEqual([
    "literal prompt",
    "after malformed request",
    "replacement session prompt",
  ]);

  await handlers.get("session_shutdown")?.({} as never, replacementContext);
  expect(connection.closed).toBe(true);
});

for (const mode of ["tui", "rpc", "json", "print"] as const) {
  test(`file links follow session lifecycle without an editor replacement (${mode})`, async () => {
    const handlers = new Map<string, Handler>();
    const connection = new FakeConnection();
    const external: string[] = [];
    const original = (url: string) => {
      external.push(url);
    };
    const tui = { mode: "fullscreen", openUrl: original };
    let widget: (Component & { dispose?: () => void }) | undefined;
    const context = {
      cwd: "/project",
      mode,
      sessionManager: { getSessionId: () => "click-session" },
      ui: {
        setWidget(_key: string, content: Parameters<ExtensionUIContext["setWidget"]>[1]) {
          widget?.dispose?.();
          widget =
            typeof content === "function" ? content(tui as unknown as TUI, {} as never) : undefined;
        },
        notify(message: string) {
          throw new Error(message);
        },
      },
    } as unknown as ExtensionContext;
    const pi = {
      on(event: string, handler: Handler) {
        handlers.set(event, handler);
      },
      registerTool() {},
    } as unknown as ExtensionAPI;
    await createNeovimExtension({
      createConnection: async () => connection,
      socketPath: "/tmp/launching-nvim.sock",
    })(pi);

    await handlers.get("session_start")?.({} as never, context);
    expect(widget?.render(80)).toEqual(mode === "tui" ? [] : undefined);
    tui.openUrl("file:///tmp/clipboard.png");
    await new Promise((resolve) => setImmediate(resolve));
    expect(connection.openedPaths).toEqual(mode === "tui" ? ["/tmp/clipboard.png"] : []);
    expect(external).toEqual(mode === "tui" ? [] : ["file:///tmp/clipboard.png"]);

    await handlers.get("session_shutdown")?.({} as never, context);
    expect(tui.openUrl).toBe(original);
    expect(widget).toBeUndefined();
    expect(connection.closed).toBe(true);
  });
}

test("stays unloaded when the session has no Neovim launch binding", async () => {
  let registrations = 0;
  let lifecycleHandlers = 0;
  let connections = 0;
  const pi = {
    on() {
      lifecycleHandlers += 1;
    },
    registerTool() {
      registrations += 1;
    },
  } as unknown as ExtensionAPI;

  await createNeovimExtension({
    createConnection: async () => {
      connections += 1;
      return new FakeConnection();
    },
    socketPath: "",
  })(pi);

  expect(registrations).toBe(0);
  expect(lifecycleHandlers).toBe(0);
  expect(connections).toBe(0);
});
