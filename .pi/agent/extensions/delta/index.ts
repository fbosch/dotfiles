import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  access as fsAccess,
  readFile as fsReadFile,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  BorderedLoader,
  createEditToolDefinition,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  defineTool,
  type EditOperations,
  type EditToolDetails,
  type ExecOptions,
  type ExecResult,
  type ExtensionAPI,
  type ExtensionContext,
  formatSize,
  getAgentDir,
  keyHint,
  type Theme,
  type ToolDefinition,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import {
  Box,
  type Component,
  Container,
  Spacer,
  Text,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { globalExtensionConfigPath, readJsonConfig } from "../../lib/extension-config";

const COMMAND_TIMEOUT_MS = 60_000;
const EDIT_COMMAND_TIMEOUT_MS = 10_000;
// Keep expansion within the renderer's existing bounded-output contract.
const FULL_CONTEXT_LINES = DEFAULT_MAX_LINES;
const DEFAULT_CONTEXT_LINES = 3;
const DEFAULT_SYNTAX_THEME = "Zenwritten Dark";
const DEFAULT_WIDTH = 120;
const MIN_WIDTH = 40;
const MAX_WIDTH = 240;
const SIDE_BY_SIDE_MIN_WIDTH = 96;
const COLLAPSED_LINES = 24;
const MAX_PATHS = 100;
const ENTRY_TYPE = "delta-git-diff";
const ESCAPE = "\u001b";
const SGR_SUFFIX_PATTERN = /^\[[0-9;]*m/;
const SGR_PATTERN = new RegExp(`${ESCAPE}\\[([0-9;]*)m`, "g");
const ESCAPE_SUFFIX_PATTERN = /^\[[0-?]*[ -/]*[@-~]/;
const DELTA_ADDED_COLOR = 28;
const DELTA_REMOVED_COLOR = 88;
const DELTA_GUTTER_COLOR = 34;
const ZENWRITTEN_ADDED_BACKGROUND = "#232D1A";
const ZENWRITTEN_REMOVED_BACKGROUND = "#3E2225";
const ERASE_TO_LINE_END = `${ESCAPE}[0K`;
const LINE_FILL_MARKER = "␛pi-delta-fill␛";

const DisplayMode = StringEnum(["auto", "side-by-side", "inline"] as const);

const GitDiffParameters = Type.Object(
  {
    staged: Type.Optional(
      Type.Boolean({ description: "Compare the index instead of unstaged working-tree changes" }),
    ),
    revision: Type.Optional(
      Type.String({
        description:
          "Git revision or range to compare, such as HEAD, HEAD~1, or main...HEAD. Values beginning with '-' are rejected.",
      }),
    ),
    paths: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        description: "Optional Git pathspecs used after '--'",
        maxItems: MAX_PATHS,
      }),
    ),
    display: Type.Optional(
      Type.Unsafe<"auto" | "side-by-side" | "inline">({
        ...DisplayMode,
        description: "Layout. Auto uses inline output in narrow terminals.",
      }),
    ),
    context: Type.Optional(
      Type.Integer({
        description: "Unchanged lines around each change",
        minimum: 0,
        maximum: 50,
      }),
    ),
  },
  { additionalProperties: false },
);

export interface GitDiffRequest {
  readonly context?: number;
  readonly display?: "auto" | "side-by-side" | "inline";
  readonly paths?: readonly string[];
  readonly revision?: string;
  readonly staged?: boolean;
}

