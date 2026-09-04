import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

export const MAX_CONTEXT_LINES = 500;
export const MAX_CONTEXT_BYTES = 32 * 1024;
export const MAX_INVENTORY_ITEMS = 500;
export const MAX_INVENTORY_BYTES = 32 * 1024;
export const MAX_METADATA_STRING_BYTES = 4 * 1024;
export const FOCUS_NOTIFICATION = "pi:focus";

export type NeovimErrorCode =
  | "NVIM_INVALID_BUFFER"
  | "NVIM_INVALID_RANGE"
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

export interface VisibleWindow {
  readonly bottomLine: number;
  readonly buffer: BufferIdentity;
  readonly number: number;
  readonly topLine: number;
}

export interface VisibleWindowsSnapshot {
  readonly editor: EditorIdentity;
  readonly windows: readonly VisibleWindow[];
}

export interface BufferInventory {
  readonly buffers: readonly BufferIdentity[];
  readonly editor: EditorIdentity;
}

export interface BufferReadOptions {
  readonly buffer: number;
  readonly endLine?: number;
  readonly startLine?: number;
}

export interface BufferRead {
  readonly buffer: BufferIdentity;
  readonly editor: EditorIdentity;
  readonly endLine: number;
  readonly lines: readonly string[];
  readonly startLine: number;
  readonly totalLines: number;
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

function isSourceBufferIdentity(value: unknown): value is BufferIdentity {
  return (
    isBufferIdentity(value) &&
    value.number >= 1 &&
    value.name !== "" &&
    value.buftype === "" &&
    value.filetype !== "opencode" &&
    value.filetype !== "opencode_terminal"
  );
}

function textFitsByteLimit(lines: readonly string[]): boolean {
  let bytes = Math.max(0, lines.length - 1);
  for (const line of lines) {
    bytes += Buffer.byteLength(line, "utf8");
    if (bytes > MAX_CONTEXT_BYTES) return false;
  }
  return true;
}

function sourceBufferMetadataBytes(buffer: BufferIdentity): number {
  return (
    Buffer.byteLength(buffer.name, "utf8") +
    Buffer.byteLength(buffer.filetype, "utf8") +
    Buffer.byteLength(buffer.buftype, "utf8")
  );
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
    Array.isArray(value.lines) === false
  ) {
    return failure("NVIM_INVALID_RESPONSE", "Neovim returned invalid selection data");
  }
  if (value.lines.length === 0) {
    return failure("NVIM_INVALID_RESPONSE", "Neovim returned an empty selection");
  }
  if (value.lines.length > MAX_CONTEXT_LINES) {
    return failure(
      "NVIM_LIMIT_EXCEEDED",
      `Neovim selection exceeds ${MAX_CONTEXT_LINES} lines or ${MAX_CONTEXT_BYTES} bytes`,
    );
  }
  if (value.lines.every((line) => typeof line === "string") === false) {
    return failure("NVIM_INVALID_RESPONSE", "Neovim returned invalid selection data");
  }
  const lines = value.lines as string[];
  if (textFitsByteLimit(lines) === false) {
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
  const absolutePath = resolve(path);
  let existingPath = absolutePath;
  const missingSegments: string[] = [];

  while (true) {
    try {
      return resolve(realpathSync(existingPath), ...missingSegments);
    } catch {
      const parent = dirname(existingPath);
      if (parent === existingPath) return absolutePath;
      missingSegments.unshift(basename(existingPath));
      existingPath = parent;
    }
  }
}

export function worktreesMatch(left: string, right: string): boolean {
  return canonicalPath(left) === canonicalPath(right);
}

export function pathIsInsideWorktree(path: string, cwd: string): boolean {
  if (path === "") return true;
  const absoluteCwd = canonicalPath(cwd);
  const absolutePath = canonicalPath(isAbsolute(path) ? path : resolve(absoluteCwd, path));
  const pathFromCwd = relative(absoluteCwd, absolutePath);
  return (
    pathFromCwd === "" ||
    (pathFromCwd.startsWith("..") === false && isAbsolute(pathFromCwd) === false)
  );
}

function parseBoundSnapshot(
  value: unknown,
  expectedCwd: string,
  editor: EditorIdentity,
): BridgeResult<Record<string, unknown>> {
  if (
    isRecord(value) === false ||
    Number.isInteger(value.pid) === false ||
    isBoundedString(value.cwd) === false
  ) {
    return failure("NVIM_INVALID_RESPONSE", "Neovim returned an invalid editor snapshot");
  }
  if (worktreesMatch(value.cwd, expectedCwd) === false) {
    return failure(
      "NVIM_WORKTREE_MISMATCH",
      "The bound Neovim instance does not match Pi's working directory",
    );
  }
  if (value.pid !== editor.pid || worktreesMatch(value.cwd, editor.cwd) === false) {
    return failure("NVIM_INVALID_RESPONSE", "Neovim returned a snapshot from another editor");
  }
  return { ok: true, value };
}

function parseSourceBuffer(value: unknown, expectedCwd: string): BridgeResult<BufferIdentity> {
  if (isSourceBufferIdentity(value) === false) {
    return failure("NVIM_INVALID_RESPONSE", "Neovim returned invalid source buffer data");
  }
  if (pathIsInsideWorktree(value.name, expectedCwd) === false) {
    return failure("NVIM_WORKTREE_MISMATCH", "The Neovim buffer is outside Pi's worktree");
  }
  return { ok: true, value };
}

function inventoryLimit(): BridgeResult<never> {
  return failure(
    "NVIM_LIMIT_EXCEEDED",
    `Neovim source inventory exceeds ${MAX_INVENTORY_ITEMS} entries or ${MAX_INVENTORY_BYTES} bytes`,
  );
}

function parseInventoryFailure(value: unknown): BridgeResult<never> | undefined {
  return isRecord(value) && value.error === "inventoryLimit" ? inventoryLimit() : undefined;
}

export function parseVisibleWindows(
  value: unknown,
  expectedCwd: string,
  editor: EditorIdentity,
): BridgeResult<VisibleWindowsSnapshot> {
  const inventoryFailure = parseInventoryFailure(value);
  if (inventoryFailure !== undefined) return inventoryFailure;
  const snapshot = parseBoundSnapshot(value, expectedCwd, editor);
  if (snapshot.ok === false) return snapshot;
  if (Array.isArray(snapshot.value.windows) === false) {
    return failure("NVIM_INVALID_RESPONSE", "Neovim returned invalid visible window data");
  }
  if (snapshot.value.windows.length > MAX_INVENTORY_ITEMS) return inventoryLimit();

  const windows: VisibleWindow[] = [];
  const windowNumbers = new Set<number>();
  let metadataBytes = 0;
  for (const candidate of snapshot.value.windows) {
    if (
      isRecord(candidate) === false ||
      Number.isInteger(candidate.number) === false ||
      (candidate.number as number) < 1 ||
      Number.isInteger(candidate.topLine) === false ||
      (candidate.topLine as number) < 1 ||
      Number.isInteger(candidate.bottomLine) === false ||
      (candidate.bottomLine as number) < (candidate.topLine as number)
    ) {
      return failure("NVIM_INVALID_RESPONSE", "Neovim returned invalid visible window data");
    }
    const number = candidate.number as number;
    if (windowNumbers.has(number)) {
      return failure("NVIM_INVALID_RESPONSE", "Neovim returned duplicate window identities");
    }
    const buffer = parseSourceBuffer(candidate.buffer, expectedCwd);
    if (buffer.ok === false) return buffer;
    metadataBytes += sourceBufferMetadataBytes(buffer.value) + 160;
    if (metadataBytes > MAX_INVENTORY_BYTES) return inventoryLimit();
    windowNumbers.add(number);
    windows.push({
      bottomLine: candidate.bottomLine as number,
      buffer: buffer.value,
      number,
      topLine: candidate.topLine as number,
    });
  }
  windows.sort((left, right) => left.number - right.number);
  return { ok: true, value: { editor, windows } };
}

export function parseBufferInventory(
  value: unknown,
  expectedCwd: string,
  editor: EditorIdentity,
): BridgeResult<BufferInventory> {
  const inventoryFailure = parseInventoryFailure(value);
  if (inventoryFailure !== undefined) return inventoryFailure;
  const snapshot = parseBoundSnapshot(value, expectedCwd, editor);
  if (snapshot.ok === false) return snapshot;
  if (Array.isArray(snapshot.value.buffers) === false) {
    return failure("NVIM_INVALID_RESPONSE", "Neovim returned invalid buffer inventory data");
  }
  if (snapshot.value.buffers.length > MAX_INVENTORY_ITEMS) return inventoryLimit();

  const buffers: BufferIdentity[] = [];
  const bufferNumbers = new Set<number>();
  let metadataBytes = 0;
  for (const candidate of snapshot.value.buffers) {
    const buffer = parseSourceBuffer(candidate, expectedCwd);
    if (buffer.ok === false) return buffer;
    if (bufferNumbers.has(buffer.value.number)) {
      return failure("NVIM_INVALID_RESPONSE", "Neovim returned duplicate buffer identities");
    }
    metadataBytes += sourceBufferMetadataBytes(buffer.value) + 128;
    if (metadataBytes > MAX_INVENTORY_BYTES) return inventoryLimit();
    bufferNumbers.add(buffer.value.number);
    buffers.push(buffer.value);
  }
  buffers.sort((left, right) => left.number - right.number);
  return { ok: true, value: { buffers, editor } };
}

function parseReadFailure(value: unknown): BridgeResult<never> | undefined {
  if (isRecord(value) === false || typeof value.error !== "string") return undefined;
  if (value.error === "invalidBuffer") {
    return failure(
      "NVIM_INVALID_BUFFER",
      "Choose a loaded source buffer from visible_windows or list_buffers",
    );
  }
  if (value.error === "invalidRange") {
    const suffix = Number.isInteger(value.totalLines) ? ` within 1-${value.totalLines}` : "";
    return failure("NVIM_INVALID_RANGE", `Choose a line range${suffix}`);
  }
  if (value.error === "lineLimit") {
    return failure(
      "NVIM_LIMIT_EXCEEDED",
      `Read at most ${MAX_CONTEXT_LINES} lines; narrow the requested range`,
    );
  }
  if (value.error === "byteLimit") {
    return failure(
      "NVIM_LIMIT_EXCEEDED",
      `Read at most ${MAX_CONTEXT_BYTES} bytes; narrow the requested range`,
    );
  }
  return failure("NVIM_INVALID_RESPONSE", "Neovim returned an unknown buffer read error");
}

export function parseBufferRead(
  value: unknown,
  expectedCwd: string,
  editor: EditorIdentity,
): BridgeResult<BufferRead> {
  const readFailure = parseReadFailure(value);
  if (readFailure !== undefined) return readFailure;
  const snapshot = parseBoundSnapshot(value, expectedCwd, editor);
  if (snapshot.ok === false) return snapshot;
  const buffer = parseSourceBuffer(snapshot.value.buffer, expectedCwd);
  if (buffer.ok === false) return buffer;
  if (buffer.value.loaded === false) {
    return failure("NVIM_INVALID_RESPONSE", "Neovim returned content for an unloaded buffer");
  }
  if (
    Number.isInteger(snapshot.value.startLine) === false ||
    (snapshot.value.startLine as number) < 1 ||
    Number.isInteger(snapshot.value.endLine) === false ||
    (snapshot.value.endLine as number) < (snapshot.value.startLine as number) ||
    Number.isInteger(snapshot.value.totalLines) === false ||
    (snapshot.value.totalLines as number) < (snapshot.value.endLine as number) ||
    Array.isArray(snapshot.value.lines) === false
  ) {
    return failure("NVIM_INVALID_RESPONSE", "Neovim returned invalid buffer content");
  }

  const startLine = snapshot.value.startLine as number;
  const endLine = snapshot.value.endLine as number;
  if (snapshot.value.lines.length > MAX_CONTEXT_LINES) {
    return failure(
      "NVIM_LIMIT_EXCEEDED",
      `Read at most ${MAX_CONTEXT_LINES} lines; narrow the requested range`,
    );
  }
  if (snapshot.value.lines.every((line) => typeof line === "string") === false) {
    return failure("NVIM_INVALID_RESPONSE", "Neovim returned invalid buffer content");
  }
  const lines = snapshot.value.lines as string[];
  if (lines.length !== endLine - startLine + 1) {
    return failure("NVIM_INVALID_RESPONSE", "Neovim returned an incomplete buffer range");
  }
  if (textFitsByteLimit(lines) === false) {
    return failure(
      "NVIM_LIMIT_EXCEEDED",
      `Read at most ${MAX_CONTEXT_BYTES} bytes; narrow the requested range`,
    );
  }
  return {
    ok: true,
    value: {
      buffer: buffer.value,
      editor,
      endLine,
      lines,
      startLine,
      totalLines: snapshot.value.totalLines as number,
    },
  };
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
