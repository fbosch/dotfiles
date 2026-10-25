import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import {
  type ExecResult,
  formatSize,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { parsePatch, type StructuredPatch, structuredPatch } from "diff";
import {
  boundDiffOutput,
  buildGitInvocation,
  COMMAND_TIMEOUT_MS,
  DEFAULT_CONTEXT_LINES,
  type DiffDetails,
  type DiffResult,
  type DiffTruncation,
  diagnostic,
  EDIT_DIFF_TIMEOUT_MS,
  type EditDiffRequest,
  effectiveWidth,
  type GitDiffExecutor,
  type GitDiffRequest,
  type RunOptions,
  SIDE_BY_SIDE_MIN_WIDTH,
  stripSgrCodes,
} from "./shared";

async function writeFullOutput(output: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-diff-rendering-"));
  const path = join(directory, "diff.txt");
  await withFileMutationQueue(path, () => writeFile(path, output, "utf8"));
  return path;
}

function truncationNotice(truncation: DiffTruncation, fullOutputPath?: string): string {
  const summary = `[Diff output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
  return fullOutputPath === undefined
    ? `${summary} Full output could not be saved.]`
    : `${summary} Full output saved to: ${fullOutputPath}]`;
}

async function boundedDetails(
  rendered: { output: string; display: "inline" | "side-by-side"; warning?: string },
  scope: string,
  width: number,
  options: RunOptions,
  warnings: readonly (string | undefined)[] = [],
): Promise<DiffDetails> {
  options.signal?.throwIfAborted();
  const bounded = boundDiffOutput(rendered.output);
  const notices = [...warnings, rendered.warning];
  let fullOutputPath: string | undefined;
  if (bounded.truncation) {
    try {
      fullOutputPath = await (options.writeFullOutput ?? writeFullOutput)(
        stripSgrCodes(boundDiffOutputForSave(rendered.output)),
      );
    } catch (error) {
      notices.push(`Could not save the full diff: ${diagnostic(String(error))}`);
    }
  }
  options.signal?.throwIfAborted();
  const warning = notices.filter((value) => value !== undefined && value !== "").join("\n");
  return {
    display: rendered.display,
    noChanges: rendered.output.trim() === "",
    output: bounded.ansi,
    scope,
    width,
    ...(bounded.truncation ? { truncation: bounded.truncation } : {}),
    ...(fullOutputPath ? { fullOutputPath } : {}),
    ...(warning ? { warning } : {}),
  };
}

function boundDiffOutputForSave(output: string): string {
  // Full artifacts contain source text, not terminal escape sequences.
  return stripVTControlCharacters(output).replace(/\r\n?/gu, "\n");
}

export async function runGitDiff(
  executeGit: GitDiffExecutor,
  request: GitDiffRequest,
  cwd: string,
  options: RunOptions,
): Promise<DiffResult> {
  options.signal?.throwIfAborted();
  const invocation = buildGitInvocation(request, options.columns);
  let gitResult: ExecResult;
  try {
    gitResult = await executeGit("env", ["-u", "GIT_EXTERNAL_DIFF", "git", ...invocation.args], {
      cwd,
      timeout: COMMAND_TIMEOUT_MS,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    options.signal?.throwIfAborted();
    throw new Error(`Could not run Git diff: ${diagnostic(String(error))}`);
  }
  options.signal?.throwIfAborted();
  if (gitResult.killed)
    throw new Error(`Git diff timed out after ${COMMAND_TIMEOUT_MS / 1000} seconds`);
  if (gitResult.code !== 0) {
    throw new Error(
      `Could not read Git diff:\n${diagnostic(gitResult.stderr || gitResult.stdout)}`,
    );
  }
  const warning = gitResult.stderr.trim() ? diagnostic(gitResult.stderr) : undefined;
  if (!gitResult.stdout.trim()) {
    return {
      content: `No ${invocation.scope}.${warning ? `\n\n${warning}` : ""}`,
      details: {
        display: invocation.display,
        noChanges: true,
        output: "",
        scope: invocation.scope,
        width: invocation.width,
        ...(warning ? { warning } : {}),
      },
    };
  }
  let patches: StructuredPatch[] = [];
  let parseWarning: string | undefined;
  try {
    patches = parsePatch(gitResult.stdout);
  } catch {
    parseWarning = "Unrecognized diff format; showing plain text.";
  }
  const textual = patches.filter((patch) => patch.hunks.length > 0);
  let rendered =
    textual.length === 0
      ? { output: boundDiffOutputForSave(gitResult.stdout), display: "inline" as const }
      : await options.engine.render(textual, {
          width: invocation.width,
          display: invocation.display,
          auto: request.display === undefined || request.display === "auto",
          ...(options.signal ? { signal: options.signal } : {}),
        });
  // jsdiff discards binary/mode/rename-only headers; keep them alongside textual patches.
  if (textual.length) {
    const metadata = gitResult.stdout
      .split(/(?=^diff --git )/mu)
      .filter((section) => section.startsWith("diff --git ") && !/^@@ /mu.test(section))
      .join("\n");
    if (metadata)
      rendered = { ...rendered, output: `${rendered.output}\n${boundDiffOutputForSave(metadata)}` };
  }
  const details = await boundedDetails(rendered, invocation.scope, invocation.width, options, [
    warning,
    parseWarning,
  ]);
  const sections = [stripSgrCodes(details.output)];
  if (details.truncation)
    sections.push(truncationNotice(details.truncation, details.fullOutputPath));
  if (details.warning) sections.push(`Warning: ${details.warning}`);
  return { content: sections.join("\n\n"), details };
}

export async function runEditDiff(
  request: EditDiffRequest,
  _cwd: string,
  options: RunOptions,
): Promise<DiffDetails> {
  options.signal?.throwIfAborted();
  const width = effectiveWidth(options.columns);
  const display = width >= SIDE_BY_SIDE_MIN_WIDTH ? "side-by-side" : "inline";
  // jsdiff's callback mode yields between matching steps; the timeout bounds costly replacements.
  const patch = await new Promise<StructuredPatch | undefined>((resolve) => {
    structuredPatch(
      request.path,
      request.path,
      request.oldContent,
      request.newContent,
      undefined,
      undefined,
      {
        context: request.context ?? DEFAULT_CONTEXT_LINES,
        timeout: EDIT_DIFF_TIMEOUT_MS,
        callback: resolve,
      },
    );
  });
  options.signal?.throwIfAborted();
  if (!patch) throw new Error("Edit diff computation exceeded its time budget");
  if (!patch.hunks.length)
    return { display, noChanges: true, output: "", scope: "edit changes", width };
  const rendered = await options.engine.render([patch], {
    width,
    display,
    auto: true,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return boundedDetails(rendered, "edit changes", width, options);
}
