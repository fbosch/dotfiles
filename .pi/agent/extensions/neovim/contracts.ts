import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export const MAX_CONTEXT_LINES = 500;
export const MAX_CONTEXT_BYTES = 32 * 1024;
export const MAX_METADATA_STRING_BYTES = 4 * 1024;
export const FOCUS_NOTIFICATION = "pi:focus";

export type NeovimErrorCode =
  | "NVIM_INVALID_RESPONSE"
  | "NVIM_LIMIT_EXCEEDED"
  | "NVIM_NO_FOCUS_CONTEXT"
  | "NVIM_NO_SELECTION"
  | "NVIM_UNAVAILABLE"
  | "NVIM_WORKTREE_MISMATCH";

export interface NeovimError {
  readonly code: NeovimErrorCode;
  readonly message: string;
}

export interface BufferIdentity {
  readonly buftype: string;
  readonly filetype: string;
  readonly loaded: boolean;
  readonly modified: boolean;
  readonly name: string;
  readonly number: number;
}

export interface Position {
  readonly column: number;
  readonly line: number;
}

export interface SelectionContext {
  readonly anchor: Position;
  readonly cursor: Position;
  readonly lines: readonly string[];
  readonly mode: string;
}

export interface SelectionSnapshot extends SelectionContext {
  readonly buffer: BufferIdentity;
  readonly cwd: string;
  readonly pid: number;
}

export interface EditorIdentity {
  readonly channelId: number;
  readonly cwd: string;
  readonly pid: number;
}

export interface FocusContext {
  readonly buffer: BufferIdentity;
  readonly cursor: Position;
  readonly cwd: string;
  readonly pid: number;
  readonly selection?: SelectionContext;
}

export interface ActiveContext extends FocusContext {
  readonly mode: string;
}

export type BridgeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly error: NeovimError; readonly ok: false };