interface DiffTruncation {
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

interface GitDiffRenderState {
  expandedController: AbortController | undefined;
  expandedDetails: DeltaDetails | null | undefined;
  expandedKey: string | undefined;
  expandedPending: boolean;
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

interface RunOptions {
  readonly columns?: number;
  readonly executeDelta?: DeltaExecutor;
  readonly signal?: AbortSignal;
  readonly syntaxTheme?: string;
  readonly writeFullOutput?: (output: string) => Promise<string>;
}

interface BoundedOutput {
  readonly ansi: string;
  readonly plain: string;
  readonly truncation?: DiffTruncation;
}

interface GitInvocation {
  readonly args: string[];
  readonly display: "side-by-side" | "inline";
  readonly scope: string;
  readonly width: number;
}

type DiffCommandOutcome =
  | { readonly status: "cancelled" }
  | { readonly message: string; readonly status: "error" }
  | { readonly result: DeltaResult; readonly status: "success" };

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

function sgr(codes: readonly number[]): string {
  return codes.length === 0 ? "" : `${ESCAPE}[${codes.join(";")}m`;
}

/** Preserve Delta's line tints while restoring Pi's tool background after style resets. */
export function applyDiffTheme(
  value: string,
  theme: Pick<Theme, "getBgAnsi" | "getFgAnsi">,
): string {
  const withFillMarkers = value.replaceAll(ERASE_TO_LINE_END, LINE_FILL_MARKER);
  return sanitizeTerminalOutput(withFillMarkers).replace(
    SGR_PATTERN,
    (_sequence, parameters: string) => {
      const codes = parameters === "" ? [0] : parameters.split(";").map(Number);
      const output: string[] = [];
      let pending: number[] = [];
      const flush = () => {
        if (pending.length === 0) return;
        output.push(sgr(pending));
        pending = [];
      };

      for (let index = 0; index < codes.length; ) {
        const code = codes[index] ?? 0;
        if (code === 38 || code === 48) {
          const mode = codes[index + 1];
          const length = mode === 2 ? 5 : mode === 5 ? 3 : 1;
          const group = codes.slice(index, index + length);
          if (code === 38 && mode === 5 && group[2] === DELTA_ADDED_COLOR) {
            flush();
            output.push(theme.getFgAnsi("toolDiffAdded"));
          } else if (code === 38 && mode === 5 && group[2] === DELTA_REMOVED_COLOR) {
            flush();
            output.push(theme.getFgAnsi("toolDiffRemoved"));
          } else {
            pending.push(...group);
          }
          index += length;
          continue;
        }

        if (code === DELTA_GUTTER_COLOR) {
          flush();
          output.push(theme.getFgAnsi("toolDiffContext"));
        } else {
          pending.push(code);
        }
        if (code === 0) {
          flush();
          output.push(theme.getBgAnsi("toolSuccessBg"));
        }
        index += 1;
      }

      flush();
      return output.join("");
    },
  );
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

function safeInput(value: string, name: string): string {
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

function effectiveWidth(columns: number | undefined): number {
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

interface DeltaInvocationOptions {
  readonly context?: number;
  readonly edit?: boolean;
  readonly syntaxTheme?: string;
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

export async function executeDeltaProcess(
  args: readonly string[],
  input: string | undefined,
  options: ExecOptions,
): Promise<ExecResult> {
  if (options.signal?.aborted === true) {
    return { code: 1, killed: true, stderr: "", stdout: "" };
  }

  return new Promise((resolve, reject) => {
    const child = spawn("delta", [...args], { cwd: options.cwd, stdio: "pipe" });
    let killed = false;
    let stderr = "";
    let stdout = "";
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const stop = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      killed = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 250);
    };
    const cleanup = () => {
      if (timeout !== undefined) clearTimeout(timeout);
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
      options.signal?.removeEventListener("abort", stop);
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stdin.on("error", () => undefined);
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("close", (code) => {
      cleanup();
      resolve({ code: code ?? 1, killed, stderr, stdout });
    });

    options.signal?.addEventListener("abort", stop, { once: true });
    if (options.timeout !== undefined) timeout = setTimeout(stop, options.timeout);
    child.stdin.end(input);
  });
}

async function writeFullOutput(output: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-delta-"));
  const path = join(directory, "diff.txt");
  await withFileMutationQueue(path, () => writeFile(path, output, "utf8"));
  return path;
}

function diagnostic(value: string): string {
  const sanitized = stripSgr(sanitizeTerminalOutput(value)).trim();
  if (sanitized === "") return "No diagnostic output was produced.";
  const lines = sanitized.split("\n").slice(0, 20);
  return lines.join("\n").slice(0, 4_000);
}

function truncationNotice(truncation: DiffTruncation, fullOutputPath?: string): string {
  const summary = `[Diff output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
  return fullOutputPath === undefined
    ? `${summary} Full output could not be saved.]`
    : `${summary} Full output saved to: ${fullOutputPath}]`;
}

export async function runDeltaGitDiff(
  executeGit: GitDiffExecutor,
  request: GitDiffRequest,
  cwd: string,
  options: RunOptions = {},
): Promise<DeltaResult> {
  const invocation = buildGitInvocation(request, options.columns);
  let gitResult: ExecResult;
  try {
    gitResult = await executeGit("env", ["-u", "GIT_EXTERNAL_DIFF", "git", ...invocation.args], {
      cwd,
      timeout: COMMAND_TIMEOUT_MS,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    if (options.signal?.aborted === true) throw new Error("Git diff was cancelled");
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not run Git diff: ${diagnostic(message)}`);
  }

  if (gitResult.killed) {
    if (options.signal?.aborted === true) throw new Error("Git diff was cancelled");
    throw new Error(`Git diff timed out after ${COMMAND_TIMEOUT_MS / 1_000} seconds`);
  }
  if (gitResult.code !== 0) {
    throw new Error(
      `Could not read Git diff:\n${diagnostic(gitResult.stderr || gitResult.stdout)}`,
    );
  }

  const noChanges = gitResult.stdout.trim() === "";
  const gitWarning = gitResult.stderr.trim() === "" ? undefined : diagnostic(gitResult.stderr);
  if (noChanges) {
    return {
      content:
        gitWarning === undefined
          ? `No ${invocation.scope}.`
          : `No ${invocation.scope}.\n\n${gitWarning}`,
      details: {
        display: invocation.display,
        noChanges: true,
        output: "",
        scope: invocation.scope,
        width: invocation.width,
        ...(gitWarning === undefined ? {} : { warning: gitWarning }),
      },
    };
  }

