#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const DEFAULT_MODEL = "opencode/big-pickle";
const MAX_DIFF_LINES = 2000;
const TRUNCATED_DIFF_LINES = 500;
const ANSI_ESCAPE_REGEX = new RegExp("\\u001b\\[[0-9;]*m", "g");

type CliArgs = {
  debug?: boolean;
  modelRef?: string;
};

type CommandResult = {
  status: number;
  stdout: string;
  stderr: string;
};

type CommandEnv = Record<string, string | undefined>;

type JsonTextEvent = {
  type?: string;
  part?: {
    text?: string;
  };
};

function parseArgs(argv: string[]): CliArgs {
  let debug = false;
  let modelRef: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--debug") {
      debug = true;
      continue;
    }

    if (value === "-m" || value === "--model") {
      const next = argv[index + 1];
      if (typeof next !== "string" || next.trim().length === 0) {
        fail("Missing value for --model");
      }
      modelRef = next.trim();
      index += 1;
      continue;
    }

    if (value.startsWith("--model=")) {
      const provided = value.slice("--model=".length).trim();
      if (provided.length === 0) {
        fail("Missing value for --model");
      }
      modelRef = provided;
      continue;
    }

    fail(`Unknown argument: ${value}`);
  }

  return { debug, modelRef };
}

