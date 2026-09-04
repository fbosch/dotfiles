import { describe, expect, test } from "bun:test";
import {
  FOCUS_NOTIFICATION,
  MAX_CONTEXT_BYTES,
  MAX_CONTEXT_LINES,
  MAX_METADATA_STRING_BYTES,
  parseActiveContext,
  parseFocusNotification,
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

const focus = {
  buffer,
  cursor: { column: 3, line: 8 },
  cwd: "/project",
  pid: 42,
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

  test("contains resolved paths without prefix confusion", () => {
    expect(pathIsInsideWorktree("/project/src/example.ts", "/project")).toBe(true);
    expect(pathIsInsideWorktree("/project-copy/example.ts", "/project")).toBe(false);
    expect(pathIsInsideWorktree("", "/project")).toBe(true);
  });
});