  const executeDelta = options.executeDelta ?? executeDeltaProcess;
  let deltaResult: ExecResult;
  try {
    deltaResult = await executeDelta(
      buildDeltaInvocation(invocation.display, invocation.width, {
        ...(options.syntaxTheme === undefined ? {} : { syntaxTheme: options.syntaxTheme }),
      }),
      gitResult.stdout,
      {
        cwd,
        timeout: COMMAND_TIMEOUT_MS,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
  } catch (error) {
    if (options.signal?.aborted === true) throw new Error("Delta Git diff was cancelled");
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not run Delta: ${diagnostic(message)}`);
  }

  if (deltaResult.killed) {
    if (options.signal?.aborted === true) throw new Error("Delta Git diff was cancelled");
    throw new Error(`Delta timed out after ${COMMAND_TIMEOUT_MS / 1_000} seconds`);
  }
  if (deltaResult.code !== 0) {
    throw new Error(
      `Could not render Git diff with Delta:\n${diagnostic(deltaResult.stderr || deltaResult.stdout)}`,
    );
  }

  const bounded = boundDiffOutput(deltaResult.stdout);
  const deltaWarning =
    deltaResult.stderr.trim() === "" ? undefined : diagnostic(deltaResult.stderr);
  let fullOutputPath: string | undefined;
  let saveWarning: string | undefined;
  if (bounded.truncation !== undefined) {
    try {
      const writer = options.writeFullOutput ?? writeFullOutput;
      fullOutputPath = await writer(stripSgr(sanitizeTerminalOutput(deltaResult.stdout)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      saveWarning = `Could not save the full diff: ${diagnostic(message)}`;
    }
  }
  const warning = [gitWarning, deltaWarning, saveWarning]
    .filter((value) => value !== undefined)
    .join("\n");
  const details: DeltaDetails = {
    display: invocation.display,
    noChanges: false,
    output: bounded.ansi,
    scope: invocation.scope,
    width: invocation.width,
    ...(bounded.truncation === undefined ? {} : { truncation: bounded.truncation }),
    ...(fullOutputPath === undefined ? {} : { fullOutputPath }),
    ...(warning === "" ? {} : { warning }),
  };

  const sections = [bounded.plain];
  if (bounded.truncation !== undefined) {
    sections.push(truncationNotice(bounded.truncation, fullOutputPath));
  }
  if (warning !== "") sections.push(`Warning: ${warning}`);
  return { content: sections.join("\n\n"), details };
}

function editTempFileName(path: string, prefix: string): string {
  const fileName = basename(path).replace(/[^\p{L}\p{N}._-]/gu, "_");
  return `${prefix}-${fileName || "file"}`;
}

function trimBlankOutputLines(output: string): string {
  const lines = output.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  while (lines.length > 0 && stripSgr(lines[0] ?? "").trim() === "") lines.shift();
  while (lines.length > 0 && stripSgr(lines.at(-1) ?? "").trim() === "") lines.pop();
  return lines.join("\n");
}

export async function runDeltaEditDiff(
  executeDelta: DeltaExecutor,
  request: DeltaEditRequest,
  cwd: string,
  options: RunOptions = {},
): Promise<DeltaDetails> {
  const width = effectiveWidth(options.columns);
  const display = width >= SIDE_BY_SIDE_MIN_WIDTH ? "side-by-side" : "inline";
  const directory = await mkdtemp(join(tmpdir(), "pi-delta-edit-"));
  const oldPath = join(directory, editTempFileName(request.path, "before"));
  const newPath = join(directory, editTempFileName(request.path, "after"));

  try {
    await writeFile(oldPath, request.oldContent, "utf8");
    await writeFile(newPath, request.newContent, "utf8");
    options.signal?.throwIfAborted();

    let result: ExecResult;
    try {
      result = await executeDelta(
        [
          ...buildDeltaInvocation(display, width, {
            edit: true,
            ...(request.context === undefined ? {} : { context: request.context }),
            ...(options.syntaxTheme === undefined ? {} : { syntaxTheme: options.syntaxTheme }),
          }),
          oldPath,
          newPath,
        ],
        undefined,
        {
          cwd,
          timeout: EDIT_COMMAND_TIMEOUT_MS,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        },
      );
    } catch (error) {
      if (options.signal?.aborted === true) throw new Error("Delta edit preview was cancelled");
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not run Delta edit preview: ${diagnostic(message)}`);
    }

    if (result.killed) {
      if (options.signal?.aborted === true) throw new Error("Delta edit preview was cancelled");
      throw new Error(
        `Delta edit preview timed out after ${EDIT_COMMAND_TIMEOUT_MS / 1_000} seconds`,
      );
    }
    // Delta forwards `git diff --no-index` status 1 when the compared files differ.
    if (result.code > 1 || (result.code === 1 && result.stdout.trim() === "")) {
      throw new Error(
        `Could not render edit preview with Delta:\n${diagnostic(result.stderr || result.stdout)}`,
      );
    }

    const output = trimBlankOutputLines(result.stdout);
    const bounded = boundDiffOutput(output);
    const noChanges = bounded.plain.trim() === "";
    const warningText = result.stderr.trim() === "" ? undefined : diagnostic(result.stderr);
    let fullOutputPath: string | undefined;
    let saveWarning: string | undefined;
    if (bounded.truncation !== undefined) {
      try {
        const writer = options.writeFullOutput ?? writeFullOutput;
        fullOutputPath = await writer(stripSgr(sanitizeTerminalOutput(output)));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        saveWarning = `Could not save the full diff: ${diagnostic(message)}`;
      }
    }

    const warning = [warningText, saveWarning].filter((value) => value !== undefined).join("\n");
    return {
      display,
      noChanges,
      output: bounded.ansi,
      scope: "edit changes",
      width,
      ...(bounded.truncation === undefined ? {} : { truncation: bounded.truncation }),
      ...(fullOutputPath === undefined ? {} : { fullOutputPath }),
      ...(warning === "" ? {} : { warning }),
    };
  } finally {
    await rm(directory, { force: true, recursive: true }).catch(() => undefined);
  }
}

export function renderDiffLines(lines: readonly string[], width: number): string[] {
  const availableWidth = Math.max(1, width);
  return lines.flatMap((line) => {
    const parts = line.split(LINE_FILL_MARKER);
    let filled = parts.shift() ?? "";
    for (const part of parts) {
      filled += " ".repeat(Math.max(0, availableWidth - visibleWidth(filled))) + part;
    }
    const wrapped = wrapTextWithAnsi(filled, availableWidth);
    return wrapped.length === 0 ? [""] : wrapped;
  });
}

class DiffOutputComponent implements Component {
  constructor(private readonly lines: readonly string[]) {}

