import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FOCUS_NOTIFICATION,
  MAX_CONTEXT_BYTES,
  MAX_CONTEXT_LINES,
  MAX_INVENTORY_ITEMS,
  MAX_METADATA_STRING_BYTES,
  parseActiveContext,
  parseBufferInventory,
  parseBufferRead,
  parseFocusNotification,
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
