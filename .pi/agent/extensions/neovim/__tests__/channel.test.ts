import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { bridgeLua, bridgeOperations, type NvimConnection, PiNeovimChannel } from "../channel";
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
  annotationArguments: unknown;
  annotationResponse: unknown = {
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
    batchId: 1,
    buffer: focus.buffer,
    cwd: "/project",
    expiresInMs: 2_000,
    pid: 71,
    totalLines: 3,
  };
  bindArguments: unknown;
  bufferResponse: unknown = { buffers: [focus.buffer], cwd: "/project", pid: 71 };
  closeCalls = 0;
  deleteAnnotationArguments: unknown;
  deleteHighlightArguments: unknown;
  diagnosticArguments: unknown[] = [];
  diagnosticResponse: unknown = {
    buffer: focus.buffer,
    counts: { error: 1, hint: 0, information: 0, total: 1, warning: 0 },
    cwd: "/project",
    diagnostics: [
      {
        end: { column: 8, line: 3 },
        message: "unsaved error",
        severity: "error",
        source: "neovim-lsp",
        start: { column: 4, line: 3 },
      },
    ],
    pid: 71,
    truncated: false,
  };
  executeCalls: string[] = [];
  highlightArguments: unknown;
  highlightGate: Promise<void> | undefined;
  highlightResponse: unknown = {
    buffer: focus.buffer,
    cwd: "/project",
    expiresInMs: 2_000,
    highlightId: 7,
    pid: 71,
    start: { column: 1, line: 3 },
    end: { column: 6, line: 3 },
  };
  highlightClearArguments: unknown;
  highlightClearResponse: unknown = {
    buffer: focus.buffer,
    cleared: true,
    cwd: "/project",
    highlightId: 7,
    pid: 71,
  };
  identityResponse: unknown = { channelId: 9, cwd: "/project", pid: 71 };
  quickfixArguments: unknown;
  quickfixResponse: unknown = {
    cwd: "/project",
    items: [
      {
        buffer: 2,
        column: 4,
        endColumn: 8,
        endLine: 3,
        filename: "/project/example.ts",
        line: 3,
        text: "quickfix item",
        type: "E",
        valid: true,
      },
    ],
    owner: { kind: "quickfix", listId: 4 },
    pid: 71,
    title: "quickfix fixture",
    total: 2,
    truncated: true,
  };
  readArguments: unknown;
  readResponse: unknown = {
    buffer: focus.buffer,
    cwd: "/project",
    endLine: 2,
    lines: ["const unsaved = true;", "export { unsaved };"],
    pid: 71,
    startLine: 1,
    totalLines: 2,
  };
  revealArguments: unknown;
  revealResponse: unknown = {
    buffer: focus.buffer,
    cwd: "/project",
    focused: false,
    focusPreserved: true,
    pid: 71,
    position: { column: 4, line: 3 },
    split: "none",
    splitCreated: false,
    window: 4,
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
    if (code !== bridgeLua.dispatch) throw new Error("unexpected Lua");
    const request = args?.[0];
    if (typeof request !== "object" || request === null || Array.isArray(request)) {
      throw new Error("invalid bridge request");
    }
    const operation = (request as Record<string, unknown>).operation;
    const payload = (request as Record<string, unknown>).payload;
    if (typeof operation !== "string" || typeof payload !== "object" || payload === null) {
      throw new Error("invalid bridge request");
    }
    this.executeCalls.push(operation);
    if (operation === bridgeOperations.installNotifications) {
      this.emit("notification", FOCUS_NOTIFICATION, [focus]);
      return this.identityResponse;
    }
    if (operation === bridgeOperations.bindSession) {
      this.bindArguments = payload as Record<string, unknown>;
      return true;
    }
    if (operation === bridgeOperations.activeContext) return this.activeResponse;
    if (operation === bridgeOperations.annotate) {
      this.annotationArguments = payload as Record<string, unknown>;
      return this.annotationResponse;
    }
    if (operation === bridgeOperations.deleteAnnotations) {
      this.deleteAnnotationArguments = payload as Record<string, unknown>;
      return true;
    }
    if (
      operation === bridgeOperations.diagnosticSummary ||
      operation === bridgeOperations.diagnostics
    ) {
      this.diagnosticArguments.push(payload);
      return this.diagnosticResponse;
    }
    if (operation === bridgeOperations.deleteHighlight) {
      this.deleteHighlightArguments = payload as Record<string, unknown>;
      return true;
    }
    if (operation === bridgeOperations.visibleWindows) return this.visibleResponse;
    if (operation === bridgeOperations.highlight) {
      this.highlightArguments = payload as Record<string, unknown>;
      await this.highlightGate;
      return this.highlightResponse;
    }
    if (operation === bridgeOperations.clearHighlight) {
      this.highlightClearArguments = payload as Record<string, unknown>;
      return this.highlightClearResponse;
    }
    if (operation === bridgeOperations.listBuffers) return this.bufferResponse;
    if (operation === bridgeOperations.quickfix) {
      this.quickfixArguments = payload as Record<string, unknown>;
      return this.quickfixResponse;
    }
    if (operation === bridgeOperations.readBuffer) {
      this.readArguments = payload as Record<string, unknown>;
      return this.readResponse;
    }
    if (operation === bridgeOperations.reveal) {
      this.revealArguments = payload as Record<string, unknown>;
      return this.revealResponse;
    }
    if (operation === bridgeOperations.removeNotifications) return true;
    throw new Error("unexpected bridge operation");
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

  test("binds Pi-assigned session identity over fixed bridge Lua", async () => {
    const connection = new FakeConnection();
    const channel = new PiNeovimChannel("/tmp/nvim.sock", "/project", async () => connection);

    expect(await channel.bindSession("pi-session-one")).toEqual({
      ok: true,
      value: { channelId: 9, cwd: "/project", pid: 71 },
    });
    expect(connection.bindArguments).toEqual({ sessionId: "pi-session-one" });
    expect(await channel.bindSession("invalid/session")).toMatchObject({
      error: { code: "NVIM_INVALID_RESPONSE" },
      ok: false,
    });
    expect(connection.bindArguments).toEqual({ sessionId: "pi-session-one" });
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
    expect(connection.readArguments).toEqual({ buffer: 2, endLine: 2, startLine: 1 });
    expect(connection.executeCalls).toContain(bridgeOperations.visibleWindows);
    expect(connection.executeCalls).toContain(bridgeOperations.listBuffers);
    expect(connection.executeCalls).toContain(bridgeOperations.readBuffer);
  });

  test("returns bounded Neovim diagnostic summaries and complete details", async () => {
    const connection = new FakeConnection();
    const channel = new PiNeovimChannel("/tmp/nvim.sock", "/project", async () => connection);

    expect(await channel.diagnosticSummary()).toMatchObject({
      ok: true,
      value: {
        buffer: focus.buffer,
        counts: { error: 1, total: 1 },
        diagnostics: [{ message: "unsaved error", severity: "error" }],
        editor: { channelId: 9, cwd: "/project", pid: 71 },
        truncated: false,
      },
    });
    expect(await channel.diagnostics(2)).toMatchObject({
      ok: true,
      value: {
        buffer: focus.buffer,
        diagnostics: [{ message: "unsaved error", severity: "error" }],
        editor: { channelId: 9, cwd: "/project", pid: 71 },
        total: 1,
      },
    });
    expect(connection.diagnosticArguments).toEqual([{ maxItems: 20 }, { buffer: 2 }]);
  });

  test("returns bounded quickfix and explicitly owned location lists", async () => {
    const connection = new FakeConnection();
    const channel = new PiNeovimChannel("/tmp/nvim.sock", "/project", async () => connection);

    expect(await channel.quickfix()).toMatchObject({
      ok: true,
      value: {
        items: [{ filename: "/project/example.ts", line: 3, text: "quickfix item" }],
        owner: { kind: "quickfix", listId: 4 },
        title: "quickfix fixture",
        total: 2,
        truncated: true,
      },
    });
    expect(connection.quickfixArguments).toEqual({ kind: "quickfix", maxItems: 20 });

    connection.quickfixResponse = {
      cwd: "/project",
      items: [],
      owner: { kind: "location", listId: 5, window: 4 },
      pid: 71,
      title: "location fixture",
      total: 0,
      truncated: false,
    };
    expect(await channel.quickfix({ kind: "location", maxItems: 50, window: 4 })).toMatchObject({
      ok: true,
      value: { items: [], owner: { kind: "location", listId: 5, window: 4 } },
    });
    expect(connection.quickfixArguments).toEqual({ kind: "location", maxItems: 50, window: 4 });
  });

  test("reveals exact source positions with explicit focus and split options", async () => {
    const connection = new FakeConnection();
    const channel = new PiNeovimChannel("/tmp/nvim.sock", "/project", async () => connection);

    expect(await channel.reveal({ buffer: 2, column: 4, line: 3 })).toMatchObject({
      ok: true,
      value: {
        buffer: focus.buffer,
        focused: false,
        focusPreserved: true,
        position: { column: 4, line: 3 },
        split: "none",
        splitCreated: false,
        window: 4,
      },
    });
    expect(connection.revealArguments).toEqual({
      buffer: 2,
      column: 4,
      expectedCwd: "/project",
      focus: false,
      line: 3,
      split: "none",
    });

    connection.revealResponse = {
      buffer: focus.buffer,
      cwd: "/project",
      focused: true,
      focusPreserved: false,
      pid: 71,
      position: { column: 4, line: 3 },
      split: "horizontal",
      splitCreated: true,
      window: 6,
    };
    expect(
      await channel.reveal({
        buffer: 2,
        column: 4,
        focus: true,
        line: 3,
        split: "horizontal",
      }),
    ).toMatchObject({ ok: true, value: { focused: true, splitCreated: true, window: 6 } });
    expect(connection.revealArguments).toEqual({
      buffer: 2,
      column: 4,
      expectedCwd: "/project",
      focus: true,
      line: 3,
      split: "horizontal",
    });
    expect(await channel.focusContext()).toMatchObject({
      ok: true,
      value: { buffer: focus.buffer, cursor: { column: 4, line: 3 } },
    });

    expect(await channel.reveal({ buffer: 0, column: 1, line: 1 })).toMatchObject({
      error: { code: "NVIM_INVALID_BUFFER" },
      ok: false,
    });
    connection.revealResponse = { error: "worktreeMismatch" };
    expect(await channel.reveal({ buffer: 2, column: 1, line: 1 })).toMatchObject({
      error: { code: "NVIM_WORKTREE_MISMATCH" },
      ok: false,
    });
    expect((await channel.status()).ok).toBe(true);
  });

  test("creates atomic anchored annotation batches and rolls back invalid responses", async () => {
    const connection = new FakeConnection();
    const channel = new PiNeovimChannel("/tmp/nvim.sock", "/project", async () => connection);
    const annotations = [
      { anchor: "target", kind: "warning" as const, line: 3, text: "Review this call" },
    ];

    expect(await channel.annotate({ annotations, buffer: 2 })).toMatchObject({
      ok: true,
      value: {
        annotations: [
          {
            annotationId: 11,
            column: 7,
            inputIndex: 1,
            kind: "warning",
            line: 3,
            placement: "callout",
            text: "Review this call",
          },
        ],
        expiresInMs: 2_000,
      },
    });
    expect(connection.annotationArguments).toEqual({
      annotations,
      batchId: 1,
      buffer: 2,
      durationMs: 2_000,
      expectedCwd: "/project",
    });

    connection.annotationResponse = {
      error: "staleAnchor",
      annotationIndex: 1,
      requestedLine: 3,
    };
    expect(await channel.annotate({ annotations, buffer: 2 })).toMatchObject({
      error: { code: "NVIM_STALE_ANCHOR" },
      ok: false,
    });
    connection.annotationResponse = {
      annotations: [
        {
          annotationId: 12,
          column: 7,
          inputIndex: 1,
          kind: "warning",
          line: 3,
          placement: "callout",
          sourceLineBytes: 24,
          text: "mismatched",
        },
      ],
      batchId: 3,
      buffer: focus.buffer,
      cwd: "/project",
      expiresInMs: 2_000,
      pid: 71,
      totalLines: 3,
    };
    expect(await channel.annotate({ annotations, buffer: 2 })).toMatchObject({
      error: { code: "NVIM_INVALID_RESPONSE" },
      ok: false,
    });
    expect(connection.deleteAnnotationArguments).toEqual({ batchId: 3, buffer: 2 });
    expect((await channel.status()).ok).toBe(true);
  });

  test("creates and explicitly removes bounded temporary highlights", async () => {
    const connection = new FakeConnection();
    const channel = new PiNeovimChannel("/tmp/nvim.sock", "/project", async () => connection);

    expect(
      await channel.highlight({ buffer: 2, endColumn: 6, endLine: 3, startLine: 3 }),
    ).toMatchObject({
      ok: true,
      value: {
        buffer: focus.buffer,
        expiresInMs: 2_000,
        highlightId: 7,
        start: { column: 1, line: 3 },
        end: { column: 6, line: 3 },
      },
    });
    expect(connection.highlightArguments).toEqual({
      buffer: 2,
      durationMs: 2_000,
      endColumn: 6,
      endLine: 3,
      expectedCwd: "/project",
      startColumn: 1,
      startLine: 3,
    });

    expect(await channel.clearHighlight({ buffer: 2, highlightId: 7 })).toMatchObject({
      ok: true,
      value: { cleared: true, highlightId: 7 },
    });
    expect(connection.highlightClearArguments).toEqual({
      buffer: 2,
      expectedCwd: "/project",
      highlightId: 7,
    });

    expect(await channel.highlight({ buffer: 2, durationMs: 30_001, startLine: 1 })).toMatchObject({
      error: { code: "NVIM_LIMIT_EXCEEDED" },
      ok: false,
    });
    connection.highlightResponse = { error: "invalidRange", totalLines: 2 };
    expect(await channel.highlight({ buffer: 2, startLine: 3 })).toMatchObject({
      error: { code: "NVIM_INVALID_RANGE" },
      ok: false,
    });
    connection.highlightResponse = {
      buffer: focus.buffer,
      cwd: "/project",
      expiresInMs: 2_000,
      highlightId: 8,
      pid: 71,
      start: { column: 2, line: 3 },
      end: { column: 6, line: 3 },
    };
    expect(
      await channel.highlight({ buffer: 2, endColumn: 6, endLine: 3, startLine: 3 }),
    ).toMatchObject({ error: { code: "NVIM_INVALID_RESPONSE" }, ok: false });
    expect(connection.deleteHighlightArguments).toEqual({ buffer: 2, highlightId: 8 });
    expect((await channel.status()).ok).toBe(true);
  });

  test("drains an in-flight highlight before session cleanup", async () => {
    const connection = new FakeConnection();
    let releaseHighlight: () => void = () => undefined;
    connection.highlightGate = new Promise<void>((resolve) => {
      releaseHighlight = resolve;
    });
    const channel = new PiNeovimChannel("/tmp/nvim.sock", "/project", async () => connection);

    const highlight = channel.highlight({ buffer: 2, endColumn: 6, startLine: 3 });
    while (connection.highlightArguments === undefined) await Promise.resolve();
    const closing = channel.close();
    await Promise.resolve();
    expect(connection.closeCalls).toBe(0);
    releaseHighlight();
    expect(await highlight).toMatchObject({ ok: true });
    await closing;
    expect(connection.executeCalls.indexOf(bridgeOperations.highlight)).toBeLessThan(
      connection.executeCalls.indexOf(bridgeOperations.removeNotifications),
    );
    expect(connection.closeCalls).toBe(1);
  });

  test("preserves structured problem-list failures without disabling the channel", async () => {
    const connection = new FakeConnection();
    const channel = new PiNeovimChannel("/tmp/nvim.sock", "/project", async () => connection);

    connection.quickfixResponse = { error: "invalidWindow" };
    expect(await channel.quickfix({ kind: "location", window: 999 })).toMatchObject({
      error: { code: "NVIM_INVALID_WINDOW" },
      ok: false,
    });
    connection.quickfixResponse = { error: "contentLimit" };
    expect(await channel.quickfix()).toMatchObject({
      error: { code: "NVIM_LIMIT_EXCEEDED" },
      ok: false,
    });
    connection.quickfixResponse = { error: "sourceLimit" };
    expect(await channel.quickfix()).toMatchObject({
      error: { code: "NVIM_LIMIT_EXCEEDED" },
      ok: false,
    });
    expect(await channel.quickfix({ maxItems: 51 })).toMatchObject({
      error: { code: "NVIM_LIMIT_EXCEEDED" },
      ok: false,
    });
    expect(
      await channel.quickfix({ kind: "location", window: Number.MAX_SAFE_INTEGER + 1 }),
    ).toMatchObject({
      error: { code: "NVIM_INVALID_WINDOW" },
      ok: false,
    });
    expect((await channel.status()).ok).toBe(true);
  });

  test("preserves structured diagnostic failures without disabling the channel", async () => {
    const connection = new FakeConnection();
    const channel = new PiNeovimChannel("/tmp/nvim.sock", "/project", async () => connection);

    connection.diagnosticResponse = { error: "invalidBuffer" };
    expect(await channel.diagnostics(999)).toMatchObject({
      error: { code: "NVIM_INVALID_BUFFER" },
      ok: false,
    });
    connection.diagnosticResponse = { error: "diagnosticLimit" };
    expect(await channel.diagnostics(2)).toMatchObject({
      error: { code: "NVIM_LIMIT_EXCEEDED" },
      ok: false,
    });
    connection.diagnosticResponse = { error: "diagnosticSourceLimit" };
    expect(await channel.diagnosticSummary()).toMatchObject({
      error: { code: "NVIM_LIMIT_EXCEEDED" },
      ok: false,
    });
    expect((await channel.status()).ok).toBe(true);
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

    expect(bridgeLua.dispatch).toBe('\nreturn require("utils.pi_bridge").dispatch(...)\n');
    expect(bridgeOperations.activeContext).toBe("active_context");
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
    expect(connection.executeCalls).toContain(bridgeOperations.removeNotifications);
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
