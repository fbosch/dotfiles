import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  type ExecOptions,
  type ExecResult,
  formatSize,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import {
  boundDiffOutput,
  buildDeltaInvocation,
  buildGitInvocation,
  COMMAND_TIMEOUT_MS,
  type DeltaDetails,
  type DeltaEditRequest,
  type DeltaExecutor,
  type DeltaResult,
  type DiffTruncation,
  diagnostic,
  EDIT_COMMAND_TIMEOUT_MS,
  effectiveWidth,
  type GitDiffExecutor,
  type GitDiffRequest,
  type RunOptions,
  SIDE_BY_SIDE_MIN_WIDTH,
  sanitizeTerminalOutput,
  stripSgrCodes,
} from "./shared";

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
      fullOutputPath = await writer(stripSgrCodes(sanitizeTerminalOutput(deltaResult.stdout)));
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
  while (lines.length > 0 && stripSgrCodes(lines[0] ?? "").trim() === "") lines.shift();
  while (lines.length > 0 && stripSgrCodes(lines.at(-1) ?? "").trim() === "") lines.pop();
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
        fullOutputPath = await writer(stripSgrCodes(sanitizeTerminalOutput(output)));
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
