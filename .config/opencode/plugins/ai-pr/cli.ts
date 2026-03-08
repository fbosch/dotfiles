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
  modelRef?: string;
};

type CommandResult = {
  status: number;
  stdout: string;
  stderr: string;
};

type JsonTextEvent = {
  type?: string;
  part?: {
    text?: string;
  };
};

function parseArgs(argv: string[]): CliArgs {
  let modelRef: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
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

  return { modelRef };
}

function runCommand(
  command: string,
  args: string[],
  options?: {
    stdin?: string;
    env?: NodeJS.ProcessEnv;
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

  fail("Could not find main or master branch");
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

function runWithSpinner(title: string, command: string, args: string[], env: NodeJS.ProcessEnv): number {
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
  const modelRef = args.modelRef ?? DEFAULT_MODEL;

  if (isInGitRepo() === false) {
    fail("Not in a git repository");
  }

  const branchResult = runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branchResult.status !== 0) {
    fail("Failed to read current branch");
  }
  const branchName = branchResult.stdout.trim();

  const mainBranch = getMainBranch();
  if (branchName === mainBranch) {
    fail(`Current branch is ${mainBranch}, cannot compare against itself`);
  }

  const diffStatResult = runCommand("git", ["diff", `${mainBranch}..HEAD`, "--stat"]);
  if (diffStatResult.status !== 0) {
    fail("Failed to read branch diff");
  }
  if (diffStatResult.stdout.trim().length === 0) {
    fail(`No differences found between ${branchName} and ${mainBranch}`);
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

  const fullDiff = runCommand("git", ["diff", `${mainBranch}..HEAD`]);
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

  const opencodeStatus = runWithSpinner(
    `Analyzing changes with ${modelRef}...`,
    "fish",
    [
      "-c",
      "opencode_transient_run run --command pr-desc -m $argv[1] --format json (command cat $OPENCODE_PR_DIFF_FILE | string collect) > $argv[2] 2>&1",
      "--",
      modelRef,
      tempOutput,
    ],
    {
      ...process.env,
      OPENCODE_PR_DIFF_FILE: actualDiffFile,
    },
  );

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

  const output = readFileSync(tempOutput, "utf8");
  if (output.trim().length === 0) {
    style(" OpenCode produced no output", 1);
    cleanup();
    process.exit(1);
  }

  const parsed = readOutputEvents(output);
  writeFileSync(tempPrDesc, parsed);

  if (parsed.length === 0) {
    style(" No valid PR description generated. Raw output:", 1);
    console.log(output.split(/\r?\n/).slice(0, 50).join("\n"));
    cleanup();
    process.exit(1);
  }

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
    cleanup();
    return;
  }

  const clipboardResult = runCommand(clipboard.command, clipboard.args, {
    stdin: finalContent.replace(ANSI_ESCAPE_REGEX, ""),
  });

  if (clipboardResult.status === 0) {
    style(" PR description copied to clipboard!", 2);
  } else {
    style(" Failed to copy to clipboard", 1);
  }

  cleanup();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  fail(`Failed with unexpected error: ${message}`);
});
