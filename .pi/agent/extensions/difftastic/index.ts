import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  BorderedLoader,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  defineTool,
  type ExecOptions,
  type ExecResult,
  type ExtensionAPI,
  formatSize,
  keyHint,
  type Theme,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { type Component, Text, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const COMMAND_TIMEOUT_MS = 60_000;
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

function diffComponent(details: DifftasticDetails, expanded: boolean, theme: Theme): Component {
  const lines = sourceLines(details.output);
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

function commandHelp(): string {
  return [
    "Usage: /difft",
    "",
    "Show unstaged working-tree changes using Difftastic.",
    "Ask the agent to use `git_diff` for staged changes, revisions, or path filters.",
  ].join("\n");
}

interface DifftasticExtensionDependencies {
  readonly columns?: () => number | undefined;
  readonly run?: GitDiffRunner;
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

  pi.registerEntryRenderer<DifftasticDetails>(ENTRY_TYPE, (entry, { expanded }, theme) => {
    const details = entry.data;
    return details === undefined
      ? new Text(theme.fg("warning", "Difftastic diff data is unavailable."), 0, 0)
      : diffComponent(details, expanded, theme);
  });

  pi.registerTool(
    defineTool<typeof GitDiffParameters, DifftasticDetails>({
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

      renderResult(result, { expanded }, theme) {
        return diffComponent(result.details, expanded, theme);
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
