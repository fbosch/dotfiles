import type { ExecOptions, ExecResult } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import type { StructuredPatch } from "diff";

export const COMMAND_TIMEOUT_MS = 60_000;
export const EDIT_DIFF_TIMEOUT_MS = 100;
// Keep expansion within the renderer's existing bounded-output contract.
export const FULL_CONTEXT_LINES = DEFAULT_MAX_LINES;
export const DEFAULT_CONTEXT_LINES = 3;
export const DEFAULT_SYNTAX_THEME = "zenwritten_dark";
export const DEFAULT_WIDTH = 120;
export const MIN_WIDTH = 40;
export const MAX_WIDTH = 240;
export const SIDE_BY_SIDE_MIN_WIDTH = 150;
export const COLLAPSED_LINES = 24;
export const MAX_PATHS = 100;
export const ENTRY_TYPE = "diff-rendering-git-diff";
export const HASHLINE_DIFF_TOOLS = new Set([
  "replace",
  "insert",
  "replace_match",
  "copy",
  "move",
  "undo_last_change",
]);
// Parse metadata up to its delimiter so anchor-width changes cannot consume source text.
const HASHLINE_ANCHOR_FIELD = "[A-Za-z0-9]+";
const HASHLINE_DIFF_PREFIX = `([ +-])(?:${HASHLINE_ANCHOR_FIELD}| +)│`;
export const HASHLINE_READ_ROW_PATTERN = new RegExp(`^${HASHLINE_ANCHOR_FIELD}│(.*)$`, "u");
export const HASHLINE_GREP_ROW_PATTERN = new RegExp(
  `^(\\s*\\d+[:-]│)\\s+${HASHLINE_ANCHOR_FIELD}│(.*)$`,
  "u",
);
export const HASHLINE_DIFF_ROW_PATTERN = new RegExp(`^${HASHLINE_DIFF_PREFIX}(.*)$`, "mu");
export const HASHLINE_DIFF_ROW_REPLACEMENT = new RegExp(`^${HASHLINE_DIFF_PREFIX}`, "gmu");
export const ESCAPE = "\u001b";
export const SGR_SUFFIX_PATTERN = /^\[[0-9;]*m/;
export const SGR_PATTERN = new RegExp(`${ESCAPE}\\[([0-9;]*)m`, "g");
export const ESCAPE_SUFFIX_PATTERN = /^\[[0-?]*[ -/]*[@-~]/;
export const ZENWRITTEN_ADDED_BACKGROUND = "#232D1A";
export const ZENWRITTEN_REMOVED_BACKGROUND = "#3E2225";

export interface GitDiffRequest {
  readonly context?: number;
  readonly display?: "auto" | "side-by-side" | "inline";
  readonly paths?: readonly string[];
  readonly revision?: string;
  readonly staged?: boolean;
}

export interface DiffTruncation {
  readonly outputBytes: number;
  readonly outputLines: number;
  readonly totalBytes: number;
  readonly totalLines: number;
}

export interface DiffDetails {
  readonly display: "side-by-side" | "inline";
  readonly fullOutputPath?: string;
  readonly noChanges: boolean;
  readonly output: string;
  readonly scope: string;
  readonly truncation?: DiffTruncation;
  readonly warning?: string;
  readonly width: number;
}

export function isDiffDetails(value: unknown): value is DiffDetails {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.display === "inline" || record.display === "side-by-side") &&
    typeof record.noChanges === "boolean" &&
    typeof record.output === "string" &&
    typeof record.scope === "string" &&
    typeof record.width === "number"
  );
}

export interface DiffResult {
  readonly content: string;
  readonly details: DiffDetails;
}

export type GitDiffExecutor = (
  command: string,
  args: string[],
  options: ExecOptions,
) => Promise<ExecResult>;

export interface DiffRenderOptions {
  readonly width: number;
  readonly display: "inline" | "side-by-side";
  readonly auto?: boolean;
  readonly signal?: AbortSignal;
}

export interface RenderedDiff {
  readonly output: string;
  readonly display: "inline" | "side-by-side";
  readonly warning?: string;
}

