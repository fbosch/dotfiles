import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { bridgeLua, type NvimConnection, PiNeovimChannel } from "../channel";
import { FOCUS_NOTIFICATION } from "../contracts";

const focus = {
  buffer: {
    buftype: "",
    filetype: "typescript",
    loaded: true,
    modified: true,
    name: "/project/example.ts",
    number: 2,
  },
  cursor: { column: 4, line: 3 },
  cwd: "/project",
  pid: 71,
  selection: {
    anchor: { column: 1, line: 3 },
    cursor: { column: 4, line: 3 },
    lines: ["test"],
    mode: "v",
  },
};

class FakeConnection extends EventEmitter implements NvimConnection {
  readonly channelId = Promise.resolve(9);
  activeResponse: unknown = { ...focus, mode: "n", selection: undefined };
  closeCalls = 0;
  executeCalls: string[] = [];

  async close(): Promise<void> {
    this.closeCalls += 1;
  }

  async executeLua(code: string): Promise<unknown> {
    this.executeCalls.push(code);
    if (code === bridgeLua.installNotifications) {
      this.emit("notification", FOCUS_NOTIFICATION, [focus]);
      return { channelId: 9, cwd: "/project", pid: 71 };
    }
    if (code === bridgeLua.activeContext) return this.activeResponse;
    if (code === bridgeLua.removeNotifications) return true;
    throw new Error("unexpected Lua");
  }

  setClientInfo(): void {}
}

describe("PiNeovimChannel", () => {
  test("opens one lazy channel and receives focus state over it", async () => {
    const connection = new FakeConnection();
    let creations = 0;
    const channel = new PiNeovimChannel("/tmp/nvim.sock", "/project", async () => {
      creations += 1;
      return connection;
    });
    connection.activeResponse = { ...focus, mode: "v" };

    expect(creations).toBe(0);
    expect(await channel.status()).toEqual({
      ok: true,
      value: { channelId: 9, cwd: "/project", pid: 71 },
    });
    expect(await channel.context()).toEqual({
      ok: true,
      value: { ...focus, mode: "v" },
    });
    expect(await channel.focusContext()).toEqual({ ok: true, value: focus });
    expect(await channel.selection()).toEqual({
      ok: true,
      value: {
        ...focus.selection,
        buffer: focus.buffer,
        cwd: focus.cwd,
        pid: focus.pid,
      },
    });
    expect(creations).toBe(1);
  });

  test("unknown and malformed notifications cannot replace focus state", async () => {
    const connection = new FakeConnection();
    const channel = new PiNeovimChannel("/tmp/nvim.sock", "/project", async () => connection);
    await channel.status();

    connection.emit("notification", "unknown", [{ ...focus, cursor: { column: 9, line: 9 } }]);
    connection.emit("notification", FOCUS_NOTIFICATION, [{ invalid: true }]);

    expect(await channel.focusContext()).toEqual({ ok: true, value: focus });
  });

  test("substitutes source context and selection instead of reporting a marked Pi terminal", async () => {
    const connection = new FakeConnection();
    const channel = new PiNeovimChannel("/tmp/nvim.sock", "/project", async () => connection);
    await channel.status();
    connection.activeResponse = { ...focus, mode: "v" };

    expect(bridgeLua.activeContext).toContain("vim.b[buffer].is_pi_terminal");
    expect(bridgeLua.activeContext).toContain('nvim_get_var, "pi_launch_source_context"');
    expect(bridgeLua.activeContext).not.toContain("agentTerminalFocused");
    expect(await channel.context()).toEqual({ ok: true, value: { ...focus, mode: "v" } });
    expect(await channel.focusContext()).toEqual({ ok: true, value: focus });
    expect(await channel.selection()).toEqual({
      ok: true,
      value: {
        ...focus.selection,
        buffer: focus.buffer,
        cwd: focus.cwd,
        pid: focus.pid,
      },
    });
  });

  test("reports missing source context instead of marked terminal metadata", async () => {
    const connection = new FakeConnection();
    connection.activeResponse = null;
    const channel = new PiNeovimChannel("/tmp/nvim.sock", "/project", async () => connection);

    expect(await channel.context()).toMatchObject({
      error: { code: "NVIM_NO_FOCUS_CONTEXT" },
      ok: false,
    });
  });

  test("reports absent source selection without reading terminal state", async () => {
    const connection = new FakeConnection();
    const channel = new PiNeovimChannel("/tmp/nvim.sock", "/project", async () => connection);
    await channel.status();
    connection.activeResponse = { ...focus, mode: "n", selection: undefined };

    expect(await channel.selection()).toMatchObject({
      error: { code: "NVIM_NO_SELECTION" },
      ok: false,
    });
  });

  test("rejects invalid active context responses", async () => {
    const connection = new FakeConnection();
    connection.activeResponse = { arbitrary: "data" };
    const channel = new PiNeovimChannel("/tmp/nvim.sock", "/project", async () => connection);

    expect(await channel.context()).toMatchObject({
      error: { code: "NVIM_INVALID_RESPONSE" },
      ok: false,
    });
  });

  test("missing sockets fail closed without creating a connection", async () => {
    let creations = 0;
    const channel = new PiNeovimChannel(undefined, "/project", async () => {
      creations += 1;
      return new FakeConnection();
    });

    expect(await channel.status()).toMatchObject({
      error: { code: "NVIM_UNAVAILABLE" },
      ok: false,
    });
    expect(creations).toBe(0);
  });

  test("stale sockets fail closed and are not retried", async () => {
    let creations = 0;
    const channel = new PiNeovimChannel("/tmp/stale.sock", "/project", async () => {
      creations += 1;
      throw new Error("connect ENOENT /tmp/stale.sock");
    });

    expect(await channel.status()).toMatchObject({
      error: { code: "NVIM_UNAVAILABLE" },
      ok: false,
    });
    expect(await channel.status()).toMatchObject({ ok: false });
    expect(creations).toBe(1);
  });

  test("keeps simultaneous channels bound to their respective sockets", async () => {
    const sockets: string[] = [];
    const createConnection = async (socket: string) => {
      sockets.push(socket);
      return new FakeConnection();
    };
    const first = new PiNeovimChannel("/tmp/first.sock", "/project", createConnection);
    const second = new PiNeovimChannel("/tmp/second.sock", "/project", createConnection);

    expect((await first.status()).ok).toBe(true);
    expect((await second.status()).ok).toBe(true);
    expect(sockets).toEqual(["/tmp/first.sock", "/tmp/second.sock"]);
  });

  test("worktree mismatch is terminal and never falls back", async () => {
    const connection = new FakeConnection();
    let creations = 0;
    const channel = new PiNeovimChannel("/tmp/nvim.sock", "/other", async () => {
      creations += 1;
      return connection;
    });

    expect(await channel.status()).toMatchObject({
      error: { code: "NVIM_UNAVAILABLE" },
      ok: false,
    });
    expect(await channel.status()).toMatchObject({ ok: false });
    expect(creations).toBe(1);
  });

  test("shutdown removes listeners, bridge state, and the transport", async () => {
    const connection = new FakeConnection();
    const channel = new PiNeovimChannel("/tmp/nvim.sock", "/project", async () => connection);
    await channel.status();

    await channel.close();
    connection.emit("notification", FOCUS_NOTIFICATION, [focus]);

    expect(connection.closeCalls).toBe(1);
    expect(connection.listenerCount("notification")).toBe(0);
    expect(await channel.focusContext()).toMatchObject({
      error: { code: "NVIM_UNAVAILABLE" },
      ok: false,
    });
  });
});
