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

test("reports an absent launch binding without attempting socket discovery", async () => {
  let tool: ToolDefinition | undefined;
  let connections = 0;
  const pi = {
    on() {},
    registerTool(definition: ToolDefinition) {
      tool = definition;
    },
  } as unknown as ExtensionAPI;
  const context = { cwd: "/project" } as ExtensionContext;

  createNeovimExtension({
    createConnection: async () => {
      connections += 1;
      return new FakeConnection();
    },
    socketPath: "",
  })(pi);

  if (tool === undefined) throw new Error("neovim tool was not registered");
  const result = await tool.execute(
    "neovim-1",
    { operation: "status" },
    undefined,
    undefined,
    context,
  );

  expect(connections).toBe(0);
  expect(result.details).toEqual({ code: "NVIM_UNAVAILABLE", ok: false, operation: "status" });
});
