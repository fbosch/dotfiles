import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { bridgeLua, type NvimConnection, PiNeovimChannel } from "../channel";
import { FOCUS_NOTIFICATION, MAX_METADATA_STRING_BYTES } from "../contracts";

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
  bufferResponse: unknown = { buffers: [focus.buffer], cwd: "/project", pid: 71 };
  closeCalls = 0;
  executeCalls: string[] = [];
  identityResponse: unknown = { channelId: 9, cwd: "/project", pid: 71 };
  readArguments: unknown[] | undefined;
  readResponse: unknown = {
    buffer: focus.buffer,
    cwd: "/project",
    endLine: 2,
    lines: ["const unsaved = true;", "export { unsaved };"],
    pid: 71,
    startLine: 1,
    totalLines: 2,
  };
  visibleResponse: unknown = {
    cwd: "/project",
    pid: 71,
    windows: [{ bottomLine: 20, buffer: focus.buffer, number: 4, topLine: 1 }],
  };

  async close(): Promise<void> {
    this.closeCalls += 1;
  }

  async executeLua(code: string, args?: unknown[]): Promise<unknown> {
    this.executeCalls.push(code);
    if (code === bridgeLua.installNotifications) {
      this.emit("notification", FOCUS_NOTIFICATION, [focus]);
      return this.identityResponse;
    }
    if (code === bridgeLua.activeContext) return this.activeResponse;
    if (code === bridgeLua.visibleWindows) return this.visibleResponse;
    if (code === bridgeLua.listBuffers) return this.bufferResponse;
    if (code === bridgeLua.readBuffer) {
      this.readArguments = args;
      return this.readResponse;
    }
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

  test("returns source inventory and bounded in-memory reads over the bound channel", async () => {
    const connection = new FakeConnection();
    const channel = new PiNeovimChannel("/tmp/nvim.sock", "/project", async () => connection);

    expect(await channel.visibleWindows()).toEqual({
      ok: true,
      value: {
        editor: { channelId: 9, cwd: "/project", pid: 71 },
        windows: [{ bottomLine: 20, buffer: focus.buffer, number: 4, topLine: 1 }],
      },
    });
    expect(await channel.listBuffers()).toEqual({
      ok: true,
      value: {
        buffers: [focus.buffer],
        editor: { channelId: 9, cwd: "/project", pid: 71 },
      },
    });
    expect(await channel.readBuffer({ buffer: 2, endLine: 2, startLine: 1 })).toEqual({
      ok: true,
      value: {
        buffer: focus.buffer,
        editor: { channelId: 9, cwd: "/project", pid: 71 },
        endLine: 2,
        lines: ["const unsaved = true;", "export { unsaved };"],
        startLine: 1,
        totalLines: 2,
      },
    });
    expect(connection.readArguments).toEqual([2, 1, 2, 500, 32 * 1024]);
    expect(connection.executeCalls).toContain(bridgeLua.visibleWindows);
    expect(connection.executeCalls).toContain(bridgeLua.listBuffers);
    expect(connection.executeCalls).toContain(bridgeLua.readBuffer);
  });

  test("preserves structured buffer and range failures without disabling the channel", async () => {
    const connection = new FakeConnection();
    const channel = new PiNeovimChannel("/tmp/nvim.sock", "/project", async () => connection);

    connection.readResponse = { error: "invalidBuffer" };
    expect(await channel.readBuffer({ buffer: 999 })).toMatchObject({
      error: { code: "NVIM_INVALID_BUFFER" },
      ok: false,
    });
    connection.readResponse = { error: "invalidRange", totalLines: 2 };
    expect(await channel.readBuffer({ buffer: 2, startLine: 3 })).toMatchObject({
      error: { code: "NVIM_INVALID_RANGE" },
      ok: false,
    });
    expect((await channel.status()).ok).toBe(true);
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

  test("rejects an identity that does not match the connected RPC channel", async () => {
    const connection = new FakeConnection();
    connection.identityResponse = { channelId: 10, cwd: "/project", pid: 71 };
    const channel = new PiNeovimChannel("/tmp/nvim.sock", "/project", async () => connection);

    expect(await channel.status()).toMatchObject({
      error: {
        code: "NVIM_INVALID_RESPONSE",
        message: "Neovim returned an unexpected channel identity",
      },
      ok: false,
    });
    expect(connection.closeCalls).toBe(1);
  });

  test("rejects oversized editor identity metadata", async () => {
    const connection = new FakeConnection();
    connection.identityResponse = {
      channelId: 9,
      cwd: "x".repeat(MAX_METADATA_STRING_BYTES + 1),
      pid: 71,
    };
    const channel = new PiNeovimChannel("/tmp/nvim.sock", "/project", async () => connection);

    expect(await channel.status()).toMatchObject({
      error: { code: "NVIM_INVALID_RESPONSE" },
      ok: false,
    });
  });

  test("closes a connection that finishes opening during shutdown", async () => {
    const connection = new FakeConnection();
    let resolveConnection: ((connection: NvimConnection) => void) | undefined;
    const pendingConnection = new Promise<NvimConnection>((resolvePromise) => {
      resolveConnection = resolvePromise;
    });
    const channel = new PiNeovimChannel("/tmp/nvim.sock", "/project", () => pendingConnection);

    const status = channel.status();
    await Bun.sleep(0);
    const closing = channel.close();
    resolveConnection?.(connection);

    expect(await status).toMatchObject({ error: { code: "NVIM_UNAVAILABLE" }, ok: false });
    await closing;
    expect(connection.executeCalls).toContain(bridgeLua.removeNotifications);
    expect(connection.listenerCount("notification")).toBe(0);
    expect(connection.closeCalls).toBe(1);
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
      error: { code: "NVIM_WORKTREE_MISMATCH" },
      ok: false,
    });
    expect(await channel.status()).toMatchObject({
      error: { code: "NVIM_WORKTREE_MISMATCH" },
      ok: false,
    });
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
