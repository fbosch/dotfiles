import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

export const MAX_CONTEXT_LINES = 500;
export const MAX_CONTEXT_BYTES = 32 * 1024;
export const MAX_INVENTORY_ITEMS = 500;
export const MAX_INVENTORY_BYTES = 32 * 1024;
export const DEFAULT_DIAGNOSTIC_SUMMARY_ITEMS = 20;
export const MAX_DIAGNOSTIC_SUMMARY_ITEMS = 50;
export const MAX_DIAGNOSTIC_ITEMS = 500;
export const MAX_DIAGNOSTIC_SOURCE_ITEMS = 5_000;
export const MAX_DIAGNOSTIC_BYTES = 32 * 1024;
export const DEFAULT_QUICKFIX_ITEMS = 20;
export const MAX_QUICKFIX_ITEMS = 50;
export const MAX_QUICKFIX_SOURCE_ITEMS = 5_000;
export const MAX_QUICKFIX_BYTES = 32 * 1024;
export const DEFAULT_HIGHLIGHT_DURATION_MS = 2_000;
export const MAX_HIGHLIGHT_DURATION_MS = 30_000;
export const MAX_HIGHLIGHT_LINES = 500;
export const DEFAULT_ANNOTATION_DURATION_MS = 2_000;
export const MAX_ANNOTATION_DURATION_MS = 30_000;
export const MAX_ANNOTATIONS = 10;
export const MAX_ANNOTATION_ANCHOR_BYTES = 512;
export const MAX_ANNOTATION_TEXT_BYTES = 256;
export const MAX_ANNOTATION_SEARCH_LINES = 1_000;
export const MAX_ANNOTATION_SEARCH_BYTES = 256 * 1024;
export const MAX_ACTIVE_ANNOTATIONS = 50;
export const MAX_METADATA_STRING_BYTES = 4 * 1024;
export const FOCUS_NOTIFICATION = "pi:focus";

export type NeovimErrorCode =
  | "NVIM_AMBIGUOUS_ANCHOR"
  | "NVIM_CONTEXT_STALE"
  | "NVIM_INVALID_ANNOTATION"
  | "NVIM_INVALID_BUFFER"
  | "NVIM_INVALID_RANGE"
  | "NVIM_INVALID_RESPONSE"
  | "NVIM_INVALID_WINDOW"
  | "NVIM_LIMIT_EXCEEDED"
  | "NVIM_NO_FOCUS_CONTEXT"
  | "NVIM_NO_SELECTION"
  | "NVIM_STALE_ANCHOR"
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
  readonly expectedChangedtick?: number;
  readonly expectedPath?: string;
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

export type DiagnosticSeverity = "error" | "warning" | "information" | "hint";

export interface NeovimDiagnostic {
  readonly end: Position;
  readonly message: string;
  readonly severity: DiagnosticSeverity;
  readonly source: string;
  readonly start: Position;
}

export interface DiagnosticCounts {
  readonly error: number;
  readonly hint: number;
  readonly information: number;
  readonly total: number;
  readonly warning: number;
}

export interface DiagnosticSummaryOptions {
  readonly buffer?: number;
  readonly maxItems?: number;
}

export interface DiagnosticSummary {
  readonly buffer: BufferIdentity;
  readonly counts: DiagnosticCounts;
  readonly diagnostics: readonly NeovimDiagnostic[];
  readonly editor: EditorIdentity;
  readonly truncated: boolean;
}

export interface DiagnosticsSnapshot {
  readonly buffer: BufferIdentity;
  readonly diagnostics: readonly NeovimDiagnostic[];
  readonly editor: EditorIdentity;
  readonly total: number;
}

export type QuickfixOptions =
  | {
      readonly kind?: "quickfix";
      readonly maxItems?: number;
    }
  | {
      readonly kind: "location";
      readonly maxItems?: number;
      readonly window: number;
    };

export type QuickfixOwner =
  | {
      readonly kind: "quickfix";
      readonly listId: number;
    }
  | {
      readonly kind: "location";
      readonly listId: number;
      readonly window: number;
    };

export interface QuickfixItem {
  readonly buffer: number;
  readonly column: number;
  readonly endColumn: number;
  readonly endLine: number;
  readonly filename: string;
  readonly line: number;
  readonly text: string;
  readonly type: string;
  readonly valid: boolean;
}

export interface QuickfixSnapshot {
  readonly editor: EditorIdentity;
  readonly items: readonly QuickfixItem[];
  readonly owner: QuickfixOwner;
  readonly title: string;
  readonly total: number;
  readonly truncated: boolean;
}

export type RevealSplit = "horizontal" | "none" | "vertical";

export interface RevealOptions {
  readonly buffer: number;
  readonly column: number;
  readonly focus?: boolean;
  readonly line: number;
  readonly split?: RevealSplit;
}

export interface ResolvedRevealOptions extends RevealOptions {
  readonly focus: boolean;
  readonly split: RevealSplit;
}

export interface RevealSnapshot {
  readonly buffer: BufferIdentity;
  readonly editor: EditorIdentity;
  readonly focused: boolean;
  readonly focusPreserved: boolean;
  readonly position: Position;
  readonly split: RevealSplit;
  readonly splitCreated: boolean;
  readonly window: number;
}

export interface HighlightOptions {
  readonly buffer: number;
  readonly durationMs?: number;
  readonly endColumn?: number;
  readonly endLine?: number;
  readonly startColumn?: number;
  readonly startLine: number;
}

export interface ResolvedHighlightOptions {
  readonly buffer: number;
  readonly durationMs: number;
  readonly endColumn: number | undefined;
  readonly endLine: number;
  readonly startColumn: number;
  readonly startLine: number;
}

