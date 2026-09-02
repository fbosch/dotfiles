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
  SettingsManager,
  type Theme,
  type ThemeColor,
  type ToolDefinition,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import {
  Box,
  type Component,
  Container,
  Spacer,
  Text,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

const COMMAND_TIMEOUT_MS = 60_000;
const EDIT_COMMAND_TIMEOUT_MS = 10_000;
// Keep expansion within the renderer's existing bounded-output contract.
const FULL_CONTEXT_LINES = DEFAULT_MAX_LINES;
const DEFAULT_CONTEXT_LINES = 3;
const DEFAULT_WIDTH = 120;
const MIN_WIDTH = 40;
const MAX_WIDTH = 240;
const SIDE_BY_SIDE_MIN_WIDTH = 96;
const COLLAPSED_LINES = 24;
const MAX_PATHS = 100;
const ENTRY_TYPE = "difftastic-git-diff";
const ESCAPE = "\u001b";
const SGR_SUFFIX_PATTERN = /^\[[0-9;]*m/;
const ESCAPE_SUFFIX_PATTERN = /^\[[0-?]*[ -/]*[@-~]/;

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

export interface DifftasticDetails {
  readonly display: "side-by-side" | "inline";
  readonly fullOutputPath?: string;
  readonly noChanges: boolean;
  readonly output: string;
  readonly scope: string;
  readonly truncation?: DiffTruncation;
  readonly warning?: string;
  readonly width: number;
}

export interface DifftasticResult {
  readonly content: string;
  readonly details: DifftasticDetails;
}

interface GitDiffRenderState {
  expandedController: AbortController | undefined;
  expandedDetails: DifftasticDetails | null | undefined;
  expandedKey: string | undefined;
  expandedPending: boolean;
}

export type GitDiffExecutor = (
  command: string,
  args: string[],
  options: ExecOptions,
) => Promise<ExecResult>;

export type GitDiffRunner = (
  request: GitDiffRequest,
  cwd: string,
  signal?: AbortSignal,
) => Promise<DifftasticResult>;

export interface DifftasticEditRequest {
  readonly context?: number;
  readonly newContent: string;
  readonly oldContent: string;
  readonly path: string;
}

export type EditDiffRunner = (
  request: DifftasticEditRequest,
  cwd: string,
  signal?: AbortSignal,
) => Promise<DifftasticDetails>;

interface RunOptions {
  readonly columns?: number;
  readonly signal?: AbortSignal;
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
  | { readonly result: DifftasticResult; readonly status: "success" };

function printableCharacter(value: string): boolean {
  return /^\P{C}$/u.test(value);
}

/** Preserve Difftastic SGR colors while rejecting source-derived terminal control sequences. */
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

function themeColorForDifftasticCode(code: number): ThemeColor | undefined {
  switch (code) {
    case 31:
    case 91:
      return "toolDiffRemoved";
    case 32:
    case 92:
      return "toolDiffAdded";
    case 33:
    case 93:
      return "accent";
    case 34:
    case 94:
      return "syntaxComment";
    case 35:
    case 95:
      return "syntaxString";
    default:
      return undefined;
  }
}

function remapSgr(suffix: string, theme: Pick<Theme, "getFgAnsi">): string {
  const codes = suffix
    .slice(1, -1)
    .split(";")
    .map((value) => Number(value));
  return codes
    .map((code) => {
      const color = themeColorForDifftasticCode(code);
      return color === undefined ? `${ESCAPE}[${code}m` : theme.getFgAnsi(color);
    })
    .join("");
}

export function remapDifftasticColors(value: string, theme: Pick<Theme, "getFgAnsi">): string {
  return sanitizeTerminalOutput(value)
    .split(ESCAPE)
    .map((part, index) => {
      if (index === 0) return part;
      const suffix = SGR_SUFFIX_PATTERN.exec(part)?.[0];
      if (suffix === undefined) return part;
      return `${remapSgr(suffix, theme)}${part.slice(suffix.length)}`;
    })
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
  const externalDiff = [
    "difft",
    `--display=${display}`,
    "--color=always",
    `--width=${width}`,
    `--context=${context}`,
  ].join(" ");
  const args = ["--no-pager", "-c", `diff.external=${externalDiff}`, "diff"];
  if (request.staged === true) args.push("--cached");
  if (revision !== undefined) args.push(revision);
  if (paths.length > 0) args.push("--", ...paths);

  return { args, display, scope: describeScope(request), width };
}

async function writeFullOutput(output: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-difftastic-"));
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

export async function runDifftasticGitDiff(
  execute: GitDiffExecutor,
  request: GitDiffRequest,
  cwd: string,
  options: RunOptions = {},
): Promise<DifftasticResult> {
  const invocation = buildGitInvocation(request, options.columns);
  let result: ExecResult;
  try {
    result = await execute("env", ["-u", "GIT_EXTERNAL_DIFF", "git", ...invocation.args], {
      cwd,
      timeout: COMMAND_TIMEOUT_MS,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    if (options.signal?.aborted === true) throw new Error("Structural Git diff was cancelled");
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not run structural Git diff: ${diagnostic(message)}`);
  }

  if (result.killed) {
    if (options.signal?.aborted === true) throw new Error("Structural Git diff was cancelled");
    throw new Error(`Structural Git diff timed out after ${COMMAND_TIMEOUT_MS / 1_000} seconds`);
  }
  if (result.code !== 0) {
    throw new Error(
      `Could not render structural Git diff:\n${diagnostic(result.stderr || result.stdout)}`,
    );
  }

  const bounded = boundDiffOutput(result.stdout);
  const noChanges = bounded.plain.trim() === "";
  const warningText = result.stderr.trim() === "" ? undefined : diagnostic(result.stderr);
  let fullOutputPath: string | undefined;
  let saveWarning: string | undefined;
  if (bounded.truncation !== undefined) {
    try {
      const writer = options.writeFullOutput ?? writeFullOutput;
      fullOutputPath = await writer(stripSgr(sanitizeTerminalOutput(result.stdout)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      saveWarning = `Could not save the full diff: ${diagnostic(message)}`;
    }
  }
  const warning = [warningText, saveWarning].filter((value) => value !== undefined).join("\n");
  const details: DifftasticDetails = {
    display: invocation.display,
    noChanges,
    output: bounded.ansi,
    scope: invocation.scope,
    width: invocation.width,
    ...(bounded.truncation === undefined ? {} : { truncation: bounded.truncation }),
    ...(fullOutputPath === undefined ? {} : { fullOutputPath }),
    ...(warning === "" ? {} : { warning }),
  };

  if (noChanges) {
    return {
      content: warning === "" ? `No ${invocation.scope}.` : `No ${invocation.scope}.\n\n${warning}`,
      details,
    };
  }

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

function editDiffOutputPath(
  output: string,
  oldPath: string,
  newPath: string,
  path: string,
): string {
  return output.replaceAll(oldPath, `${path} (before)`).replaceAll(newPath, path);
}

function removeDifftasticFileHeader(output: string): string {
  const [firstLine, ...remainingLines] = output.split("\n");
  return firstLine !== undefined && stripSgr(firstLine).includes(" --- ")
    ? remainingLines.join("\n")
    : output;
}

export async function runDifftasticEditDiff(
  execute: GitDiffExecutor,
  request: DifftasticEditRequest,
  cwd: string,
  options: RunOptions = {},
): Promise<DifftasticDetails> {
  const width = effectiveWidth(options.columns);
  const display = width >= SIDE_BY_SIDE_MIN_WIDTH ? "side-by-side" : "inline";
  const directory = await mkdtemp(join(tmpdir(), "pi-difftastic-edit-"));
  const oldPath = join(directory, editTempFileName(request.path, "before"));
  const newPath = join(directory, editTempFileName(request.path, "after"));

  try {
    await writeFile(oldPath, request.oldContent, "utf8");
    await writeFile(newPath, request.newContent, "utf8");
    options.signal?.throwIfAborted();

    let result: ExecResult;
    try {
      result = await execute(
        "difft",
        [
          `--display=${display}`,
          "--color=always",
          `--width=${width}`,
          `--context=${request.context ?? DEFAULT_CONTEXT_LINES}`,
          oldPath,
          newPath,
        ],
        {
          cwd,
          timeout: EDIT_COMMAND_TIMEOUT_MS,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        },
      );
    } catch (error) {
      if (options.signal?.aborted === true) throw new Error("Structural edit diff was cancelled");
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not render structural edit diff: ${diagnostic(message)}`);
    }

    if (result.killed) {
      if (options.signal?.aborted === true) throw new Error("Structural edit diff was cancelled");
      throw new Error(
        `Could not render structural edit diff: timed out after ${EDIT_COMMAND_TIMEOUT_MS / 1_000} seconds`,
      );
    }
    if (result.code !== 0) {
      throw new Error(
        `Could not render structural edit diff:\n${diagnostic(result.stderr || result.stdout)}`,
      );
    }

    const output = removeDifftasticFileHeader(
      editDiffOutputPath(result.stdout, oldPath, newPath, request.path),
    );
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
    const wrapped = wrapTextWithAnsi(line, availableWidth);
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
  details: DifftasticDetails,
  expanded: boolean,
  theme: Theme,
  loading = false,
): Component {
  const lines = sourceLines(remapDifftasticColors(details.output, theme));
  if (details.noChanges) {
    const output = [statusLine(theme, "Info", `No ${details.scope}.`)];
    if (details.warning !== undefined) {
      output.push("", ...detailLines(statusLine(theme, "Warning", details.warning)));
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
  details: DifftasticDetails,
  request: GitDiffRequest,
  cwd: string,
  state: GitDiffRenderState,
  run: GitDiffRunner,
  expansionControllers: Set<AbortController>,
  invalidate: () => void,
): DifftasticDetails {
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

type DifftasticEditDetails = EditToolDetails & {
  readonly difftastic?: DifftasticDetails;
};

interface DifftasticEditState {
  expandedPreview: DifftasticDetails | null | undefined;
  expandedPreviewController: AbortController | undefined;
  expandedPreviewKey: string | undefined;
  expandedPreviewPending: boolean;
  preview: DifftasticDetails | undefined;
  previewController: AbortController | undefined;
  previewKey: string | undefined;
  previewPending: boolean;
  previewRequest: DifftasticEditRequest | undefined;
}

type DifftasticEditRenderState = NativeEditState & DifftasticEditState;
type DifftasticEditToolDefinition = ToolDefinition<
  NativeEditDefinition["parameters"],
  DifftasticEditDetails | undefined,
  DifftasticEditRenderState
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
): Promise<DifftasticEditRequest> {
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
  await previewTool.execute("difftastic-preview", input, signal, undefined, {
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

function editDifftasticState(state: NativeEditState): DifftasticEditRenderState {
  return state as DifftasticEditRenderState;
}

function replaceEditPreview(
  component: Component,
  details: DifftasticDetails,
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
  details: DifftasticDetails,
  request: DifftasticEditRequest,
  cwd: string,
  state: DifftasticEditState,
  runEdit: EditDiffRunner,
  expansionControllers: Set<AbortController>,
  invalidate: () => void,
): DifftasticDetails {
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

function renderEditDifftasticResult(
  result: { content: Array<{ type: string; text?: string }> },
  details: DifftasticDetails,
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

function createDifftasticEditTool(
  cwd: string,
  runEdit: EditDiffRunner,
  previewControllers: Set<AbortController>,
): ToolDefinition<
  NativeEditDefinition["parameters"],
  DifftasticEditDetails | undefined,
  DifftasticEditRenderState
> {
  const nativeEdit = createEditToolDefinition(cwd);
  const nativeRenderCall = nativeEdit.renderCall;
  const nativeRenderResult = nativeEdit.renderResult;
  if (nativeRenderCall === undefined || nativeRenderResult === undefined) {
    throw new Error("Pi's built-in edit tool does not expose renderers");
  }

  const execute: DifftasticEditToolDefinition["execute"] = async (
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
        const difftastic = await runEdit(
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
          details: { ...result.details, difftastic },
        };
      } catch {
        // Difftastic is presentation-only. Preserve the successful native edit result if it fails.
      }
    }

    return result;
  };

  const renderCall: NonNullable<
    ToolDefinition<
      NativeEditDefinition["parameters"],
      DifftasticEditDetails | undefined,
      DifftasticEditRenderState
    >["renderCall"]
  > = (args, theme, context) => {
    const state = editDifftasticState(context.state);
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
      DifftasticEditDetails | undefined,
      DifftasticEditRenderState
    >["renderResult"]
  > = (result, options, theme, context) => {
    const difftastic = result.details?.difftastic;
    if (!context.isError && difftastic !== undefined) {
      const expandedDifftastic =
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
          : difftastic;
      if (context.state.preview?.output === difftastic.output) {
        const component =
          context.lastComponent instanceof Container ? context.lastComponent : new Container();
        component.clear();
        return component;
      }
      return renderEditDifftasticResult(result, expandedDifftastic, options.expanded, theme);
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
    "Usage: /difft",
    "",
    "Show unstaged working-tree changes using Difftastic.",
    "Ask the agent to use `git_diff` for staged changes, revisions, or path filters.",
    "Set `difftasticEditPreviews` to true in ~/.pi/agent/settings.json to use Difftastic for edit previews.",
  ].join("\n");
}

interface DifftasticExtensionDependencies {
  readonly columns?: () => number | undefined;
  readonly editPreviews?: (context: ExtensionContext) => boolean;
  readonly run?: GitDiffRunner;
  readonly runEdit?: EditDiffRunner;
}

interface DifftasticSettings {
  readonly difftasticEditPreviews?: boolean;
}

function editPreviewsEnabled(context: ExtensionContext): boolean {
  const settings = SettingsManager.create(
    context.cwd,
    getAgentDir(),
  ).getGlobalSettings() as DifftasticSettings;
  return settings.difftasticEditPreviews === true;
}

export function registerDifftasticExtension(
  pi: ExtensionAPI,
  dependencies: DifftasticExtensionDependencies = {},
): void {
  const run: GitDiffRunner =
    dependencies.run ??
    ((request, cwd, signal) =>
      runDifftasticGitDiff(
        (command, args, options) => pi.exec(command, args, options),
        request,
        cwd,
        {
          columns: dependencies.columns?.() ?? process.stdout.columns,
          ...(signal === undefined ? {} : { signal }),
        },
      ));
  const runEdit: EditDiffRunner =
    dependencies.runEdit ??
    ((request, cwd, signal) =>
      runDifftasticEditDiff(
        (command, args, options) => pi.exec(command, args, options),
        request,
        cwd,
        {
          columns: dependencies.columns?.() ?? process.stdout.columns,
          ...(signal === undefined ? {} : { signal }),
        },
      ));

  const previewControllers = new Set<AbortController>();
  const expansionControllers = new Set<AbortController>();
  const shouldUseEditPreviews = dependencies.editPreviews ?? editPreviewsEnabled;
  pi.on("session_shutdown", () => {
    for (const controller of previewControllers) controller.abort();
    for (const controller of expansionControllers) controller.abort();
    previewControllers.clear();
    expansionControllers.clear();
  });

  pi.on("session_start", (_event, ctx) => {
    if (shouldUseEditPreviews(ctx)) {
      pi.registerTool(createDifftasticEditTool(ctx.cwd, runEdit, previewControllers));
    }
  });

  pi.registerEntryRenderer<DifftasticDetails>(ENTRY_TYPE, (entry, { expanded }, theme) => {
    const details = entry.data;
    return details === undefined
      ? new Text(theme.fg("warning", "Difftastic diff data is unavailable."), 0, 0)
      : diffComponent(details, expanded, theme);
  });

  pi.registerTool(
    defineTool<typeof GitDiffParameters, DifftasticDetails, GitDiffRenderState>({
      name: "git_diff",
      label: "Difftastic Git diff",
      description:
        "Render a read-only structural Git diff with Difftastic. Supports unstaged or staged changes, one revision/range, and optional pathspecs. Untracked files are excluded. Output is truncated to 2000 lines or 50KB; full truncated output is saved to a temporary file.",
      promptSnippet: "Render structural Git diffs with Difftastic",
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
          const pathSummary =
            args.paths.length === 1
              ? safeInput(args.paths[0] ?? "", "Git pathspec")
              : `${args.paths.length} paths`;
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

  pi.registerCommand("difft", {
    description: "Show the unstaged structural Git diff",
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
        ctx.ui.notify("/difft requires interactive mode.", "error");
        return;
      }

      const outcome = await ctx.ui.custom<DiffCommandOutcome>((tui, theme, _keybindings, done) => {
        const loader = new BorderedLoader(tui, theme, "Rendering structural Git diff...");
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
        ctx.ui.notify("Difftastic diff cancelled.", "info");
        return;
      }
      if (outcome.status === "error") {
        ctx.ui.notify(outcome.message, "error");
        return;
      }
      pi.appendEntry<DifftasticDetails>(ENTRY_TYPE, outcome.result.details);
    },
  });
}

export default function difftasticExtension(pi: ExtensionAPI): void {
  registerDifftasticExtension(pi);
}