function failure(code: NeovimErrorCode, message: string): BridgeResult<never> {
  return { error: { code, message }, ok: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function isBoundedString(value: unknown, maxBytes = MAX_METADATA_STRING_BYTES): value is string {
  return typeof value === "string" && Buffer.byteLength(value, "utf8") <= maxBytes;
}

function isSelectionMode(value: unknown): value is string {
  return value === "v" || value === "V" || value === String.fromCharCode(22);
}

function isPosition(value: unknown): value is Position {
  return (
    isRecord(value) &&
    Number.isInteger(value.line) &&
    (value.line as number) >= 1 &&
    Number.isInteger(value.column) &&
    (value.column as number) >= 1
  );
}

function isBufferIdentity(value: unknown): value is BufferIdentity {
  return (
    isRecord(value) &&
    Number.isInteger(value.number) &&
    (value.number as number) >= 0 &&
    isBoundedString(value.name) &&
    typeof value.loaded === "boolean" &&
    isBoundedString(value.filetype) &&
    isBoundedString(value.buftype) &&
    typeof value.modified === "boolean"
  );
}

function selectionBytes(lines: readonly string[]): number {
  return Buffer.byteLength(lines.join("\n"), "utf8");
}

function parseSelection(value: unknown): BridgeResult<SelectionContext | undefined> {
  if (value === null || value === undefined) return { ok: true, value: undefined };
  if (isRecord(value) && value.limited === true) {
    return failure(
      "NVIM_LIMIT_EXCEEDED",
      `Neovim selection exceeds ${MAX_CONTEXT_LINES} lines or ${MAX_CONTEXT_BYTES} bytes`,
    );
  }
  if (
    isRecord(value) === false ||
    isSelectionMode(value.mode) === false ||
    isPosition(value.anchor) === false ||
    isPosition(value.cursor) === false ||
    Array.isArray(value.lines) === false ||
    value.lines.every((line) => typeof line === "string") === false
  ) {
    return failure("NVIM_INVALID_RESPONSE", "Neovim returned invalid selection data");
  }
  const lines = value.lines as string[];
  if (lines.length === 0) {
    return failure("NVIM_INVALID_RESPONSE", "Neovim returned an empty selection");
  }
  if (lines.length > MAX_CONTEXT_LINES || selectionBytes(lines) > MAX_CONTEXT_BYTES) {
    return failure(
      "NVIM_LIMIT_EXCEEDED",
      `Neovim selection exceeds ${MAX_CONTEXT_LINES} lines or ${MAX_CONTEXT_BYTES} bytes`,
    );
  }
  return {
    ok: true,
    value: {
      anchor: value.anchor,
      cursor: value.cursor,
      lines,
      mode: value.mode,
    },
  };
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

export function worktreesMatch(left: string, right: string): boolean {
  return canonicalPath(left) === canonicalPath(right);
}

export function pathIsInsideWorktree(path: string, cwd: string): boolean {
  if (path === "") return true;
  const absolutePath = canonicalPath(path);
  const absoluteCwd = canonicalPath(cwd);
  const pathFromCwd = relative(absoluteCwd, absolutePath);
  return (
    pathFromCwd === "" ||
    (pathFromCwd.startsWith("..") === false && isAbsolute(pathFromCwd) === false)
  );
}

export function parseFocusContext(value: unknown, expectedCwd: string): BridgeResult<FocusContext> {
  if (
    isRecord(value) === false ||
    Number.isInteger(value.pid) === false ||
    isBoundedString(value.cwd) === false ||
    isBufferIdentity(value.buffer) === false ||
    isPosition(value.cursor) === false
  ) {
    return failure("NVIM_INVALID_RESPONSE", "Neovim returned invalid focus context");
  }
  if (worktreesMatch(value.cwd, expectedCwd) === false) {
    return failure(
      "NVIM_WORKTREE_MISMATCH",
      "The bound Neovim instance does not match Pi's working directory",
    );
  }
  if (
    value.buffer.buftype === "" &&
    pathIsInsideWorktree(value.buffer.name, expectedCwd) === false
  ) {
    return failure("NVIM_WORKTREE_MISMATCH", "The Neovim buffer is outside Pi's worktree");
  }
  const selection = parseSelection(value.selection);
  if (selection.ok === false) return selection;
  return {
    ok: true,
    value: {
      buffer: value.buffer,
      cursor: value.cursor,
      cwd: value.cwd,
      pid: value.pid as number,
      ...(selection.value === undefined ? {} : { selection: selection.value }),
    },
  };
}

export function parseActiveContext(
  value: unknown,
  expectedCwd: string,
): BridgeResult<ActiveContext> {
  if (isRecord(value) === false || isBoundedString(value.mode, 16) === false) {
    return failure("NVIM_INVALID_RESPONSE", "Neovim returned invalid active context");
  }
  const focus = parseFocusContext(value, expectedCwd);
  if (focus.ok === false) return focus;
  return { ok: true, value: { ...focus.value, mode: value.mode } };
}

export function parseFocusNotification(
  method: string,
  args: unknown,
  expectedCwd: string,
): BridgeResult<FocusContext> | undefined {
  if (method !== FOCUS_NOTIFICATION) return undefined;
  if (Array.isArray(args) === false || args.length !== 1) {
    return failure("NVIM_INVALID_RESPONSE", "Neovim returned an invalid focus notification");
  }
  return parseFocusContext(args[0], expectedCwd);
}

export function unavailable(
  message = "No bound Neovim instance is available",
): BridgeResult<never> {
  return failure("NVIM_UNAVAILABLE", message);
}

export function noFocusContext(): BridgeResult<never> {
  return failure("NVIM_NO_FOCUS_CONTEXT", "No source focus context has been reported by Neovim");
}

export function noSelection(): BridgeResult<never> {
  return failure("NVIM_NO_SELECTION", "No source selection has been reported by Neovim");
}