function runCommand(
  command: string,
  args: string[],
  options?: {
    stdin?: string;
    env?: CommandEnv;
    inheritIO?: boolean;
  },
): CommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    input: options?.stdin,
    env: options?.env,
    stdio: options?.inheritIO === true ? "inherit" : "pipe",
  });

  if (result.error !== undefined) {
    fail(`${command}: ${result.error.message}`);
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function startDebugTimer(debug: boolean): number | null {
  return debug ? performance.now() : null;
}

function writeDebugTiming(debug: boolean, label: string, startTime: number | null): void {
  if (debug === false || startTime === null) {
    return;
  }

  const elapsedMs = performance.now() - startTime;
  console.error(`[ai-pr] ${label}: ${elapsedMs.toFixed(1)}ms`);
}

function commandExists(command: string): boolean {
  const result = runCommand("sh", ["-c", `command -v ${command} >/dev/null 2>&1`]);
  return result.status === 0;
}

function style(message: string, color?: 1 | 2 | 3): void {
  if (commandExists("gum") === false) {
    console.log(message);
    return;
  }

  const args = ["style"];
  if (typeof color === "number") {
    args.push("--foreground", String(color));
  }
  args.push(message);

  runCommand("gum", args, { inheritIO: true });
}

function fail(message: string): never {
  style(` ${message}`, 1);
  process.exit(1);
  throw new Error(message);
}

function isInGitRepo(): boolean {
  return runCommand("git", ["rev-parse", "--git-dir"]).status === 0;
}

function getMainBranch(): string {
  if (runCommand("git", ["show-ref", "--verify", "--quiet", "refs/heads/main"]).status === 0) {
    return "main";
  }

  if (runCommand("git", ["show-ref", "--verify", "--quiet", "refs/heads/master"]).status === 0) {
    return "master";
  }

  return fail("Could not find main or master branch");
}

function getUpstreamBranch(): string | null {
  const result = runCommand("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  if (result.status !== 0) {
    return null;
  }

  const upstream = result.stdout.trim();
  return upstream.length > 0 ? upstream : null;
}

function readOutputEvents(output: string): string {
  const withoutAnsi = output.replace(ANSI_ESCAPE_REGEX, "");
  const lines = withoutAnsi.split(/\r?\n/);
  const textParts: string[] = [];

  for (const line of lines) {
    if (line.startsWith("{") === false) {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as JsonTextEvent;
      if (parsed.type === "text" && typeof parsed.part?.text === "string") {
        textParts.push(parsed.part.text);
      }
    } catch {
      continue;
    }
  }

  return textParts.join("\n").trim();
}

function runWithSpinner(title: string, command: string, args: string[], env: CommandEnv): number {
  if (commandExists("gum") === false) {
    const fallback = runCommand(command, args, { env, inheritIO: true });
    return fallback.status;
  }

  const result = runCommand(
    "gum",
    ["spin", "--spinner", "pulse", "--title", title, "--", command, ...args],
    { env, inheritIO: true },
  );
  return result.status;
}

function getClipboardCommand():
  | { command: string; args: string[] }
  | null {
  if (process.platform === "darwin") {
    if (commandExists("pbcopy")) {
      return { command: "pbcopy", args: [] };
    }
    return null;
  }

  if (process.platform === "linux") {
    if (commandExists("wl-copy")) {
      return { command: "wl-copy", args: [] };
    }

    if (commandExists("xclip")) {
      return { command: "xclip", args: ["-selection", "clipboard"] };
    }
  }

  return null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const debug = args.debug === true;
  const modelRef = args.modelRef ?? DEFAULT_MODEL;
  const totalStart = startDebugTimer(debug);

  const repoCheckStart = startDebugTimer(debug);
  const inGitRepo = isInGitRepo();
  writeDebugTiming(debug, "isInGitRepo", repoCheckStart);
  if (inGitRepo === false) {
    fail("Not in a git repository");
  }

  const branchStart = startDebugTimer(debug);
  const branchResult = runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  writeDebugTiming(debug, "getCurrentBranch", branchStart);
  if (branchResult.status !== 0) {
    fail("Failed to read current branch");
  }
  const branchName = branchResult.stdout.trim();

  const mainBranchStart = startDebugTimer(debug);
  const mainBranch = getMainBranch();
  writeDebugTiming(debug, "getMainBranch", mainBranchStart);
  let comparisonRef = mainBranch;
  let comparisonLabel = mainBranch;

  if (branchName === mainBranch) {
    const upstreamStart = startDebugTimer(debug);
    const upstreamBranch = getUpstreamBranch();
    writeDebugTiming(debug, "getUpstreamBranch", upstreamStart);

    if (upstreamBranch === null) {
      fail(`Current branch is ${mainBranch} and has no upstream branch to compare against`);
    }

    comparisonRef = upstreamBranch;
    comparisonLabel = `upstream ${upstreamBranch}`;
  }

  const diffStatStart = startDebugTimer(debug);
  const diffStatResult = runCommand("git", ["diff", `${comparisonRef}..HEAD`, "--stat"]);
  writeDebugTiming(debug, "gitDiffStat", diffStatStart);
  if (diffStatResult.status !== 0) {
    fail("Failed to read branch diff");
  }
  if (diffStatResult.stdout.trim().length === 0) {
    fail(`No differences found between ${branchName} and ${comparisonLabel}`);
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "ai-pr."));
  const tempDiff = join(tempRoot, "pr_diff.patch");
  const tempDiffSummary = join(tempRoot, "pr_diff_summary.patch");
  const tempOutput = join(tempRoot, "opencode_output.log");
  const tempPrDesc = join(tempRoot, "pr_description.md");

  const cleanup = (): void => {
    rmSync(tempRoot, { recursive: true, force: true });
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });

  process.on("SIGTERM", () => {
    cleanup();
    process.exit(130);
  });

  const fullDiffStart = startDebugTimer(debug);
  const fullDiff = runCommand("git", ["diff", `${comparisonRef}..HEAD`]);
  writeDebugTiming(debug, "gitDiff", fullDiffStart);
  if (fullDiff.status !== 0) {
    cleanup();
    fail("Failed to generate diff");
  }

  writeFileSync(tempDiff, fullDiff.stdout);
  const diffLineCount = fullDiff.stdout.split(/\r?\n/).length;

  const actualDiffFile = diffLineCount > MAX_DIFF_LINES ? tempDiffSummary : tempDiff;

  if (diffLineCount > MAX_DIFF_LINES) {
    const truncatedLines = fullDiff.stdout.split(/\r?\n/).slice(0, TRUNCATED_DIFF_LINES).join("\n");
    const summary = [
      diffStatResult.stdout.trimEnd(),
      "",
      "(Diff is too large to include in full. Showing file changes only. Focus on the commit messages and file list above for context.)",
      truncatedLines,
      "",
      `... (diff truncated, ${diffLineCount} total lines) ...`,
      "",
    ].join("\n");

    writeFileSync(tempDiffSummary, summary);
  }

  const opencodeStart = startDebugTimer(debug);
  const opencodeStatus = runWithSpinner(
    `Analyzing changes with ${modelRef}...`,
    "fish",
    [
      "-c",
      "opencode run --command pr-desc -m $argv[1] --format json (command cat $argv[2] | string collect) > $argv[3] 2>&1",
      "--",
      modelRef,
      actualDiffFile,
      tempOutput,
    ],
    {
      ...process.env,
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_DISABLE_CLAUDE_CODE_PROMPT: "1",
    },
  );
  writeDebugTiming(debug, "opencode", opencodeStart);

  if (opencodeStatus !== 0) {
    style(` OpenCode command failed (exit ${opencodeStatus})`, 1);
    let output = "";
    try {
      output = readFileSync(tempOutput, "utf8");
    } catch {
      output = "";
    }
    if (output.trim().length > 0) {
      console.log("Output:");
      console.log(output);
    }
    cleanup();
    process.exit(1);
  }

  const outputReadStart = startDebugTimer(debug);
  const output = readFileSync(tempOutput, "utf8");
  writeDebugTiming(debug, "readOutput", outputReadStart);
  if (output.trim().length === 0) {
    style(" OpenCode produced no output", 1);
    cleanup();
    process.exit(1);
  }

  const parseOutputStart = startDebugTimer(debug);
  const parsed = readOutputEvents(output);
  writeDebugTiming(debug, "parseOutput", parseOutputStart);
  writeFileSync(tempPrDesc, parsed);

  if (parsed.length === 0) {
    style(" No valid PR description generated. Raw output:", 1);
    console.log(output.split(/\r?\n/).slice(0, 50).join("\n"));
    cleanup();
    process.exit(1);
  }

  const editorStart = startDebugTimer(debug);
  runCommand(
    "nvim",
    [
      "-f",
      "--cmd",
      "set noswapfile nobackup nowritebackup",
      "-c",
      "set filetype=markdown wrap linebreak spell textwidth=0 wrapmargin=0 nolist conceallevel=0",
      "-c",
      "set formatoptions-=t formatoptions+=l",
      "-c",
      "autocmd VimLeavePre * silent! write",
      "-c",
      "set statusline=%f\\ %=[PR\\ Description\\ -\\ exit\\ to\\ copy\\ to\\ clipboard] | normal! gg",
      tempPrDesc,
    ],
    { inheritIO: true },
  );
  writeDebugTiming(debug, "editor", editorStart);

  try {
    statSync(tempPrDesc);
  } catch {
    style(" PR description cancelled", 1);
    cleanup();
    process.exit(1);
  }

  const finalContent = readFileSync(tempPrDesc, "utf8");
  if (finalContent.trim().length === 0) {
    style(" PR description cancelled (empty content)", 1);
    cleanup();
    process.exit(1);
  }

  const clipboard = getClipboardCommand();
  if (clipboard === null) {
    style(" Clipboard command not found, displaying content:", 3);
    console.log(finalContent);
    writeDebugTiming(debug, "total", totalStart);
    cleanup();
    return;
  }

  const clipboardStart = startDebugTimer(debug);
  const clipboardResult = runCommand(clipboard.command, clipboard.args, {
    stdin: finalContent.replace(ANSI_ESCAPE_REGEX, ""),
  });
  writeDebugTiming(debug, "clipboard", clipboardStart);

  if (clipboardResult.status === 0) {
    style(" PR description copied to clipboard!", 2);
  } else {
    style(" Failed to copy to clipboard", 1);
  }

  writeDebugTiming(debug, "total", totalStart);
  cleanup();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  fail(`Failed with unexpected error: ${message}`);
});