  render(width: number): string[] {
    return renderDiffLines(this.lines, width);
  }

  invalidate(): void {}
}

function statusLine(theme: Theme, label: "Info" | "Warning", message: string): string {
  const color = label === "Warning" ? "warning" : "accent";
  return `${theme.fg(color, theme.bold(label.padEnd(7)))}  ${message}`;
}

function detailLines(value: string): string[] {
  const lines = value.split("\n");
  const first = lines[0] ?? "";
  return [first, ...lines.slice(1).map((line) => `  ${line}`)];
}

function diffComponent(
  details: DeltaDetails,
  expanded: boolean,
  theme: Theme,
  loading = false,
): Component {
  const lines = sourceLines(applyDiffTheme(details.output, theme));
  if (details.noChanges) {
    const output: string[] = [];
    if (details.warning !== undefined) {
      output.push(...detailLines(statusLine(theme, "Warning", details.warning)));
    }
    return new DiffOutputComponent(output);
  }

  const visible = expanded ? lines : lines.slice(0, COLLAPSED_LINES);
  const output = [...visible];
  if (!expanded && visible.length < lines.length) {
    output.push(
      "",
      statusLine(
        theme,
        "Info",
        `${lines.length - visible.length} more lines (${keyHint("app.tools.expand", "to expand")}).`,
      ),
    );
  }
  if (loading) {
    output.push("", statusLine(theme, "Info", "Rendering full diff..."));
  }
  if (details.truncation !== undefined) {
    output.push("", statusLine(theme, "Warning", "Diff output was truncated."));
    if (details.fullOutputPath !== undefined) {
      output.push(`  Full output  ${details.fullOutputPath}`);
    }
  }
  if (details.warning !== undefined) {
    output.push("", ...detailLines(statusLine(theme, "Warning", details.warning)));
  }
  return new DiffOutputComponent(output);
}

function renderExpandedGitDiff(
  details: DeltaDetails,
  request: GitDiffRequest,
  cwd: string,
  state: GitDiffRenderState,
  run: GitDiffRunner,
  expansionControllers: Set<AbortController>,
  invalidate: () => void,
): DeltaDetails {
  if (details.noChanges) return details;

  const expandedRequest = { ...request, context: FULL_CONTEXT_LINES };
  const requestKey = JSON.stringify(expandedRequest);
  if (state.expandedKey !== requestKey) {
    state.expandedController?.abort();
    if (state.expandedController !== undefined) {
      expansionControllers.delete(state.expandedController);
    }
    state.expandedController = undefined;
    state.expandedDetails = undefined;
    state.expandedKey = requestKey;
    state.expandedPending = false;
  }

  if (!state.expandedPending && state.expandedDetails === undefined) {
    const controller = new AbortController();
    state.expandedController = controller;
    state.expandedPending = true;
    expansionControllers.add(controller);
    void run(expandedRequest, cwd, controller.signal).then(
      (expandedResult) => {
        expansionControllers.delete(controller);
        if (
          state.expandedKey !== requestKey ||
          state.expandedController !== controller ||
          controller.signal.aborted
        ) {
          return;
        }
        state.expandedDetails = expandedResult.details;
        state.expandedPending = false;
        state.expandedController = undefined;
        invalidate();
      },
      () => {
        expansionControllers.delete(controller);
        if (
          state.expandedKey !== requestKey ||
          state.expandedController !== controller ||
          controller.signal.aborted
        ) {
          return;
        }
        state.expandedDetails = null;
        state.expandedPending = false;
        state.expandedController = undefined;
        invalidate();
      },
    );
  }

  return state.expandedDetails ?? details;
}

type NativeEditDefinition = ReturnType<typeof createEditToolDefinition>;
type NativeEditRenderCall = NonNullable<NativeEditDefinition["renderCall"]>;
type NativeEditInput = Parameters<NativeEditDefinition["execute"]>[1];
type NativeEditState = Parameters<NativeEditRenderCall>[2]["state"];

type DeltaEditDetails = EditToolDetails & {
  readonly delta?: DeltaDetails;
};

interface DeltaEditState {
  expandedPreview: DeltaDetails | null | undefined;
  expandedPreviewController: AbortController | undefined;
  expandedPreviewKey: string | undefined;
  expandedPreviewPending: boolean;
  preview: DeltaDetails | undefined;
  previewController: AbortController | undefined;
  previewKey: string | undefined;
  previewPending: boolean;
  previewRequest: DeltaEditRequest | undefined;
}

type DeltaEditRenderState = NativeEditState & DeltaEditState;
type DeltaEditToolDefinition = ToolDefinition<
  NativeEditDefinition["parameters"],
  DeltaEditDetails | undefined,
  DeltaEditRenderState
>;

function renderableEditInput(args: unknown): NativeEditInput | undefined {
  if (args === null || typeof args !== "object") return undefined;
  const record = args as Record<string, unknown>;
  const path = typeof record.path === "string" ? record.path : record.file_path;
  if (typeof path !== "string") return undefined;

  if (
    Array.isArray(record.edits) &&
    record.edits.every(
      (edit): edit is { oldText: string; newText: string } =>
        edit !== null &&
        typeof edit === "object" &&
        typeof (edit as Record<string, unknown>).oldText === "string" &&
        typeof (edit as Record<string, unknown>).newText === "string",
    )
  ) {
    return { path, edits: record.edits };
  }

  if (typeof record.oldText === "string" && typeof record.newText === "string") {
    return { path, edits: [{ oldText: record.oldText, newText: record.newText }] };
  }

  return undefined;
}

async function simulateEdit(
  cwd: string,
  input: NativeEditInput,
  signal: AbortSignal,
): Promise<DeltaEditRequest> {
  let oldContent: Buffer | undefined;
  let newContent: string | undefined;
  const operations: EditOperations = {
    access: (path) => fsAccess(path, constants.R_OK | constants.W_OK),
    readFile: async (path) => {
      const content = await fsReadFile(path);
      oldContent = content;
      return content;
    },
    writeFile: async (_path, content) => {
      newContent = content;
    },
  };
  const previewTool = createEditToolDefinition(cwd, { operations });

  // The built-in edit executor currently ignores its context; renderCall has no ExtensionContext.
  // Keep this simulation delegated to Pi so matching and line-ending behavior stay identical.
  await previewTool.execute("delta-preview", input, signal, undefined, {
    cwd,
  } as ExtensionContext);
  if (oldContent === undefined || newContent === undefined) {
    throw new Error("Pi did not return enough data to render the edit preview");
  }

  return {
    newContent,
    oldContent: oldContent.toString("utf8"),
    path: input.path,
  };
}

function editDeltaState(state: NativeEditState): DeltaEditRenderState {
  return state as DeltaEditRenderState;
}

function replaceEditPreview(
  component: Component,
  details: DeltaDetails,
  expanded: boolean,
  theme: Theme,
  loading = false,
): Component {
  if (!(component instanceof Box)) return component;
  const header = component.children[0];
  component.clear();
  if (header !== undefined) component.addChild(header);
  component.addChild(new Spacer(1));
  component.addChild(diffComponent(details, expanded, theme, loading));
  component.setBgFn((text) => theme.bg("toolSuccessBg", text));
  return component;
}

function renderExpandedEditPreview(
  details: DeltaDetails,
  request: DeltaEditRequest,
  cwd: string,
  state: DeltaEditState,
  runEdit: EditDiffRunner,
  expansionControllers: Set<AbortController>,
  invalidate: () => void,
): DeltaDetails {
  if (details.noChanges) return details;

  const expandedRequest = { ...request, context: FULL_CONTEXT_LINES };
  const requestKey = JSON.stringify(expandedRequest);
  if (state.expandedPreviewKey !== requestKey) {
    state.expandedPreviewController?.abort();
    if (state.expandedPreviewController !== undefined) {
      expansionControllers.delete(state.expandedPreviewController);
    }
    state.expandedPreviewController = undefined;
    state.expandedPreview = undefined;
    state.expandedPreviewKey = requestKey;
    state.expandedPreviewPending = false;
  }

  if (!state.expandedPreviewPending && state.expandedPreview === undefined) {
    const controller = new AbortController();
    state.expandedPreviewController = controller;
    state.expandedPreviewPending = true;
    expansionControllers.add(controller);
    void runEdit(expandedRequest, cwd, controller.signal).then(
      (expandedDetails) => {
        expansionControllers.delete(controller);
        if (
          state.expandedPreviewKey !== requestKey ||
          state.expandedPreviewController !== controller ||
          controller.signal.aborted
        ) {
          return;
        }
        state.expandedPreview = expandedDetails;
        state.expandedPreviewPending = false;
        state.expandedPreviewController = undefined;
        invalidate();
      },
      () => {
        expansionControllers.delete(controller);
        if (
          state.expandedPreviewKey !== requestKey ||
          state.expandedPreviewController !== controller ||
          controller.signal.aborted
        ) {
          return;
        }
        state.expandedPreview = null;
        state.expandedPreviewPending = false;
        state.expandedPreviewController = undefined;
        invalidate();
      },
    );
  }

  return state.expandedPreview ?? details;
}

function renderEditDeltaResult(
  result: { content: Array<{ type: string; text?: string }> },
  details: DeltaDetails,
  expanded: boolean,
  theme: Theme,
): Component {
  const component = new Container();
  const summary = result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("\n");
  if (summary !== "") {
    component.addChild(new Spacer(1));
    component.addChild(new Text(theme.fg("success", summary), 1, 0));
  }
  component.addChild(new Spacer(1));
  component.addChild(diffComponent(details, expanded, theme));
  return component;
}

function createDeltaEditTool(
  cwd: string,
  runEdit: EditDiffRunner,
  previewControllers: Set<AbortController>,
): ToolDefinition<
  NativeEditDefinition["parameters"],
  DeltaEditDetails | undefined,
  DeltaEditRenderState
> {
  const nativeEdit = createEditToolDefinition(cwd);
  const nativeRenderCall = nativeEdit.renderCall;
  const nativeRenderResult = nativeEdit.renderResult;
  if (nativeRenderCall === undefined || nativeRenderResult === undefined) {
    throw new Error("Pi's built-in edit tool does not expose renderers");
  }

  const execute: DeltaEditToolDefinition["execute"] = async (
    toolCallId,
    input,
    signal,
    onUpdate,
    ctx,
  ) => {
    let oldContent: Buffer | undefined;
    let newContent: string | undefined;
    const operations: EditOperations = {
      access: (path) => fsAccess(path, constants.R_OK | constants.W_OK),
      readFile: async (path) => {
        const content = await fsReadFile(path);
        oldContent = content;
        return content;
      },
      writeFile: async (path, content) => {
        await writeFile(path, content, "utf8");
        newContent = content;
      },
    };
    const delegatedEdit = createEditToolDefinition(cwd, { operations });
    const result = await delegatedEdit.execute(toolCallId, input, signal, onUpdate, ctx);

    if (result.details !== undefined && oldContent !== undefined && newContent !== undefined) {
      try {
        const delta = await runEdit(
          {
            newContent,
            oldContent: oldContent.toString("utf8"),
            path: input.path,
          },
          cwd,
          signal,
        );
        return {
          ...result,
          details: { ...result.details, delta },
        };
      } catch {
        // Delta is presentation-only. Preserve the successful native edit result if it fails.
      }
    }

    return result;
  };

  const renderCall: NonNullable<
    ToolDefinition<
      NativeEditDefinition["parameters"],
      DeltaEditDetails | undefined,
      DeltaEditRenderState
    >["renderCall"]
  > = (args, theme, context) => {
    const state = editDeltaState(context.state);
    const input = renderableEditInput(args);
    const key = input === undefined ? undefined : JSON.stringify(input);
    if (state.previewKey !== key) {
      const previousController = state.previewController;
      previousController?.abort();
      if (previousController !== undefined) previewControllers.delete(previousController);
      state.previewController = undefined;
      state.preview = undefined;
      state.previewRequest = undefined;
      state.previewKey = key;
      state.previewPending = false;
      state.expandedPreviewController?.abort();
      if (state.expandedPreviewController !== undefined) {
        previewControllers.delete(state.expandedPreviewController);
      }
      state.expandedPreviewController = undefined;
      state.expandedPreview = undefined;
      state.expandedPreviewKey = undefined;
      state.expandedPreviewPending = false;
    }

    if (
      context.argsComplete &&
      input !== undefined &&
      !state.previewPending &&
      state.preview === undefined
    ) {
      const controller = new AbortController();
      const requestKey = key;
      state.previewController = controller;
      state.previewPending = true;
      previewControllers.add(controller);
      void simulateEdit(context.cwd, input, controller.signal)
        .then((request) =>
          runEdit(request, context.cwd, controller.signal).then((details) => ({
            details,
            request,
          })),
        )
        .then(
          ({ details, request }) => {
            previewControllers.delete(controller);
            if (
              state.previewKey !== requestKey ||
              controller.signal.aborted ||
              state.previewController !== controller
            ) {
              return;
            }
            state.preview = details;
            state.previewRequest = request;
            state.previewPending = false;
            state.previewController = undefined;
            context.invalidate();
          },
          () => {
            previewControllers.delete(controller);
            if (
              state.previewKey !== requestKey ||
              controller.signal.aborted ||
              state.previewController !== controller
            ) {
              return;
            }
            state.previewPending = false;
            state.previewController = undefined;
            context.invalidate();
          },
        );
    }

    const nativeComponent = nativeRenderCall(args, theme, context);
    const preview =
      context.expanded && state.preview !== undefined && state.previewRequest !== undefined
        ? renderExpandedEditPreview(
            state.preview,
            state.previewRequest,
            context.cwd,
            state,
            runEdit,
            previewControllers,
            context.invalidate,
          )
        : state.preview;
    return preview === undefined
      ? nativeComponent
      : replaceEditPreview(
          nativeComponent,
          preview,
          context.expanded,
          theme,
          context.expanded && state.expandedPreviewPending,
        );
  };

  const renderResult: NonNullable<
    ToolDefinition<
      NativeEditDefinition["parameters"],
      DeltaEditDetails | undefined,
      DeltaEditRenderState
    >["renderResult"]
  > = (result, options, theme, context) => {
    const delta = result.details?.delta;
    if (!context.isError && delta !== undefined) {
      const expandedDelta =
        options.expanded &&
        context.state.preview !== undefined &&
        context.state.previewRequest !== undefined
          ? renderExpandedEditPreview(
              context.state.preview,
              context.state.previewRequest,
              context.cwd,
              context.state,
              runEdit,
              previewControllers,
              context.invalidate,
            )
          : delta;
      if (context.state.preview?.output === delta.output) {
        const component =
          context.lastComponent instanceof Container ? context.lastComponent : new Container();
        component.clear();
        return component;
      }
      return renderEditDeltaResult(result, expandedDelta, options.expanded, theme);
    }
    return nativeRenderResult(result, options, theme, context);
  };

  return {
    ...nativeEdit,
    execute,
    renderCall,
    renderResult,
  };
}

function commandHelp(): string {
  return [
    "Usage: /delta",
    "",
    "Show unstaged working-tree changes using Delta.",
    "Ask the agent to use `git_diff` for staged changes, revisions, or path filters.",
    "Set `editPreviews` to true in ~/.pi/agent/delta.json to use Delta for edit previews.",
  ].join("\n");
}

interface DeltaExtensionDependencies {
  readonly columns?: () => number | undefined;
  readonly config?: DeltaConfig;
  readonly editPreviews?: (context: ExtensionContext) => boolean;
  readonly executeDelta?: DeltaExecutor;
  readonly run?: GitDiffRunner;
  readonly runEdit?: EditDiffRunner;
}

export interface DeltaConfig {
  readonly editPreviews?: boolean;
  readonly syntaxTheme?: string;
}

export function loadDeltaConfig(agentDirectory = getAgentDir()): DeltaConfig {
  const value = readJsonConfig(globalExtensionConfigPath("delta", agentDirectory));
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("delta config: expected an object");
  }