export interface DiffRenderEngine {
  prewarm(): Promise<void>;
  render(patches: readonly StructuredPatch[], options: DiffRenderOptions): Promise<RenderedDiff>;
  dispose(): Promise<void>;
}

export type GitDiffRunner = (
  request: GitDiffRequest,
  cwd: string,
  signal?: AbortSignal,
) => Promise<DiffResult>;

export interface EditDiffRequest {
  readonly context?: number;
  readonly newContent: string;
  readonly oldContent: string;
  readonly path: string;
}

export type EditDiffRunner = (
  request: EditDiffRequest,
  cwd: string,
  signal?: AbortSignal,
) => Promise<DiffDetails>;

export interface RunOptions {
  readonly columns?: number;
  readonly engine: DiffRenderEngine;
  readonly signal?: AbortSignal;
  readonly writeFullOutput?: (output: string) => Promise<string>;
}

export interface BoundedOutput {
  readonly ansi: string;
  readonly plain: string;
  readonly truncation?: DiffTruncation;
}

export interface GitInvocation {
  readonly args: string[];
  readonly display: "side-by-side" | "inline";
  readonly scope: string;
  readonly width: number;
}

function printableCharacter(value: string): boolean {
  return /^\P{C}$/u.test(value);
}

/** Preserve generated SGR colors while rejecting source-derived terminal control sequences. */
export function sanitizeTerminalOutput(value: string): string {
  const normalized = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  let output = "";

  for (let index = 0; index < normalized.length; ) {
    if (normalized[index] === ESCAPE) {
      const remainder = normalized.slice(index + 1);
      const sgrSuffix = SGR_SUFFIX_PATTERN.exec(remainder)?.[0];
      if (sgrSuffix !== undefined) {
        output += `${ESCAPE}${sgrSuffix}`;
        index += sgrSuffix.length + 1;
        continue;
      }

      if (normalized[index + 1] === "]") {
        const bell = normalized.indexOf("\u0007", index + 2);
        const stringTerminator = normalized.indexOf(`${ESCAPE}\\`, index + 2);
        const terminators = [bell, stringTerminator].filter((position) => position >= 0);
        if (terminators.length === 0) break;
        const terminator = Math.min(...terminators);
        index = terminator + (terminator === stringTerminator ? 2 : 1);
        continue;
      }

      const escapeSuffix = ESCAPE_SUFFIX_PATTERN.exec(remainder)?.[0];
      index +=
        escapeSuffix === undefined ? Math.min(2, remainder.length + 1) : escapeSuffix.length + 1;
      continue;
    }

    const codePoint = normalized.codePointAt(index);
    if (codePoint === undefined) break;
    const character = String.fromCodePoint(codePoint);
    if (character === "\n" || character === "\t" || printableCharacter(character)) {
      output += character;
    }
    index += character.length;
  }

  return output;
}

export function normalizeHashlineDiffDetails<T>(details: T): T {
  if (details === null || typeof details !== "object" || Array.isArray(details)) return details;
  const record = details as Record<string, unknown>;
  if (
    typeof record.diff !== "string" ||
    !Array.isArray(record.diffLineNumbers) ||
    !HASHLINE_DIFF_ROW_PATTERN.test(record.diff)
  ) {
    return details;
  }

  const normalized = { ...record };
  normalized.diff = record.diff.replace(HASHLINE_DIFF_ROW_REPLACEMENT, "$1");
  // SAFETY: Normalization preserves every property and only replaces the validated string diff.
  return normalized as T;
}

function stripSgr(value: string): string {
  return value
    .split(ESCAPE)
    .map((part, index) => (index === 0 ? part : part.replace(SGR_SUFFIX_PATTERN, "")))
    .join("");
}

function sourceLines(value: string): string[] {
  const withoutTrailingNewlines = value.replace(/\n+$/u, "");
  return withoutTrailingNewlines === "" ? [] : withoutTrailingNewlines.split("\n");
}