export interface HighlightSnapshot {
  readonly buffer: BufferIdentity;
  readonly editor: EditorIdentity;
  readonly end: Position;
  readonly expiresInMs: number;
  readonly highlightId: number;
  readonly start: Position;
}

export interface HighlightClearOptions {
  readonly buffer: number;
  readonly highlightId: number;
}

export interface HighlightClearSnapshot {
  readonly buffer: BufferIdentity;
  readonly cleared: boolean;
  readonly editor: EditorIdentity;
  readonly highlightId: number;
}

export type AnnotationKind = "note" | "warning" | "error";

export interface SourceAnnotationInput {
  readonly anchor: string;
  readonly kind: AnnotationKind;
  readonly line: number;
  readonly text: string;
}

export interface AnnotationOptions {
  readonly annotations: readonly SourceAnnotationInput[];
  readonly buffer: number;
  readonly durationMs?: number;
}

export interface ResolvedAnnotationOptions {
  readonly annotations: readonly SourceAnnotationInput[];
  readonly buffer: number;
  readonly durationMs: number;
}

export interface SourceAnnotation {
  readonly annotationId: number;
  readonly column: number;
  readonly inputIndex: number;
  readonly kind: AnnotationKind;
  readonly line: number;
  readonly placement: "callout";
  readonly text: string;
}

export interface AnnotationSnapshot {
  readonly annotations: readonly SourceAnnotation[];
  readonly batchId: number;
  readonly buffer: BufferIdentity;
  readonly editor: EditorIdentity;
  readonly expiresInMs: number;
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
    Number.isSafeInteger(value.line) &&
    (value.line as number) >= 1 &&
    Number.isSafeInteger(value.column) &&
    (value.column as number) >= 1
  );
}

function isRevealSplit(value: unknown): value is RevealSplit {
  return value === "none" || value === "horizontal" || value === "vertical";
}

function isAnnotationKind(value: unknown): value is AnnotationKind {
  return value === "note" || value === "warning" || value === "error";
}

function containsAnnotationControlCharacter(value: string): boolean {
  return /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
}

export function resolveAnnotationOptions(
  options: AnnotationOptions,
): BridgeResult<ResolvedAnnotationOptions> {
  if (Number.isSafeInteger(options.buffer) === false || options.buffer < 1) {
    return failure(
      "NVIM_INVALID_BUFFER",
      "Choose a loaded source buffer from visible_windows or list_buffers",
    );
  }
  if (
    Array.isArray(options.annotations) === false ||
    options.annotations.length < 1 ||
    options.annotations.length > MAX_ANNOTATIONS
  ) {
    return failure("NVIM_LIMIT_EXCEEDED", `Annotate between 1 and ${MAX_ANNOTATIONS} anchors`);
  }
  const durationMs = options.durationMs ?? DEFAULT_ANNOTATION_DURATION_MS;
  if (Number.isSafeInteger(durationMs) === false || durationMs < 1) {
    return failure("NVIM_INVALID_ANNOTATION", "Choose a positive annotation duration");
  }
  if (durationMs > MAX_ANNOTATION_DURATION_MS) {
    return failure(
      "NVIM_LIMIT_EXCEEDED",
      `Annotation duration must not exceed ${MAX_ANNOTATION_DURATION_MS} ms`,
    );
  }
  for (let index = 0; index < options.annotations.length; index += 1) {
    const annotation: unknown = options.annotations[index];
    if (
      isRecord(annotation) === false ||
      Number.isSafeInteger(annotation.line) === false ||
      (annotation.line as number) < 1 ||
      typeof annotation.anchor !== "string" ||
      annotation.anchor.length < 1 ||
      Buffer.byteLength(annotation.anchor, "utf8") > MAX_ANNOTATION_ANCHOR_BYTES ||
      /[\0\r\n]/u.test(annotation.anchor) ||
      typeof annotation.text !== "string" ||
      annotation.text.trim().length < 1 ||
      Buffer.byteLength(annotation.text, "utf8") > MAX_ANNOTATION_TEXT_BYTES ||
      containsAnnotationControlCharacter(annotation.text) ||
      isAnnotationKind(annotation.kind) === false
    ) {
      return failure(
        "NVIM_INVALID_ANNOTATION",
        `Annotation ${index + 1} must have a bounded line, anchor, text, and kind`,
      );
    }
  }
  return {
    ok: true,
    value: { annotations: options.annotations, buffer: options.buffer, durationMs },
  };
}

export function resolveHighlightOptions(
  options: HighlightOptions,
): BridgeResult<ResolvedHighlightOptions> {
  if (Number.isSafeInteger(options.buffer) === false || options.buffer < 1) {
    return failure(
      "NVIM_INVALID_BUFFER",
      "Choose a loaded source buffer from visible_windows or list_buffers",
    );
  }
  const startColumn = options.startColumn ?? 1;
  const endLine = options.endLine ?? options.startLine;
  const durationMs = options.durationMs ?? DEFAULT_HIGHLIGHT_DURATION_MS;
  if (
    Number.isSafeInteger(options.startLine) === false ||
    options.startLine < 1 ||
    Number.isSafeInteger(startColumn) === false ||
    startColumn < 1 ||
    Number.isSafeInteger(endLine) === false ||
    endLine < options.startLine ||
    (options.endColumn !== undefined &&
      (Number.isSafeInteger(options.endColumn) === false || options.endColumn < 1)) ||
    Number.isSafeInteger(durationMs) === false ||
    durationMs < 1
  ) {
    return failure("NVIM_INVALID_RANGE", "Choose a valid positive highlight range and duration");
  }
  if (endLine - options.startLine + 1 > MAX_HIGHLIGHT_LINES) {
    return failure("NVIM_LIMIT_EXCEEDED", `Highlight at most ${MAX_HIGHLIGHT_LINES} lines`);
  }
  if (durationMs > MAX_HIGHLIGHT_DURATION_MS) {
    return failure(
      "NVIM_LIMIT_EXCEEDED",
      `Highlight duration must not exceed ${MAX_HIGHLIGHT_DURATION_MS} ms`,
    );
  }
  if (
    endLine === options.startLine &&
    options.endColumn !== undefined &&
    options.endColumn <= startColumn
  ) {
    return failure("NVIM_INVALID_RANGE", "Choose a non-empty highlight range");
  }
  return {
    ok: true,
    value: {
      buffer: options.buffer,
      durationMs,
      endColumn: options.endColumn,
      endLine,
      startColumn,
      startLine: options.startLine,
    },
  };
}

