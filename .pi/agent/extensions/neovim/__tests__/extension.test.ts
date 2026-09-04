import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { NvimConnection } from "../channel";
import { bridgeLua } from "../channel";
import { createNeovimExtension } from "../index";

type Handler = (event: never, context: ExtensionContext) => Promise<unknown> | unknown;

class FakeConnection extends EventEmitter implements NvimConnection {
  readonly channelId = Promise.resolve(12);
  closed = false;

  async close(): Promise<void> {
    this.closed = true;
  }

  async executeLua(code: string): Promise<unknown> {
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
  const context = { cwd: "/project" } as ExtensionContext;

  createNeovimExtension({
    createConnection: async (socket) => {
      sockets.push(socket);
      return connection;
    },
    socketPath: "/tmp/launching-nvim.sock",
  })(pi);

  if (tool === undefined) throw new Error("neovim tool was not registered");
  const parameters = JSON.stringify(tool.parameters);
  expect(parameters).toContain("status");
  expect(parameters).toContain("context");
  expect(parameters).toContain("visible_windows");
  expect(parameters).toContain("list_buffers");
  expect(parameters).toContain("read_buffer");
  expect(parameters).toContain("diagnostic_summary");
  expect(parameters).toContain("diagnostics");
  expect(parameters).toContain("maxItems");
  expect(parameters).toContain("startLine");
  expect(parameters).toContain("endLine");
  expect(parameters).not.toContain("focus_context");
  expect(parameters).not.toContain("selection");
  expect(tool.description).toContain("live, in-memory state");
  expect(tool.description).toContain("do not query Pi's separate disk-backed LSP integration");
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
