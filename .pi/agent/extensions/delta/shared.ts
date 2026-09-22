import type { ExecOptions, ExecResult } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";

export const COMMAND_TIMEOUT_MS = 60_000;
export const EDIT_COMMAND_TIMEOUT_MS = 10_000;
// Keep expansion within the renderer's existing bounded-output contract.
export const FULL_CONTEXT_LINES = DEFAULT_MAX_LINES;
export const DEFAULT_CONTEXT_LINES = 3;
export const DEFAULT_SYNTAX_THEME = "Zenwritten Dark";
export const DEFAULT_WIDTH = 120;
export const MIN_WIDTH = 40;
export const MAX_WIDTH = 240;
export const SIDE_BY_SIDE_MIN_WIDTH = 96;
export const COLLAPSED_LINES = 24;
export const MAX_PATHS = 100;
export const ENTRY_TYPE = "delta-git-diff";
export const HASHLINE_DIFF_TOOLS = new Set(["replace", "insert", "undo_last_change"]);
// Hashline metadata addresses tool edits but should not appear in the renderer's source view.
export const HASHLINE_DIFF_ROW_PATTERN = /^([ +-])(?:[A-Za-z0-9]{4}| {4})│/mu;
export const HASHLINE_DIFF_ROW_REPLACEMENT = /^([ +-])(?:[A-Za-z0-9]{4}| {4})│/gmu;
export const ESCAPE = "\u001b";
export const SGR_SUFFIX_PATTERN = /^\[[0-9;]*m/;
export const SGR_PATTERN = new RegExp(`${ESCAPE}\\[([0-9;]*)m`, "g");
export const ESCAPE_SUFFIX_PATTERN = /^\[[0-?]*[ -/]*[@-~]/;
export const DELTA_ADDED_COLOR = 28;
export const DELTA_REMOVED_COLOR = 88;
export const DELTA_GUTTER_COLOR = 34;
export const ZENWRITTEN_ADDED_BACKGROUND = "#232D1A";
export const ZENWRITTEN_REMOVED_BACKGROUND = "#3E2225";
export const ERASE_TO_LINE_END = `${ESCAPE}[0K`;
export const LINE_FILL_MARKER = "␛pi-delta-fill␛";

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

export interface DeltaDetails {
  readonly display: "side-by-side" | "inline";
  readonly fullOutputPath?: string;
  readonly noChanges: boolean;
  readonly output: string;
  readonly scope: string;
  readonly truncation?: DiffTruncation;
  readonly warning?: string;
  readonly width: number;
}

export interface DeltaResult {
  readonly content: string;
  readonly details: DeltaDetails;
}

export type GitDiffExecutor = (
  command: string,
  args: string[],
  options: ExecOptions,
) => Promise<ExecResult>;

export type DeltaExecutor = (
  args: readonly string[],
  input: string | undefined,
  options: ExecOptions,
) => Promise<ExecResult>;

export type GitDiffRunner = (
  request: GitDiffRequest,
  cwd: string,
  signal?: AbortSignal,
) => Promise<DeltaResult>;

export interface DeltaEditRequest {
  readonly context?: number;
  readonly newContent: string;
  readonly oldContent: string;
  readonly path: string;
}

export type EditDiffRunner = (
  request: DeltaEditRequest,
  cwd: string,
  signal?: AbortSignal,
) => Promise<DeltaDetails>;

export interface RunOptions {
  readonly columns?: number;
  readonly executeDelta?: DeltaExecutor;
  readonly signal?: AbortSignal;
  readonly syntaxTheme?: string;
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

export interface DeltaInvocationOptions {
  readonly context?: number;
  readonly edit?: boolean;
  readonly syntaxTheme?: string;
}

function printableCharacter(value: string): boolean {
  return /^\P{C}$/u.test(value);
}

/** Preserve Delta SGR colors while rejecting source-derived terminal control sequences. */
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

export function buildDeltaInvocation(
  display: "side-by-side" | "inline",
  width: number,
  options: DeltaInvocationOptions = {},
): string[] {
  const syntaxTheme = safeInput(options.syntaxTheme ?? DEFAULT_SYNTAX_THEME, "Delta syntax theme");
  const args = [
    "--no-gitconfig",
    "--paging=never",
    "--dark",
    `--width=${width}`,
    "--line-numbers",
    "--line-fill-method=spaces",
    `--line-numbers-minus-style=${DELTA_REMOVED_COLOR}`,
    `--line-numbers-plus-style=${DELTA_ADDED_COLOR}`,
    `--minus-style=syntax "${ZENWRITTEN_REMOVED_BACKGROUND}"`,
    `--minus-emph-style=syntax "${ZENWRITTEN_REMOVED_BACKGROUND}"`,
    `--plus-style=syntax "${ZENWRITTEN_ADDED_BACKGROUND}"`,
    `--plus-emph-style=syntax "${ZENWRITTEN_ADDED_BACKGROUND}"`,
    "--commit-decoration-style=omit",
    "--file-decoration-style=omit",
    "--hunk-header-style=omit",
    "--hunk-header-decoration-style=omit",
    `--syntax-theme=${syntaxTheme}`,
  ];
  if (options.edit === true) {
    args.push("--file-style=omit", `--diff-args=-U${options.context ?? DEFAULT_CONTEXT_LINES}`);
  } else {
    args.push("--file-style=bold");
  }
  if (display === "side-by-side") args.push("--side-by-side");
  return args;
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