export function boundDiffOutput(value: string): BoundedOutput {
  const sanitized = sanitizeTerminalOutput(value);
  const lines = sourceLines(sanitized);
  const selected: string[] = [];
  let outputBytes = 0;
  let plainBytes = 0;

  for (const line of lines) {
    if (selected.length >= DEFAULT_MAX_LINES) break;
    const separatorBytes = selected.length === 0 ? 0 : 1;
    const lineBytes = Buffer.byteLength(line, "utf8") + separatorBytes;
    const plainLineBytes = Buffer.byteLength(stripSgr(line), "utf8") + separatorBytes;
    if (outputBytes + lineBytes > DEFAULT_MAX_BYTES) break;
    if (plainBytes + plainLineBytes > DEFAULT_MAX_BYTES) break;
    selected.push(line);
    outputBytes += lineBytes;
    plainBytes += plainLineBytes;
  }

  const ansi = selected.join("\n");
  const plain = stripSgr(ansi);
  if (selected.length === lines.length) return { ansi, plain };

  const fullPlain = stripSgr(sourceLines(sanitized).join("\n"));
  return {
    ansi,
    plain,
    truncation: {
      outputBytes: Buffer.byteLength(plain, "utf8"),
      outputLines: selected.length,
      totalBytes: Buffer.byteLength(fullPlain, "utf8"),
      totalLines: lines.length,
    },
  };
}

export function safeInput(value: string, name: string): string {
  if (value.includes("\0") || /\p{C}/u.test(value)) {
    throw new Error(`${name} must not contain control characters`);
  }
  return value;
}

function normalizedPaths(paths: readonly string[] | undefined): string[] {
  return (paths ?? []).map((path) => {
    const normalized = path.startsWith("@") ? path.slice(1) : path;
    if (normalized.length === 0) throw new Error("Git pathspec must not be empty");
    return safeInput(normalized, "Git pathspec");
  });
}

function normalizedRevision(revision: string | undefined): string | undefined {
  if (revision === undefined) return undefined;
  const normalized = safeInput(revision.trim(), "Git revision");
  if (normalized.length === 0) throw new Error("Git revision must not be empty");
  if (normalized.startsWith("-")) throw new Error("Git revision must not begin with '-'");
  return normalized;
}

export function effectiveWidth(columns: number | undefined): number {
  const available = Number.isFinite(columns)
    ? Math.floor(columns ?? DEFAULT_WIDTH) - 4
    : DEFAULT_WIDTH;
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, available));
}

function describeScope(request: GitDiffRequest): string {
  if (request.staged === true && request.revision !== undefined) {
    return `staged changes against ${request.revision}`;
  }
  if (request.staged === true) return "staged changes";
  if (request.revision !== undefined) return `working tree against ${request.revision}`;
  return "unstaged changes";
}

export function buildGitInvocation(
  request: GitDiffRequest,
  columns: number | undefined,
): GitInvocation {
  const width = effectiveWidth(columns);
  const display =
    request.display === "inline" || request.display === "side-by-side"
      ? request.display
      : width >= SIDE_BY_SIDE_MIN_WIDTH
        ? "side-by-side"
        : "inline";
  const context = request.context ?? DEFAULT_CONTEXT_LINES;
  const revision = normalizedRevision(request.revision);
  const paths = normalizedPaths(request.paths);
  const args = ["--no-pager", "diff", "--no-ext-diff", "--no-color", `--unified=${context}`];
  if (request.staged === true) args.push("--cached");
  if (revision !== undefined) args.push(revision);
  if (paths.length > 0) args.push("--", ...paths);

  return { args, display, scope: describeScope(request), width };
}

export function stripSgrCodes(value: string): string {
  return stripSgr(value);
}

export function sourceLinesForRender(value: string): string[] {
  return sourceLines(value);
}

export function diagnostic(value: string): string {
  const sanitized = stripSgr(sanitizeTerminalOutput(value)).trim();
  if (sanitized === "") return "No diagnostic output was produced.";
  const lines = sanitized.split("\n").slice(0, 20);
  return lines.join("\n").slice(0, 4_000);
}
