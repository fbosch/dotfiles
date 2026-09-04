import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FOCUS_NOTIFICATION,
  MAX_CONTEXT_BYTES,
  MAX_CONTEXT_LINES,
  MAX_DIAGNOSTIC_BYTES,
  MAX_DIAGNOSTIC_ITEMS,
  MAX_DIAGNOSTIC_SOURCE_ITEMS,
  MAX_INVENTORY_ITEMS,
  MAX_METADATA_STRING_BYTES,
  MAX_QUICKFIX_BYTES,
  MAX_QUICKFIX_SOURCE_ITEMS,
  parseActiveContext,
  parseBufferInventory,
  parseBufferRead,
  parseDiagnosticSummary,
  parseDiagnostics,
  parseFocusNotification,
  parseQuickfix,
  parseVisibleWindows,
  pathIsInsideWorktree,
} from "../contracts";

const buffer = {
  buftype: "",
  filetype: "typescript",
  loaded: true,
  modified: true,
  name: "/project/src/example.ts",
  number: 4,
};

const editor = { channelId: 9, cwd: "/project", pid: 42 };

const focus = {
  buffer,
  cursor: { column: 3, line: 8 },
  cwd: editor.cwd,
  pid: editor.pid,
  selection: {
    anchor: { column: 1, line: 8 },
    cursor: { column: 3, line: 8 },
    lines: ["let value = 1"],
    mode: "v",
  },
};