export function resolveHighlightClearOptions(
  options: HighlightClearOptions,
): BridgeResult<HighlightClearOptions> {
  if (Number.isSafeInteger(options.buffer) === false || options.buffer < 1) {
    return failure("NVIM_INVALID_BUFFER", "Choose the buffer that owns the highlight");
  }
  if (Number.isSafeInteger(options.highlightId) === false || options.highlightId < 1) {
    return failure("NVIM_INVALID_RANGE", "Choose a positive bridge-owned highlight ID");
  }
  return { ok: true, value: options };
}

export function resolveRevealOptions(options: RevealOptions): BridgeResult<ResolvedRevealOptions> {
  if (Number.isSafeInteger(options.buffer) === false || options.buffer < 1) {
    return failure(
      "NVIM_INVALID_BUFFER",
      "Choose a loaded source buffer from visible_windows or list_buffers",
    );
  }
  if (
    Number.isSafeInteger(options.line) === false ||
    options.line < 1 ||
    Number.isSafeInteger(options.column) === false ||
    options.column < 1
  ) {
    return failure("NVIM_INVALID_RANGE", "Choose a positive one-based line and column");
  }
  const focus = options.focus ?? false;
  const split = options.split ?? "none";
  if (typeof focus !== "boolean" || isRevealSplit(split) === false) {
    return failure("NVIM_INVALID_RESPONSE", "Invalid reveal focus or split option");
  }
  return {
    ok: true,
    value: {
      buffer: options.buffer,
      column: options.column,
      focus,
      line: options.line,
      split,
    },
  };
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

function canonicalPath(path: string): string | undefined {
  if (/^[A-Za-z][A-Za-z\d+.-]*:/u.test(path)) return undefined;
  let existingPath = resolve(path);
  const missingSegments: string[] = [];

  while (true) {
    try {
      return resolve(realpathSync(existingPath), ...missingSegments);
    } catch {
      try {
        lstatSync(existingPath);
        return undefined;
      } catch (error) {
        if (isRecord(error) === false || error.code !== "ENOENT") return undefined;
      }
      const parent = dirname(existingPath);
      if (parent === existingPath) return undefined;
      missingSegments.unshift(basename(existingPath));
      existingPath = parent;
    }
  }
}

export function worktreesMatch(left: string, right: string): boolean {
  const canonicalLeft = canonicalPath(left);
  return canonicalLeft !== undefined && canonicalLeft === canonicalPath(right);
}

export function pathIsCanonical(path: string): boolean {
  return isAbsolute(path) && canonicalPath(path) === path;
}

export function pathIsInsideWorktree(path: string, cwd: string): boolean {
  if (path === "") return true;
  const absoluteCwd = canonicalPath(cwd);
  if (absoluteCwd === undefined) return false;
  const absolutePath = canonicalPath(isAbsolute(path) ? path : resolve(absoluteCwd, path));
  if (absolutePath === undefined) return false;
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
  if (value.error === "contextStale") {
    return failure(
      "NVIM_CONTEXT_STALE",
      "The Neovim context is stale; refresh context and retry read_buffer",
    );
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

const DIAGNOSTIC_SEVERITY_ORDER: Record<DiagnosticSeverity, number> = {
  error: 1,
  warning: 2,
  information: 3,
  hint: 4,
};

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function diagnosticLimit(): BridgeResult<never> {
  return failure(
    "NVIM_LIMIT_EXCEEDED",
    `Neovim diagnostics exceed ${MAX_DIAGNOSTIC_ITEMS} detailed items or ${MAX_DIAGNOSTIC_BYTES} output bytes; request fewer summary items or reduce diagnostics in the editor`,
  );
}

function diagnosticSourceLimit(): BridgeResult<never> {
  return failure(
    "NVIM_LIMIT_EXCEEDED",
    `Neovim reports more than ${MAX_DIAGNOSTIC_SOURCE_ITEMS} diagnostics for this buffer; reduce diagnostics in the editor`,
  );
}

function diagnosticFailure(value: unknown): BridgeResult<never> | undefined {
  if (isRecord(value) === false || typeof value.error !== "string") return undefined;
  if (value.error === "invalidBuffer") {
    return failure(
      "NVIM_INVALID_BUFFER",
      "Choose a loaded source buffer from visible_windows or list_buffers",
    );
  }
  if (value.error === "diagnosticLimit") return diagnosticLimit();
  if (value.error === "diagnosticSourceLimit") return diagnosticSourceLimit();
  if (value.error === "invalidDiagnostics") {
    return failure("NVIM_INVALID_RESPONSE", "Neovim returned invalid diagnostic data");
  }
  return failure("NVIM_INVALID_RESPONSE", "Neovim returned an unknown diagnostic error");
}

function parseDiagnosticCounts(value: unknown): DiagnosticCounts | undefined {
  if (
    isRecord(value) === false ||
    isNonNegativeInteger(value.error) === false ||
    isNonNegativeInteger(value.warning) === false ||
    isNonNegativeInteger(value.information) === false ||
    isNonNegativeInteger(value.hint) === false ||
    isNonNegativeInteger(value.total) === false ||
    value.total !== value.error + value.warning + value.information + value.hint
  ) {
    return undefined;
  }
  return {
    error: value.error,
    hint: value.hint,
    information: value.information,
    total: value.total,
    warning: value.warning,
  };
}

function parseDiagnostic(value: unknown): NeovimDiagnostic | undefined {
  if (
    isRecord(value) === false ||
    isPosition(value.start) === false ||
    isPosition(value.end) === false ||
    (value.severity !== "error" &&
      value.severity !== "warning" &&
      value.severity !== "information" &&
      value.severity !== "hint") ||
    isBoundedString(value.message) === false ||
    isBoundedString(value.source) === false ||
    value.end.line < value.start.line ||
    (value.end.line === value.start.line && value.end.column < value.start.column)
  ) {
    return undefined;
  }
  return {
    end: value.end,
    message: value.message,
    severity: value.severity,
    source: value.source,
    start: value.start,
  };
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function compareDiagnostics(left: NeovimDiagnostic, right: NeovimDiagnostic): number {
  return (
    DIAGNOSTIC_SEVERITY_ORDER[left.severity] - DIAGNOSTIC_SEVERITY_ORDER[right.severity] ||
    left.start.line - right.start.line ||
    left.start.column - right.start.column ||
    left.end.line - right.end.line ||
    left.end.column - right.end.column ||
    compareUtf8(left.source, right.source) ||
    compareUtf8(left.message, right.message)
  );
}

interface ParsedDiagnosticSnapshot {
  readonly buffer: BufferIdentity;
  readonly counts: DiagnosticCounts;
  readonly diagnostics: readonly NeovimDiagnostic[];
  readonly truncated: boolean;
}

function parseDiagnosticSnapshot(
  value: unknown,
  expectedCwd: string,
  editor: EditorIdentity,
): BridgeResult<ParsedDiagnosticSnapshot> {
  const responseFailure = diagnosticFailure(value);
  if (responseFailure !== undefined) return responseFailure;
  const snapshot = parseBoundSnapshot(value, expectedCwd, editor);
  if (snapshot.ok === false) return snapshot;
  const buffer = parseSourceBuffer(snapshot.value.buffer, expectedCwd);
  if (buffer.ok === false) return buffer;
  if (buffer.value.loaded === false) {
    return failure("NVIM_INVALID_RESPONSE", "Neovim returned diagnostics for an unloaded buffer");
  }
  const counts = parseDiagnosticCounts(snapshot.value.counts);
  if (counts !== undefined && counts.total > MAX_DIAGNOSTIC_SOURCE_ITEMS) {
    return diagnosticSourceLimit();
  }
  if (
    Array.isArray(snapshot.value.diagnostics) &&
    snapshot.value.diagnostics.length > MAX_DIAGNOSTIC_ITEMS
  ) {
    return diagnosticLimit();
  }
  if (
    counts === undefined ||
    Array.isArray(snapshot.value.diagnostics) === false ||
    typeof snapshot.value.truncated !== "boolean" ||
    snapshot.value.diagnostics.length > counts.total ||
    snapshot.value.truncated !== snapshot.value.diagnostics.length < counts.total
  ) {
    return failure("NVIM_INVALID_RESPONSE", "Neovim returned invalid diagnostic data");
  }

  const diagnostics: NeovimDiagnostic[] = [];
  let bytes = sourceBufferMetadataBytes(buffer.value) + 512;
  for (const candidate of snapshot.value.diagnostics) {
    const diagnostic = parseDiagnostic(candidate);
    if (diagnostic === undefined) {
      return failure("NVIM_INVALID_RESPONSE", "Neovim returned invalid diagnostic data");
    }
    bytes +=
      Buffer.byteLength(diagnostic.message, "utf8") +
      Buffer.byteLength(diagnostic.source, "utf8") +
      128;
    if (bytes > MAX_DIAGNOSTIC_BYTES) {
      return failure(
        "NVIM_LIMIT_EXCEEDED",
        `Neovim diagnostics exceed ${MAX_DIAGNOSTIC_BYTES} bytes; use diagnostic_summary with fewer items`,
      );
    }
    diagnostics.push(diagnostic);
  }
  diagnostics.sort(compareDiagnostics);
  return {
    ok: true,
    value: {
      buffer: buffer.value,
      counts,
      diagnostics,
      truncated: snapshot.value.truncated,
    },
  };
}

export function parseDiagnosticSummary(
  value: unknown,
  expectedCwd: string,
  editor: EditorIdentity,
  maxItems = DEFAULT_DIAGNOSTIC_SUMMARY_ITEMS,
): BridgeResult<DiagnosticSummary> {
  if (
    Number.isInteger(maxItems) === false ||
    maxItems < 1 ||
    maxItems > MAX_DIAGNOSTIC_SUMMARY_ITEMS
  ) {
    return failure("NVIM_INVALID_RESPONSE", "Invalid diagnostic summary item limit");
  }
  const snapshot = parseDiagnosticSnapshot(value, expectedCwd, editor);
  if (snapshot.ok === false) return snapshot;
  if (snapshot.value.diagnostics.length > maxItems) {
    return failure("NVIM_INVALID_RESPONSE", "Neovim exceeded the diagnostic summary item limit");
  }
  return {
    ok: true,
    value: {
      buffer: snapshot.value.buffer,
      counts: snapshot.value.counts,
      diagnostics: snapshot.value.diagnostics,
      editor,
      truncated: snapshot.value.truncated,
    },
  };
}

export function parseDiagnostics(
  value: unknown,
  expectedCwd: string,
  editor: EditorIdentity,
): BridgeResult<DiagnosticsSnapshot> {
  const snapshot = parseDiagnosticSnapshot(value, expectedCwd, editor);
  if (snapshot.ok === false) return snapshot;
  if (
    snapshot.value.truncated ||
    snapshot.value.diagnostics.length !== snapshot.value.counts.total
  ) {
    return failure("NVIM_INVALID_RESPONSE", "Neovim returned incomplete diagnostic data");
  }
  return {
    ok: true,
    value: {
      buffer: snapshot.value.buffer,
      diagnostics: snapshot.value.diagnostics,
      editor,
      total: snapshot.value.counts.total,
    },
  };
}

function quickfixContentLimit(): BridgeResult<never> {
  return failure(
    "NVIM_LIMIT_EXCEEDED",
    `Neovim problem-list entries exceed ${MAX_QUICKFIX_BYTES} output bytes; request fewer items`,
  );
}

export function invalidQuickfixWindow(): BridgeResult<never> {
  return failure("NVIM_INVALID_WINDOW", "Choose a valid location-list owner from visible_windows");
}

export function quickfixRequestLimit(): BridgeResult<never> {
  return failure(
    "NVIM_LIMIT_EXCEEDED",
    `Request at most ${MAX_QUICKFIX_ITEMS} problem-list entries`,
  );
}

function quickfixSourceLimit(): BridgeResult<never> {
  return failure(
    "NVIM_LIMIT_EXCEEDED",
    `Neovim reports more than ${MAX_QUICKFIX_SOURCE_ITEMS} entries for this problem list; reduce the list in the editor`,
  );
}

function quickfixFailure(value: unknown): BridgeResult<never> | undefined {
  if (isRecord(value) === false || typeof value.error !== "string") return undefined;
  if (value.error === "invalidWindow") return invalidQuickfixWindow();
  if (value.error === "contentLimit") return quickfixContentLimit();
  if (value.error === "sourceLimit") return quickfixSourceLimit();
  if (value.error === "invalidSource") {
    return failure("NVIM_INVALID_RESPONSE", "Neovim returned a non-source problem-list buffer");
  }
  return failure("NVIM_INVALID_RESPONSE", "Neovim returned an unknown problem-list error");
}

function parseQuickfixOwner(
  value: unknown,
  kind: "location" | "quickfix",
  requestedWindow: number | undefined,
): QuickfixOwner | undefined {
  if (isRecord(value) === false || isNonNegativeInteger(value.listId) === false) {
    return undefined;
  }
  if (kind === "quickfix") {
    return value.kind === "quickfix" && "window" in value === false
      ? { kind: "quickfix", listId: value.listId }
      : undefined;
  }
  return value.kind === "location" && value.window === requestedWindow
    ? { kind: "location", listId: value.listId, window: value.window as number }
    : undefined;
}

function parseQuickfixItem(value: unknown, expectedCwd: string): BridgeResult<QuickfixItem> {
  if (
    isRecord(value) === false ||
    isNonNegativeInteger(value.buffer) === false ||
    isNonNegativeInteger(value.line) === false ||
    isNonNegativeInteger(value.column) === false ||
    isNonNegativeInteger(value.endLine) === false ||
    isNonNegativeInteger(value.endColumn) === false ||
    isBoundedString(value.filename) === false ||
    isBoundedString(value.text, MAX_QUICKFIX_BYTES) === false ||
    isBoundedString(value.type, 64) === false ||
    typeof value.valid !== "boolean"
  ) {
    return failure("NVIM_INVALID_RESPONSE", "Neovim returned invalid problem-list data");
  }
  if (
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value.filename) ||
    pathIsInsideWorktree(value.filename, expectedCwd) === false
  ) {
    return failure(
      "NVIM_WORKTREE_MISMATCH",
      "A Neovim problem-list entry is outside Pi's worktree",
    );
  }
  return {
    ok: true,
    value: {
      buffer: value.buffer,
      column: value.column,
      endColumn: value.endColumn,
      endLine: value.endLine,
      filename: value.filename,
      line: value.line,
      text: value.text,
      type: value.type,
      valid: value.valid,
    },
  };
}

export function parseQuickfix(
  value: unknown,
  expectedCwd: string,
  editor: EditorIdentity,
  options: QuickfixOptions = {},
): BridgeResult<QuickfixSnapshot> {
  const kind = options.kind ?? "quickfix";
  const maxItems = options.maxItems ?? DEFAULT_QUICKFIX_ITEMS;
  const requestedWindow = options.kind === "location" ? options.window : undefined;
  if (
    Number.isSafeInteger(maxItems) === false ||
    maxItems < 1 ||
    maxItems > MAX_QUICKFIX_ITEMS ||
    (kind === "location" &&
      (Number.isSafeInteger(requestedWindow) === false || (requestedWindow as number) < 1))
  ) {
    return failure("NVIM_INVALID_RESPONSE", "Invalid problem-list request bounds");
  }

  const responseFailure = quickfixFailure(value);
  if (responseFailure !== undefined) return responseFailure;
  const snapshot = parseBoundSnapshot(value, expectedCwd, editor);
  if (snapshot.ok === false) return snapshot;
  const owner = parseQuickfixOwner(snapshot.value.owner, kind, requestedWindow);
  if (
    isNonNegativeInteger(snapshot.value.total) &&
    snapshot.value.total > MAX_QUICKFIX_SOURCE_ITEMS
  ) {
    return quickfixSourceLimit();
  }
  if (
    owner === undefined ||
    isBoundedString(snapshot.value.title, MAX_QUICKFIX_BYTES) === false ||
    isNonNegativeInteger(snapshot.value.total) === false ||
    Array.isArray(snapshot.value.items) === false ||
    snapshot.value.items.length > maxItems ||
    snapshot.value.items.length > snapshot.value.total ||
    typeof snapshot.value.truncated !== "boolean" ||
    snapshot.value.truncated !== snapshot.value.items.length < snapshot.value.total
  ) {
    return failure("NVIM_INVALID_RESPONSE", "Neovim returned invalid problem-list data");
  }

  const items: QuickfixItem[] = [];
  for (const candidate of snapshot.value.items) {
    const item = parseQuickfixItem(candidate, expectedCwd);
    if (item.ok === false) return item;
    items.push(item.value);
  }

  const result: QuickfixSnapshot = {
    editor,
    items,
    owner,
    title: snapshot.value.title,
    total: snapshot.value.total,
    truncated: snapshot.value.truncated,
  };
  if (Buffer.byteLength(JSON.stringify(result, null, 2), "utf8") > MAX_QUICKFIX_BYTES) {
    return quickfixContentLimit();
  }
  return { ok: true, value: result };
}

function revealFailure(value: unknown): BridgeResult<never> | undefined {
  if (isRecord(value) === false || typeof value.error !== "string") return undefined;
  if (value.error === "invalidBuffer") {
    return failure(
      "NVIM_INVALID_BUFFER",
      "Choose a loaded source buffer from visible_windows or list_buffers",
    );
  }
  if (value.error === "worktreeMismatch") {
    return failure("NVIM_WORKTREE_MISMATCH", "The reveal target is outside Pi's worktree");
  }
  if (value.error === "invalidPosition") {
    const suffix = Number.isSafeInteger(value.totalLines) ? ` within 1-${value.totalLines}` : "";
    return failure("NVIM_INVALID_RANGE", `Choose a line${suffix}`);
  }
  if (value.error === "invalidColumn") {
    const suffix = Number.isSafeInteger(value.maxColumn) ? ` within 1-${value.maxColumn}` : "";
    return failure("NVIM_INVALID_RANGE", `Choose a column${suffix}`);
  }
  if (value.error === "missingSourceWindow") {
    return failure(
      "NVIM_INVALID_WINDOW",
      "No worktree source window is available for source reveal",
    );
  }
  if (value.error === "invalidWindow") {
    return failure("NVIM_INVALID_WINDOW", "Neovim could not create or update the reveal window");
  }
  return failure("NVIM_INVALID_RESPONSE", "Neovim returned an unknown reveal error");
}

export function parseReveal(
  value: unknown,
  expectedCwd: string,
  editor: EditorIdentity,
  options: RevealOptions,
): BridgeResult<RevealSnapshot> {
  const resolved = resolveRevealOptions(options);
  if (resolved.ok === false) return resolved;
  const responseFailure = revealFailure(value);
  if (responseFailure !== undefined) return responseFailure;
  const snapshot = parseBoundSnapshot(value, expectedCwd, editor);
  if (snapshot.ok === false) return snapshot;
  const buffer = parseSourceBuffer(snapshot.value.buffer, expectedCwd);
  if (buffer.ok === false) return buffer;
  if (
    buffer.value.loaded === false ||
    buffer.value.number !== resolved.value.buffer ||
    Number.isSafeInteger(snapshot.value.window) === false ||
    (snapshot.value.window as number) < 1 ||
    isPosition(snapshot.value.position) === false ||
    snapshot.value.position.line !== resolved.value.line ||
    snapshot.value.position.column !== resolved.value.column ||
    typeof snapshot.value.focused !== "boolean" ||
    typeof snapshot.value.focusPreserved !== "boolean" ||
    (resolved.value.focus
      ? snapshot.value.focused !== true
      : snapshot.value.focusPreserved !== true) ||
    isRevealSplit(snapshot.value.split) === false ||
    snapshot.value.split !== resolved.value.split ||
    typeof snapshot.value.splitCreated !== "boolean" ||
    snapshot.value.splitCreated !== (resolved.value.split !== "none")
  ) {
    return failure("NVIM_INVALID_RESPONSE", "Neovim returned invalid reveal data");
  }
  return {
    ok: true,
    value: {
      buffer: buffer.value,
      editor,
      focused: snapshot.value.focused,
      focusPreserved: snapshot.value.focusPreserved,
      position: snapshot.value.position,
      split: snapshot.value.split,
      splitCreated: snapshot.value.splitCreated,
      window: snapshot.value.window as number,
    },
  };
}

function annotationFailure(value: unknown): BridgeResult<never> | undefined {
  if (isRecord(value) === false || typeof value.error !== "string") return undefined;
  if (value.error === "invalidBuffer") {
    return failure(
      "NVIM_INVALID_BUFFER",
      "Choose a loaded source buffer from visible_windows or list_buffers",
    );
  }
  if (value.error === "worktreeMismatch") {
    return failure("NVIM_WORKTREE_MISMATCH", "The annotation target is outside Pi's worktree");
  }
  if (value.error === "annotationLimit") {
    return failure("NVIM_LIMIT_EXCEEDED", `Annotate between 1 and ${MAX_ANNOTATIONS} anchors`);
  }
  if (value.error === "activeLimit") {
    return failure(
      "NVIM_LIMIT_EXCEEDED",
      `At most ${MAX_ACTIVE_ANNOTATIONS} annotations may be active per Pi session`,
    );
  }
  if (value.error === "searchLimit") {
    return failure(
      "NVIM_LIMIT_EXCEEDED",
      `Shifted-anchor search is limited to ${MAX_ANNOTATION_SEARCH_LINES} lines and ${MAX_ANNOTATION_SEARCH_BYTES} bytes`,
    );
  }
  if (value.error === "durationLimit") {
    return failure(
      "NVIM_LIMIT_EXCEEDED",
      `Annotation duration must not exceed ${MAX_ANNOTATION_DURATION_MS} ms`,
    );
  }
  const index = Number.isSafeInteger(value.annotationIndex) ? ` ${value.annotationIndex}` : "";
  const line = Number.isSafeInteger(value.requestedLine) ? ` near line ${value.requestedLine}` : "";
  if (value.error === "staleAnchor") {
    return failure("NVIM_STALE_ANCHOR", `Annotation${index} no longer matches source text${line}`);
  }
  if (value.error === "ambiguousAnchor") {
    return failure(
      "NVIM_AMBIGUOUS_ANCHOR",
      `Annotation${index} matches source text more than once${line}`,
    );
  }
  if (value.error === "invalidAnnotation") {
    return failure("NVIM_INVALID_ANNOTATION", `Annotation${index} is invalid`);
  }
  if (value.error === "extmarkFailure") {
    return failure("NVIM_INVALID_RESPONSE", "Neovim could not create the annotation batch");
  }
  return failure("NVIM_INVALID_RESPONSE", "Neovim returned an unknown annotation error");
}

function compareSourceAnnotations(left: SourceAnnotation, right: SourceAnnotation): number {
  if (left.line !== right.line) return left.line - right.line;
  if (left.column !== right.column) return left.column - right.column;
  return left.inputIndex - right.inputIndex;
}

export function parseAnnotations(
  value: unknown,
  expectedCwd: string,
  editor: EditorIdentity,
  options: AnnotationOptions,
  expectedBatchId: number,
): BridgeResult<AnnotationSnapshot> {
  const resolved = resolveAnnotationOptions(options);
  if (resolved.ok === false) return resolved;
  const responseFailure = annotationFailure(value);
  if (responseFailure !== undefined) return responseFailure;
  const snapshot = parseBoundSnapshot(value, expectedCwd, editor);
  if (snapshot.ok === false) return snapshot;
  const buffer = parseSourceBuffer(snapshot.value.buffer, expectedCwd);
  if (buffer.ok === false) return buffer;
  if (
    buffer.value.loaded === false ||
    buffer.value.number !== resolved.value.buffer ||
    snapshot.value.batchId !== expectedBatchId ||
    Number.isSafeInteger(snapshot.value.totalLines) === false ||
    (snapshot.value.totalLines as number) < 1 ||
    snapshot.value.expiresInMs !== resolved.value.durationMs ||
    Array.isArray(snapshot.value.annotations) === false ||
    snapshot.value.annotations.length !== resolved.value.annotations.length
  ) {
    return failure("NVIM_INVALID_RESPONSE", "Neovim returned invalid annotation data");
  }

  const annotations: SourceAnnotation[] = [];
  const annotationIds = new Set<number>();
  const inputIndexes = new Set<number>();
  for (const candidate of snapshot.value.annotations) {
    if (
      isRecord(candidate) === false ||
      Number.isSafeInteger(candidate.annotationId) === false ||
      (candidate.annotationId as number) < 1 ||
      Number.isSafeInteger(candidate.inputIndex) === false ||
      (candidate.inputIndex as number) < 1 ||
      (candidate.inputIndex as number) > resolved.value.annotations.length ||
      Number.isSafeInteger(candidate.line) === false ||
      (candidate.line as number) < 1 ||
      Number.isSafeInteger(candidate.column) === false ||
      (candidate.column as number) < 1 ||
      (candidate.line as number) > (snapshot.value.totalLines as number) ||
      Number.isSafeInteger(candidate.sourceLineBytes) === false ||
      (candidate.sourceLineBytes as number) < 0 ||
      candidate.placement !== "callout" ||
      isAnnotationKind(candidate.kind) === false ||
      typeof candidate.text !== "string"
    ) {
      return failure("NVIM_INVALID_RESPONSE", "Neovim returned an invalid annotation item");
    }
    const annotationId = candidate.annotationId as number;
    const inputIndex = candidate.inputIndex as number;
    const input = resolved.value.annotations[inputIndex - 1];
    if (
      input === undefined ||
      candidate.kind !== input.kind ||
      candidate.text !== input.text ||
      (candidate.column as number) + Buffer.byteLength(input.anchor, "utf8") - 1 >
        (candidate.sourceLineBytes as number) ||
      annotationIds.has(annotationId) ||
      inputIndexes.has(inputIndex)
    ) {
      return failure("NVIM_INVALID_RESPONSE", "Neovim returned mismatched annotation data");
    }
    annotationIds.add(annotationId);
    inputIndexes.add(inputIndex);
    annotations.push({
      annotationId,
      column: candidate.column as number,
      inputIndex,
      kind: candidate.kind,
      line: candidate.line as number,
      placement: "callout",
      text: candidate.text,
    });
  }
  for (let index = 1; index < annotations.length; index += 1) {
    const previous = annotations[index - 1];
    const current = annotations[index];
    if (
      previous === undefined ||
      current === undefined ||
      compareSourceAnnotations(previous, current) > 0
    ) {
      return failure("NVIM_INVALID_RESPONSE", "Neovim returned annotations out of order");
    }
  }
  return {
    ok: true,
    value: {
      annotations,
      batchId: expectedBatchId,
      buffer: buffer.value,
      editor,
      expiresInMs: resolved.value.durationMs,
      totalLines: snapshot.value.totalLines as number,
    },
  };
}

function highlightFailure(value: unknown): BridgeResult<never> | undefined {
  if (isRecord(value) === false || typeof value.error !== "string") return undefined;
  if (value.error === "invalidBuffer") {
    return failure(
      "NVIM_INVALID_BUFFER",
      "Choose a loaded source buffer from visible_windows or list_buffers",
    );
  }
  if (value.error === "worktreeMismatch") {
    return failure("NVIM_WORKTREE_MISMATCH", "The highlight target is outside Pi's worktree");
  }
  if (value.error === "invalidRange" || value.error === "invalidColumn") {
    const suffix = Number.isSafeInteger(value.totalLines)
      ? ` within 1-${value.totalLines} lines`
      : "";
    return failure("NVIM_INVALID_RANGE", `Choose a valid non-empty highlight range${suffix}`);
  }
  if (value.error === "lineLimit") {
    return failure("NVIM_LIMIT_EXCEEDED", `Highlight at most ${MAX_HIGHLIGHT_LINES} lines`);
  }
  if (value.error === "durationLimit") {
    return failure(
      "NVIM_LIMIT_EXCEEDED",
      `Highlight duration must not exceed ${MAX_HIGHLIGHT_DURATION_MS} ms`,
    );
  }
  if (value.error === "extmarkFailure") {
    return failure("NVIM_INVALID_RESPONSE", "Neovim could not create the temporary highlight");
  }
  return failure("NVIM_INVALID_RESPONSE", "Neovim returned an unknown highlight error");
}

function rangeIsOrdered(start: Position, end: Position): boolean {
  return end.line > start.line || (end.line === start.line && end.column > start.column);
}

export function parseHighlight(
  value: unknown,
  expectedCwd: string,
  editor: EditorIdentity,
  options: HighlightOptions,
): BridgeResult<HighlightSnapshot> {
  const resolved = resolveHighlightOptions(options);
  if (resolved.ok === false) return resolved;
  const responseFailure = highlightFailure(value);
  if (responseFailure !== undefined) return responseFailure;
  const snapshot = parseBoundSnapshot(value, expectedCwd, editor);
  if (snapshot.ok === false) return snapshot;
  const buffer = parseSourceBuffer(snapshot.value.buffer, expectedCwd);
  if (buffer.ok === false) return buffer;
  if (
    buffer.value.loaded === false ||
    buffer.value.number !== resolved.value.buffer ||
    Number.isSafeInteger(snapshot.value.highlightId) === false ||
    (snapshot.value.highlightId as number) < 1 ||
    isPosition(snapshot.value.start) === false ||
    snapshot.value.start.line !== resolved.value.startLine ||
    snapshot.value.start.column !== resolved.value.startColumn ||
    isPosition(snapshot.value.end) === false ||
    snapshot.value.end.line !== resolved.value.endLine ||
    (resolved.value.endColumn !== undefined &&
      snapshot.value.end.column !== resolved.value.endColumn) ||
    rangeIsOrdered(snapshot.value.start, snapshot.value.end) === false ||
    snapshot.value.end.line - snapshot.value.start.line + 1 > MAX_HIGHLIGHT_LINES ||
    snapshot.value.expiresInMs !== resolved.value.durationMs
  ) {
    return failure("NVIM_INVALID_RESPONSE", "Neovim returned invalid highlight data");
  }
  return {
    ok: true,
    value: {
      buffer: buffer.value,
      editor,
      end: snapshot.value.end,
      expiresInMs: resolved.value.durationMs,
      highlightId: snapshot.value.highlightId as number,
      start: snapshot.value.start,
    },
  };
}

export function parseHighlightClear(
  value: unknown,
  expectedCwd: string,
  editor: EditorIdentity,
  options: HighlightClearOptions,
): BridgeResult<HighlightClearSnapshot> {
  const resolved = resolveHighlightClearOptions(options);
  if (resolved.ok === false) return resolved;
  const responseFailure = highlightFailure(value);
  if (responseFailure !== undefined) return responseFailure;
  const snapshot = parseBoundSnapshot(value, expectedCwd, editor);
  if (snapshot.ok === false) return snapshot;
  const buffer = parseSourceBuffer(snapshot.value.buffer, expectedCwd);
  if (buffer.ok === false) return buffer;
  if (
    buffer.value.loaded === false ||
    buffer.value.number !== resolved.value.buffer ||
    snapshot.value.highlightId !== resolved.value.highlightId ||
    typeof snapshot.value.cleared !== "boolean"
  ) {
    return failure("NVIM_INVALID_RESPONSE", "Neovim returned invalid highlight cleanup data");
  }
  return {
    ok: true,
    value: {
      buffer: buffer.value,
      cleared: snapshot.value.cleared,
      editor,
      highlightId: resolved.value.highlightId,
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
  return failure(
    "NVIM_NO_FOCUS_CONTEXT",
    "No source focus context has been reported by Neovim; inspect visible_windows, then list_buffers",
  );
}

export function noSelection(): BridgeResult<never> {
  return failure("NVIM_NO_SELECTION", "No source selection has been reported by Neovim");
}
