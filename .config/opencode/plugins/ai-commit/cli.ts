#!/usr/bin/env bun

import process from "node:process";

import {
  commit,
  getBranchName,
  getPreviousCommitSubject,
  getStagedDiff,
  getStagedFiles,
  hasOnlyLockfiles,
  isInGitRepo,
} from "./src/git";
import { generateCommit } from "./src/generate";
import {
  choose,
  copyCommitCommandToClipboard,
  input,
  style,
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!isInGitRepo()) {
    style(" Not in a git repository", 1);
    process.exit(1);
  }

  const stagedFiles = getStagedFiles();
  if (stagedFiles.length === 0) {
    style(" No staged changes to commit", 1);
    process.exit(1);
  }

  const branch = getBranchName();
  const previousCommit = getPreviousCommitSubject();
  const modelRef = getModelRef(args.modelRef);

  if (args.verbose) {
    style(` Branch: ${branch}`);
    style(` Model: ${modelRef}`);
  }

  let commitMsg = "";

  if (hasOnlyLockfiles(stagedFiles)) {
    commitMsg = "chore(deps): update lock file";
  } else {
    const stagedDiff = getStagedDiff();
    if (stagedDiff.length === 0) {
      style(" Empty staged diff after lockfile filters", 3);
      process.exit(1);
    }

    const context = {
      branch,
      previousCommit,
      stagedDiff,
    };

    while (true) {
      const generated = await withSpinner("Analyzing staged diff...", () =>
        generateCommit(context, modelRef, { debug: args.debug }),
      );

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
    "Edit commit message or press Enter to accept:",
  );
  if (edited === null) {
    exitCancelled("Commit cancelled");
  }

  const finalMessage = edited.trim();
  if (finalMessage.length === 0) {
    exitCancelled("Commit cancelled (empty message)");
  }

  style(finalMessage, 208);
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

  const result = commit(finalMessage);
  if (result.status !== 0) {
    style(" Commit failed", 1);
    if (result.stderr.length > 0) {
      style(result.stderr, 1);
    }
    process.exit(1);
  }

  style(" Commit successful!", 2);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  style(` Failed to generate commit message: ${message}`, 1);
  process.exit(1);
});
