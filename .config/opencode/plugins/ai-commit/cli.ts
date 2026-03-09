#!/usr/bin/env bun

import process from "node:process";
import pc from "picocolors";
import { match } from "ts-pattern";

import {
  commit,
  getBranchName,
  type GitError,
  getPreviousCommitSubject,
  getStagedDiff,
  getStagedFiles,
  hasOnlyLockfiles,
  isInGitRepo,
} from "./src/git";
import { generateCommit, type GenerateError } from "./src/generate";
import {
  choose,
  copyCommitCommandToClipboard,
  input,
  style,
  styleBlock,
  withSpinner,
} from "./src/ui";

const DEFAULT_MODEL = "opencode/gpt-5-nano";

type Args = {
  dryRun: boolean;
  verbose: boolean;
  modelRef?: string;
  debug: boolean;
};

function parseArgs(argv: string[]): Args {
  let modelRef: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (
      (value === "--model" || value === "-m") &&
      typeof argv[index + 1] === "string"
    ) {
      modelRef = argv[index + 1]?.trim();
      index += 1;
    }
  }

  return {
    dryRun: argv.includes("--dry") || argv.includes("-d"),
    verbose: argv.includes("--verbose") || argv.includes("-v"),
    modelRef: modelRef && modelRef.length > 0 ? modelRef : undefined,
    debug: argv.includes("--debug"),
  };
}

function exitCancelled(message: string): never {
  style(` ${message}`, 1);
  process.exit(2);
}

function getModelRef(cliValue?: string): string {
  if (typeof cliValue === "string" && cliValue.trim().length > 0) {
    return cliValue.trim();
  }

  const value = process.env.AI_COMMIT_MODEL;
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return DEFAULT_MODEL;
}

function formatGitError(error: GitError): string {
  const detail = error.stderr.length > 0 ? error.stderr : "git command failed";
  return `${error.command}: ${detail}`;
}

function formatGenerateError(error: GenerateError): string {
  return match(error)
    .with({ kind: "connection" }, ({ message }) => `Connection error: ${message}`)
    .with({ kind: "timeout" }, ({ message }) => `Timeout: ${message}`)
    .with({ kind: "session" }, ({ message }) => `Session error: ${message}`)
    .with({ kind: "sdk" }, ({ message }) => `SDK error: ${message}`)
    .with({ kind: "parse" }, ({ message }) => `Parse error: ${message}`)
    .exhaustive();
}

function reportGenerateError(error: GenerateError): never {
  style(` Failed to generate commit message: ${formatGenerateError(error)}`, 1);
  if (error.kind === "parse" && typeof error.debug === "string" && error.debug.length > 0) {
    style(` Debug: ${error.debug}`, 3);
  }
  process.exit(1);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!isInGitRepo()) {
    style(" Not in a git repository", 1);
    process.exit(1);
  }

  const stagedFilesResult = getStagedFiles();
  if (stagedFilesResult.isErr()) {
    style(" Failed to read staged files", 1);
    style(` ${formatGitError(stagedFilesResult.error)}`, 1);
    process.exit(1);
  }

  const stagedFiles = stagedFilesResult.value;
  if (stagedFiles.length === 0) {
    style(" No staged changes to commit", 1);
    process.exit(1);
  }

  const branchResult = getBranchName();
  if (args.verbose && branchResult.isErr()) {
    style(` Could not read branch: ${formatGitError(branchResult.error)}`, 3);
  }
  const branch = branchResult.unwrapOr("");

  const previousCommitResult = getPreviousCommitSubject();
  if (args.verbose && previousCommitResult.isErr()) {
    style(` Could not read previous commit subject: ${formatGitError(previousCommitResult.error)}`, 3);
  }
  const previousCommit = previousCommitResult.unwrapOr("");

  const modelRef = getModelRef(args.modelRef);

  if (args.verbose) {
    style(` Branch: ${branch}`);
    style(` Model: ${modelRef}`);
  }

  let commitMsg = "";

  if (hasOnlyLockfiles(stagedFiles)) {
    commitMsg = "chore(deps): update lock file";
  } else {
    const stagedDiffResult = getStagedDiff();
    if (stagedDiffResult.isErr()) {
      style(" Failed to read staged diff", 1);
      style(` ${formatGitError(stagedDiffResult.error)}`, 1);
      process.exit(1);
    }

    const stagedDiff = stagedDiffResult.value;
    if (stagedDiff.length === 0) {
      style(" Empty staged diff after lockfile filters", 3);
      process.exit(1);
    }

    const context = {
      branch,
      previousCommit,
      stagedFiles,
      stagedDiff,
    };

    while (true) {
      const generatedAttempt = await withSpinner("Analyzing staged diff...", () =>
        generateCommit(context, modelRef, { debug: args.debug }).match(
          (value) => ({ ok: true as const, value }),
          (error) => ({ ok: false as const, error }),
        ),
      );

      if (generatedAttempt.ok === false) {
        reportGenerateError(generatedAttempt.error);
      }

      const generated = generatedAttempt.value;

      commitMsg = generated.message;
      if (generated.overLimit === false) {
        break;
      }

      style(` Message is ${commitMsg.length} chars (over 50)`, 3);
      style(`  ${commitMsg}`, 208);

      const action = await choose("Pick an action", [
        "Edit current message",
        "Retry",
        "Cancel",
      ]);
      if (action === null || action === "Cancel") {
        exitCancelled("Commit cancelled");
      }

      if (action === "Edit current message") {
        break;
      }
    }
  }

  const edited = await input(
    commitMsg,
    pc.dim("Edit commit message or press Enter to accept:"),
  );
  if (edited === null) {
    exitCancelled("Commit cancelled");
  }

  const finalMessage = edited.trim();
  if (finalMessage.length === 0) {
    exitCancelled("Commit cancelled (empty message)");
  }

  copyCommitCommandToClipboard(finalMessage);

  if (args.dryRun) {
    style(" Dry run - would execute:", 6);
    style(`  git commit -m \"${finalMessage}\"`, 2);
    style(" Staged files:", 6);
    for (const file of stagedFiles) {
      style(`  ${file}`);
    }
    return;
  }

  const commitResult = commit(finalMessage);
  if (commitResult.isErr()) {
    style(" Commit failed", 1);
    style(` ${formatGitError(commitResult.error)}`, 1);
    process.exit(1);
  }

  styleBlock(commitResult.value);

  style(" Commit successful!", 2);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  style(` Failed with unexpected error: ${message}`, 1);
  process.exit(1);
});
