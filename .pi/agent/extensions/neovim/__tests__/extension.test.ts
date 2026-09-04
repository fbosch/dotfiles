import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import type { NvimConnection } from "../channel";
import { bridgeLua } from "../channel";
import { createNeovimExtension } from "../index";

type Handler = (event: never, context: ExtensionContext) => Promise<unknown> | unknown;

class FakeConnection extends EventEmitter implements NvimConnection {
  readonly channelId = Promise.resolve(12);
  boundSessionArguments: unknown[] | undefined;
  closed = false;

  async close(): Promise<void> {
    this.closed = true;
  }

  async executeLua(code: string, args?: unknown[]): Promise<unknown> {
    if (code === bridgeLua.installNotifications) {
      return { channelId: 12, cwd: "/project", pid: 80 };
    }
    if (code === bridgeLua.diagnostics) {
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
    if (code === bridgeLua.bindSession) {
      this.boundSessionArguments = args;
      return true;
    }
    if (code === bridgeLua.quickfix) {
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
    if (code === bridgeLua.readBuffer) {
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
        endLine: 1,
        lines: ["const unsaved = true;"],
        pid: 80,
        startLine: 1,
        totalLines: 1,
      };
    }
    if (code === bridgeLua.reveal) {
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
    if (code === bridgeLua.highlight) {
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
    if (code === bridgeLua.highlightClear) {
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
    if (code === bridgeLua.removeNotifications) return true;
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
  } as unknown as ExtensionAPI;
  const context = {
    cwd: "/project",
    sessionManager: { getSessionId: () => "pi-assigned-session" },
  } as ExtensionContext;

  createNeovimExtension({
    createConnection: async (socket) => {
      sockets.push(socket);
      return connection;
    },
    socketPath: "/tmp/launching-nvim.sock",
  })(pi);

  if (tool === undefined) throw new Error("neovim tool was not registered");
  await handlers.get("session_start")?.({} as never, context);
  expect(connection.boundSessionArguments).toEqual(["pi-assigned-session"]);
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
  expect(parameters).toContain("location");
  expect(parameters).toContain("window");
  expect(parameters).toContain("maxItems");
  expect(parameters).toContain("startLine");
  expect(parameters).toContain("endLine");
  expect(parameters).toContain("column");
  expect(parameters).toContain("focus");
  expect(parameters).toContain("split");
  expect(parameters).toContain("durationMs");
  expect(parameters).toContain("highlightId");
  expect(parameters).not.toContain("focus_context");
  expect(parameters).not.toContain("selection");
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

  await handlers.get("session_shutdown")?.({} as never, context);
  expect(connection.closed).toBe(true);
});

test("stays unloaded when the session has no Neovim launch binding", () => {
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

  createNeovimExtension({
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