describe("Neovim editor contracts", () => {
  test("accepts bounded active and focus context from the same worktree", () => {
    expect(parseActiveContext({ ...focus, mode: "n" }, "/project")).toEqual({
      ok: true,
      value: { ...focus, mode: "n" },
    });
    expect(parseFocusNotification(FOCUS_NOTIFICATION, [focus], "/project")).toEqual({
      ok: true,
      value: focus,
    });
  });

  test("does not expose the internal Pi terminal marker", () => {
    expect(parseActiveContext({ agentTerminalFocused: true }, "/project")).toMatchObject({
      error: { code: "NVIM_INVALID_RESPONSE" },
      ok: false,
    });
  });

  test("permits unrelated terminal metadata without treating it as source content", () => {
    const terminal = {
      ...focus,
      buffer: { ...buffer, buftype: "terminal", name: "term:///project//123:shell" },
      mode: "t",
      selection: undefined,
    };
    expect(parseActiveContext(terminal, "/project")).toMatchObject({
      ok: true,
      value: { buffer: { buftype: "terminal" }, mode: "t" },
    });
  });

  test("rejects sibling-worktree and outside-worktree context", () => {
    expect(parseFocusNotification(FOCUS_NOTIFICATION, [focus], "/project-copy")).toMatchObject({
      error: { code: "NVIM_WORKTREE_MISMATCH" },
      ok: false,
    });
    expect(
      parseFocusNotification(
        FOCUS_NOTIFICATION,
        [{ ...focus, buffer: { ...buffer, name: "/outside/secret.ts" } }],
        "/project",
      ),
    ).toMatchObject({ error: { code: "NVIM_WORKTREE_MISMATCH" }, ok: false });
  });

  test("ignores unknown notifications and rejects malformed allowlisted payloads", () => {
    expect(parseFocusNotification("unknown", [focus], "/project")).toBeUndefined();
    expect(parseFocusNotification(FOCUS_NOTIFICATION, focus, "/project")).toMatchObject({
      error: { code: "NVIM_INVALID_RESPONSE" },
      ok: false,
    });
    expect(
      parseFocusNotification(
        FOCUS_NOTIFICATION,
        [{ ...focus, buffer: { ...buffer, name: "x".repeat(MAX_METADATA_STRING_BYTES + 1) } }],
        "/project",
      ),
    ).toMatchObject({ error: { code: "NVIM_INVALID_RESPONSE" }, ok: false });
  });

  test("enforces selection line and byte bounds", () => {
    expect(
      parseFocusNotification(
        FOCUS_NOTIFICATION,
        [{ ...focus, selection: { limited: true } }],
        "/project",
      ),
    ).toMatchObject({ error: { code: "NVIM_LIMIT_EXCEEDED" }, ok: false });

    const tooManyLines = Array.from({ length: MAX_CONTEXT_LINES + 1 }, () => "x");
    expect(
      parseFocusNotification(
        FOCUS_NOTIFICATION,
        [{ ...focus, selection: { ...focus.selection, lines: tooManyLines } }],
        "/project",
      ),
    ).toMatchObject({ error: { code: "NVIM_LIMIT_EXCEEDED" }, ok: false });

    expect(
      parseFocusNotification(
        FOCUS_NOTIFICATION,
        [
          {
            ...focus,
            selection: { ...focus.selection, lines: ["x".repeat(MAX_CONTEXT_BYTES + 1)] },
          },
        ],
        "/project",
      ),
    ).toMatchObject({ error: { code: "NVIM_LIMIT_EXCEEDED" }, ok: false });
  });

  test("parses deterministic source-only buffer and window inventory", () => {
    expect(
      parseBufferInventory(
        {
          buffers: [
            { ...buffer, number: 7, modified: false },
            { ...buffer, number: 4, modified: true },
          ],
          cwd: editor.cwd,
          pid: editor.pid,
        },
        "/project",
        editor,
      ),
    ).toEqual({
      ok: true,
      value: {
        buffers: [buffer, { ...buffer, number: 7, modified: false }],
        editor,
      },
    });

    expect(
      parseVisibleWindows(
        {
          cwd: editor.cwd,
          pid: editor.pid,
          windows: [
            { bottomLine: 20, buffer, number: 12, topLine: 5 },
            { bottomLine: 8, buffer: { ...buffer, number: 7 }, number: 3, topLine: 1 },
          ],
        },
        "/project",
        editor,
      ),
    ).toEqual({
      ok: true,
      value: {
        editor,
        windows: [
          { bottomLine: 8, buffer: { ...buffer, number: 7 }, number: 3, topLine: 1 },
          { bottomLine: 20, buffer, number: 12, topLine: 5 },
        ],
      },
    });
  });

  test("rejects oversized source inventory before returning metadata", () => {
    expect(parseBufferInventory({ error: "inventoryLimit" }, "/project", editor)).toMatchObject({
      error: { code: "NVIM_LIMIT_EXCEEDED" },
      ok: false,
    });
    expect(
      parseBufferInventory(
        {
          buffers: Array.from({ length: MAX_INVENTORY_ITEMS + 1 }, (_, index) => ({
            ...buffer,
            number: index + 1,
          })),
          cwd: editor.cwd,
          pid: editor.pid,
        },
        "/project",
        editor,
      ),
    ).toMatchObject({ error: { code: "NVIM_LIMIT_EXCEEDED" }, ok: false });
  });

  test("rejects unnamed, special, duplicate, and cross-worktree inventory", () => {
    for (const invalidBuffer of [
      { ...buffer, name: "" },
      { ...buffer, buftype: "terminal", name: "term:///project//1:shell" },
      { ...buffer, name: "/outside/secret.ts" },
    ]) {
      expect(
        parseBufferInventory(
          { buffers: [invalidBuffer], cwd: editor.cwd, pid: editor.pid },
          "/project",
          editor,
        ),
      ).toMatchObject({ ok: false });
    }
    expect(
      parseBufferInventory(
        { buffers: [buffer, buffer], cwd: editor.cwd, pid: editor.pid },
        "/project",
        editor,
      ),
    ).toMatchObject({ error: { code: "NVIM_INVALID_RESPONSE" }, ok: false });
    expect(
      parseVisibleWindows(
        {
          cwd: editor.cwd,
          pid: editor.pid,
          windows: [
            {
              bottomLine: 1,
              buffer: { ...buffer, name: "/project-copy/secret.ts" },
              number: 2,
              topLine: 1,
            },
          ],
        },
        "/project",
        editor,
      ),
    ).toMatchObject({ error: { code: "NVIM_WORKTREE_MISMATCH" }, ok: false });
  });

  test("parses bounded in-memory reads and structured read failures", () => {
    const read = {
      buffer,
      cwd: editor.cwd,
      endLine: 9,
      lines: ["unsaved one", "unsaved two"],
      pid: editor.pid,
      startLine: 8,
      totalLines: 20,
    };
    expect(parseBufferRead(read, "/project", editor)).toEqual({
      ok: true,
      value: {
        buffer,
        editor,
        endLine: 9,
        lines: ["unsaved one", "unsaved two"],
        startLine: 8,
        totalLines: 20,
      },
    });
    expect(parseBufferRead({ error: "invalidBuffer" }, "/project", editor)).toMatchObject({
      error: { code: "NVIM_INVALID_BUFFER" },
      ok: false,
    });
    expect(parseBufferRead({ error: "invalidRange", totalLines: 20 }, "/project", editor)).toEqual({
      error: { code: "NVIM_INVALID_RANGE", message: "Choose a line range within 1-20" },
      ok: false,
    });
    expect(parseBufferRead({ error: "lineLimit" }, "/project", editor)).toMatchObject({
      error: { code: "NVIM_LIMIT_EXCEEDED" },
      ok: false,
    });
    expect(parseBufferRead({ error: "byteLimit" }, "/project", editor)).toMatchObject({
      error: { code: "NVIM_LIMIT_EXCEEDED" },
      ok: false,
    });
  });

  test("defensively enforces response line and UTF-8 byte bounds", () => {
    const response = {
      buffer,
      cwd: editor.cwd,
      endLine: 1,
      pid: editor.pid,
      startLine: 1,
      totalLines: 1,
    };
    expect(
      parseBufferRead(
        {
          ...response,
          endLine: MAX_CONTEXT_LINES + 1,
          lines: Array(MAX_CONTEXT_LINES + 1).fill("x"),
          totalLines: MAX_CONTEXT_LINES + 1,
        },
        "/project",
        editor,
      ),
    ).toMatchObject({ error: { code: "NVIM_LIMIT_EXCEEDED" }, ok: false });
    expect(
      parseBufferRead(
        { ...response, lines: ["é".repeat(MAX_CONTEXT_BYTES / 2)] },
        "/project",
        editor,
      ),
    ).toMatchObject({ ok: true });
    expect(
      parseBufferRead(
        { ...response, lines: [`${"é".repeat(MAX_CONTEXT_BYTES / 2)}x`] },
        "/project",
        editor,
      ),
    ).toMatchObject({ error: { code: "NVIM_LIMIT_EXCEEDED" }, ok: false });
  });

  test("parses ordered Neovim diagnostic summaries with one-based ranges", () => {
    const diagnostics = [
      {
        end: { column: 2, line: 3 },
        message: "hint",
        severity: "hint",
        source: "editor-lint",
        start: { column: 1, line: 3 },
      },
      {
        end: { column: 9, line: 1 },
        message: "warning",
        severity: "warning",
        source: "editor-lint",
        start: { column: 5, line: 1 },
      },
      {
        end: { column: 4, line: 1 },
        message: "error",
        severity: "error",
        source: "neovim-lsp",
        start: { column: 2, line: 1 },
      },
    ] as const;
    expect(
      parseDiagnosticSummary(
        {
          buffer,
          counts: { error: 1, hint: 1, information: 0, total: 3, warning: 1 },
          cwd: editor.cwd,
          diagnostics,
          pid: editor.pid,
          truncated: false,
        },
        "/project",
        editor,
        3,
      ),
    ).toEqual({
      ok: true,
      value: {
        buffer,
        counts: { error: 1, hint: 1, information: 0, total: 3, warning: 1 },
        diagnostics: [diagnostics[2], diagnostics[1], diagnostics[0]],
        editor,
        truncated: false,
      },
    });
  });

  test("uses deterministic UTF-8 ordering for equal diagnostic locations", () => {
    const diagnostic = {
      end: { column: 2, line: 1 },
      message: "same",
      severity: "error" as const,
      start: { column: 1, line: 1 },
    };
    const result = parseDiagnostics(
      {
        buffer,
        counts: { error: 2, hint: 0, information: 0, total: 2, warning: 0 },
        cwd: editor.cwd,
        diagnostics: [
          { ...diagnostic, source: "ä" },
          { ...diagnostic, source: "z" },
        ],
        pid: editor.pid,
        truncated: false,
      },
      "/project",
      editor,
    );
    expect(result).toMatchObject({
      ok: true,
      value: { diagnostics: [{ source: "z" }, { source: "ä" }] },
    });
  });

  test("parses complete diagnostics and rejects incomplete or malformed reports", () => {
    const diagnostic = {
      end: { column: 4, line: 1 },
      message: "error",
      severity: "error" as const,
      source: "neovim-lsp",
      start: { column: 2, line: 1 },
    };
    const response = {
      buffer,
      counts: { error: 1, hint: 0, information: 0, total: 1, warning: 0 },
      cwd: editor.cwd,
      diagnostics: [diagnostic],
      pid: editor.pid,
      truncated: false,
    };
    expect(parseDiagnostics(response, "/project", editor)).toEqual({
      ok: true,
      value: { buffer, diagnostics: [diagnostic], editor, total: 1 },
    });
    expect(
      parseDiagnostics({ ...response, diagnostics: [], truncated: true }, "/project", editor),
    ).toMatchObject({ error: { code: "NVIM_INVALID_RESPONSE" }, ok: false });
    expect(
      parseDiagnostics(
        { ...response, diagnostics: [{ ...diagnostic, severity: "fatal" }] },
        "/project",
        editor,
      ),
    ).toMatchObject({ error: { code: "NVIM_INVALID_RESPONSE" }, ok: false });
    expect(
      parseDiagnostics(
        { ...response, diagnostics: [{ ...diagnostic, end: { column: 1, line: 1 } }] },
        "/project",
        editor,
      ),
    ).toMatchObject({ error: { code: "NVIM_INVALID_RESPONSE" }, ok: false });
  });

  test("preserves diagnostic buffer, worktree, item, and byte limit errors", () => {
    expect(parseDiagnostics({ error: "invalidBuffer" }, "/project", editor)).toMatchObject({
      error: { code: "NVIM_INVALID_BUFFER" },
      ok: false,
    });
    expect(parseDiagnostics({ error: "diagnosticLimit" }, "/project", editor)).toMatchObject({
      error: { code: "NVIM_LIMIT_EXCEEDED" },
      ok: false,
    });
    expect(
      parseDiagnosticSummary({ error: "diagnosticSourceLimit" }, "/project", editor),
    ).toMatchObject({ error: { code: "NVIM_LIMIT_EXCEEDED" }, ok: false });
    expect(
      parseDiagnostics(
        {
          buffer: { ...buffer, name: "/outside/secret.ts" },
          counts: { error: 0, hint: 0, information: 0, total: 0, warning: 0 },
          cwd: editor.cwd,
          diagnostics: [],
          pid: editor.pid,
          truncated: false,
        },
        "/project",
        editor,
      ),
    ).toMatchObject({ error: { code: "NVIM_WORKTREE_MISMATCH" }, ok: false });

    const diagnostic = {
      end: { column: 2, line: 1 },
      message: "x",
      severity: "error" as const,
      source: "test",
      start: { column: 1, line: 1 },
    };
    expect(
      parseDiagnostics(
        {
          buffer,
          counts: {
            error: MAX_DIAGNOSTIC_ITEMS + 1,
            hint: 0,
            information: 0,
            total: MAX_DIAGNOSTIC_ITEMS + 1,
            warning: 0,
          },
          cwd: editor.cwd,
          diagnostics: Array(MAX_DIAGNOSTIC_ITEMS + 1).fill(diagnostic),
          pid: editor.pid,
          truncated: false,
        },
        "/project",
        editor,
      ),
    ).toMatchObject({ error: { code: "NVIM_LIMIT_EXCEEDED" }, ok: false });

    const oversizedDiagnostics = Array.from({ length: 9 }, () => ({
      ...diagnostic,
      message: "x".repeat(MAX_METADATA_STRING_BYTES),
    }));
    expect(
      parseDiagnostics(
        {
          buffer,
          counts: { error: 9, hint: 0, information: 0, total: 9, warning: 0 },
          cwd: editor.cwd,
          diagnostics: oversizedDiagnostics,
          pid: editor.pid,
          truncated: false,
        },
        "/project",
        editor,
      ),
    ).toMatchObject({
      error: {
        code: "NVIM_LIMIT_EXCEEDED",
        message: expect.stringContaining(String(MAX_DIAGNOSTIC_BYTES)),
      },
      ok: false,
    });
  });

  test("enforces diagnostic summary item limits and count consistency", () => {
    const diagnostic = {
      end: { column: 2, line: 1 },
      message: "error",
      severity: "error" as const,
      source: "test",
      start: { column: 1, line: 1 },
    };
    const response = {
      buffer,
      counts: { error: 2, hint: 0, information: 0, total: 2, warning: 0 },
      cwd: editor.cwd,
      diagnostics: [diagnostic],
      pid: editor.pid,
      truncated: true,
    };
    expect(parseDiagnosticSummary(response, "/project", editor, 1)).toMatchObject({ ok: true });
    expect(
      parseDiagnosticSummary(
        {
          ...response,
          counts: {
            error: MAX_DIAGNOSTIC_SOURCE_ITEMS + 1,
            hint: 0,
            information: 0,
            total: MAX_DIAGNOSTIC_SOURCE_ITEMS + 1,
            warning: 0,
          },
        },
        "/project",
        editor,
        1,
      ),
    ).toMatchObject({ error: { code: "NVIM_LIMIT_EXCEEDED" }, ok: false });
    expect(
      parseDiagnosticSummary(
        { ...response, diagnostics: [diagnostic, diagnostic] },
        "/project",
        editor,
        1,
      ),
    ).toMatchObject({ error: { code: "NVIM_INVALID_RESPONSE" }, ok: false });
    expect(
      parseDiagnosticSummary(
        {
          ...response,
          counts: { error: 1, hint: 0, information: 0, total: 2, warning: 0 },
        },
        "/project",
        editor,
        1,
      ),
    ).toMatchObject({ error: { code: "NVIM_INVALID_RESPONSE" }, ok: false });
  });

  test("parses ordered problem lists with explicit ownership and source positions", () => {
    const item = {
      buffer: 4,
      column: 5,
      endColumn: 9,
      endLine: 8,
      filename: "/project/src/example.ts",
      line: 8,
      text: "problem",
      type: "E",
      valid: true,
    };
    expect(
      parseQuickfix(
        {
          cwd: editor.cwd,
          items: [item],
          owner: { kind: "location", listId: 3, window: 12 },
          pid: editor.pid,
          title: "location fixture",
          total: 2,
          truncated: true,
        },
        "/project",
        editor,
        { kind: "location", maxItems: 1, window: 12 },
      ),
    ).toEqual({
      ok: true,
      value: {
        editor,
        items: [item],
        owner: { kind: "location", listId: 3, window: 12 },
        title: "location fixture",
        total: 2,
        truncated: true,
      },
    });
  });

  test("rejects invalid problem-list owners, bounds, paths, and output sizes", () => {
    const item = {
      buffer: 4,
      column: 1,
      endColumn: 0,
      endLine: 0,
      filename: "/project/src/example.ts",
      line: 1,
      text: "problem",
      type: "E",
      valid: true,
    };
    const response = {
      cwd: editor.cwd,
      items: [item],
      owner: { kind: "quickfix", listId: 1 },
      pid: editor.pid,
      title: "quickfix fixture",
      total: 1,
      truncated: false,
    };
    expect(
      parseQuickfix({ error: "invalidWindow" }, "/project", editor, {
        kind: "location",
        window: 999,
      }),
    ).toMatchObject({ error: { code: "NVIM_INVALID_WINDOW" }, ok: false });
    expect(parseQuickfix({ error: "sourceLimit" }, "/project", editor)).toMatchObject({
      error: { code: "NVIM_LIMIT_EXCEEDED" },
      ok: false,
    });
    expect(
      parseQuickfix(
        { ...response, total: MAX_QUICKFIX_SOURCE_ITEMS + 1, truncated: true },
        "/project",
        editor,
      ),
    ).toMatchObject({ error: { code: "NVIM_LIMIT_EXCEEDED" }, ok: false });
    expect(parseQuickfix({ ...response, items: [item, item] }, "/project", editor)).toMatchObject({
      error: { code: "NVIM_INVALID_RESPONSE" },
      ok: false,
    });
    for (const filename of [
      "/outside/secret.ts",
      "term:///outside/secret",
      "file:///project/src/example.ts",
    ]) {
      expect(
        parseQuickfix({ ...response, items: [{ ...item, filename }] }, "/project", editor),
      ).toMatchObject({ error: { code: "NVIM_WORKTREE_MISMATCH" }, ok: false });
    }
    expect(
      parseQuickfix(
        {
          ...response,
          items: [{ ...item, text: "\n".repeat(MAX_QUICKFIX_BYTES / 2) }],
        },
        "/project",
        editor,
      ),
    ).toMatchObject({ error: { code: "NVIM_LIMIT_EXCEEDED" }, ok: false });
  });

  test("contains resolved paths without prefix confusion", () => {
    expect(pathIsInsideWorktree("/project/src/example.ts", "/project")).toBe(true);
    expect(pathIsInsideWorktree("/project-copy/example.ts", "/project")).toBe(false);
    expect(pathIsInsideWorktree("", "/project")).toBe(true);
  });

  test("rejects nonexistent paths beneath a symlink to another worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-neovim-containment-"));
    const worktree = join(root, "worktree");
    const outside = join(root, "outside");
    await Promise.all([mkdir(worktree), mkdir(outside)]);
    await symlink(outside, join(worktree, "linked"));

    try {
      expect(pathIsInsideWorktree(join(worktree, "linked", "nested", "new.ts"), worktree)).toBe(
        false,
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