  const config = value as Record<string, unknown>;
  const knownFields = new Set(["editPreviews", "syntaxTheme"]);
  const unknownField = Object.keys(config).find((field) => !knownFields.has(field));
  if (unknownField !== undefined) {
    throw new Error(`delta config.${unknownField}: unknown field`);
  }
  if (config.editPreviews !== undefined && typeof config.editPreviews !== "boolean") {
    throw new Error("delta config.editPreviews: expected a boolean");
  }
  if (config.syntaxTheme !== undefined) {
    if (typeof config.syntaxTheme !== "string" || config.syntaxTheme.trim() === "") {
      throw new Error("delta config.syntaxTheme: expected a non-empty string");
    }
    safeInput(config.syntaxTheme, "delta config.syntaxTheme");
  }

  return config as DeltaConfig;
}

export function registerDeltaExtension(
  pi: ExtensionAPI,
  dependencies: DeltaExtensionDependencies = {},
): void {
  const config = dependencies.config ?? loadDeltaConfig();
  const executeDelta = dependencies.executeDelta ?? executeDeltaProcess;
  const syntaxTheme = config.syntaxTheme ?? DEFAULT_SYNTAX_THEME;
  const run: GitDiffRunner =
    dependencies.run ??
    ((request, cwd, signal) =>
      runDeltaGitDiff((command, args, options) => pi.exec(command, args, options), request, cwd, {
        columns: dependencies.columns?.() ?? process.stdout.columns,
        executeDelta,
        ...(signal === undefined ? {} : { signal }),
        syntaxTheme,
      }));
  const runEdit: EditDiffRunner =
    dependencies.runEdit ??
    ((request, cwd, signal) =>
      runDeltaEditDiff(executeDelta, request, cwd, {
        columns: dependencies.columns?.() ?? process.stdout.columns,
        ...(signal === undefined ? {} : { signal }),
        syntaxTheme,
      }));

  const previewControllers = new Set<AbortController>();
  const expansionControllers = new Set<AbortController>();
  const shouldUseEditPreviews = dependencies.editPreviews ?? (() => config.editPreviews === true);
  pi.on("session_shutdown", () => {
    for (const controller of previewControllers) controller.abort();
    for (const controller of expansionControllers) controller.abort();
    previewControllers.clear();
    expansionControllers.clear();
  });

  pi.on("session_start", (_event, ctx) => {
    if (shouldUseEditPreviews(ctx)) {
      pi.registerTool(createDeltaEditTool(ctx.cwd, runEdit, previewControllers));
    }
  });

  pi.registerEntryRenderer<DeltaDetails>(ENTRY_TYPE, (entry, { expanded }, theme) => {
    const details = entry.data;
    return details === undefined
      ? new Text(theme.fg("warning", "Delta diff data is unavailable."), 0, 0)
      : diffComponent(details, expanded, theme);
  });

  pi.registerTool(
    defineTool<typeof GitDiffParameters, DeltaDetails, GitDiffRenderState>({
      name: "git_diff",
      label: "Delta Git diff",
      description:
        "Render a read-only syntax-highlighted Git diff with Delta. Supports unstaged or staged changes, one revision/range, and optional pathspecs. Untracked files are excluded. Output is truncated to 2000 lines or 50KB; full truncated output is saved to a temporary file.",
      promptSnippet: "Render syntax-highlighted Git diffs with Delta",
      promptGuidelines: [
        "Use git_diff instead of bash when visually inspecting textual Git changes; use git status for summaries and git diff --check for validation.",
      ],
      parameters: GitDiffParameters,

      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        const result = await run(params, ctx.cwd, signal);
        return {
          content: [{ type: "text", text: result.content }],
          details: result.details,
        };
      },

      renderCall(args, theme) {
        const parts = [theme.fg("toolTitle", theme.bold("git diff"))];
        if (args.staged === true) parts.push(theme.fg("accent", "--staged"));
        if (args.revision !== undefined) {
          parts.push(theme.fg("accent", safeInput(args.revision, "Git revision")));
        }
        if (args.paths !== undefined && args.paths.length > 0) {
          const pathSummary = `${args.paths.length} ${args.paths.length === 1 ? "path" : "paths"}`;
          parts.push(theme.fg("muted", `-- ${pathSummary}`));
        }
        return new Text(parts.join(" "), 0, 0);
      },

      renderResult(result, { expanded }, theme, context) {
        const details = expanded
          ? renderExpandedGitDiff(
              result.details,
              context.args,
              context.cwd,
              context.state,
              run,
              expansionControllers,
              context.invalidate,
            )
          : result.details;
        const component = new Container();
        component.addChild(new Spacer(1));
        component.addChild(
          diffComponent(details, expanded, theme, expanded && context.state.expandedPending),
        );
        return component;
      },
    }),
  );

  pi.registerCommand("delta", {
    description: "Show the unstaged syntax-highlighted Git diff",
    handler: async (args, ctx) => {
      const input = args.trim();
      if (input === "-h" || input === "--help") {
        ctx.ui.notify(commandHelp(), "info");
        return;
      }
      if (input !== "") {
        ctx.ui.notify(commandHelp(), "error");
        return;
      }

      if (ctx.mode !== "tui") {
        ctx.ui.notify("/delta requires interactive mode.", "error");
        return;
      }

      const outcome = await ctx.ui.custom<DiffCommandOutcome>((tui, theme, _keybindings, done) => {
        const loader = new BorderedLoader(tui, theme, "Rendering Git diff with Delta...");
        let settled = false;
        const finish = (result: DiffCommandOutcome) => {
          if (settled) return;
          settled = true;
          done(result);
        };
        loader.onAbort = () => finish({ status: "cancelled" });
        run({}, ctx.cwd, loader.signal).then(
          (result) => finish({ result, status: "success" }),
          (error: unknown) => {
            if (loader.signal.aborted) {
              finish({ status: "cancelled" });
              return;
            }
            const message = error instanceof Error ? error.message : String(error);
            finish({ message: diagnostic(message), status: "error" });
          },
        );
        return loader;
      });

      if (outcome.status === "cancelled") {
        ctx.ui.notify("Delta diff cancelled.", "info");
        return;
      }
      if (outcome.status === "error") {
        ctx.ui.notify(outcome.message, "error");
        return;
      }
      pi.appendEntry<DeltaDetails>(ENTRY_TYPE, outcome.result.details);
    },
  });
}

export default function deltaExtension(pi: ExtensionAPI): void {
  registerDeltaExtension(pi);
}
