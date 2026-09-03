#!/usr/bin/env bun

import { basename } from "node:path";
import process from "node:process";
import pc from "picocolors";
import { match } from "ts-pattern";
import { getPiCommitModelOptions } from "./pi-model";
import { type GenerateError, generateCommit } from "./src/generate";
import {
  commit,
  type GitError,
  getBranchName,
  getRemoteOriginUrl,
  getRepoRoot,
  getStagedDiff,
  getStagedFiles,
  getStagedSnapshot,
  hasOnlyLockfiles,
  isInGitRepo,
} from "./src/git";
import {
  choose,
  copyCommitCommandToClipboard,
  input,
  style,
  styleBlock,
  withSpinner,
} from "./src/ui";

type Args = {
  dryRun: boolean;
  verbose: boolean;
  modelRef: string | undefined;
  debug: boolean;
  restartServer: boolean;
};

export function parseArgs(argv: string[]): Args {
  let modelRef: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if ((value === "--model" || value === "-m") && typeof argv[index + 1] === "string") {
      modelRef = argv[index + 1]?.trim();
      index += 1;
    }
  }

  return {
    dryRun: argv.includes("--dry") || argv.includes("-d"),
    verbose: argv.includes("--verbose") || argv.includes("-v"),
    modelRef: modelRef && modelRef.length > 0 ? modelRef : undefined,
    debug: argv.includes("--debug"),
    restartServer:
      argv.includes("--restart-server") ||
      argv.includes("--restart") ||
      argv[0] === "restart-server" ||
      argv[0] === "restart",
  };
}

export async function resolveFinalCommitMessage(
  commitMsg: string,
  shouldEditCommitMessage: boolean,
  edit: typeof input = input,
): Promise<string | null> {
  if (shouldEditCommitMessage === false) return commitMsg;

  const edited = await edit(commitMsg, pc.dim("Edit commit message or press Enter to accept:"));
  return edited === null ? null : edited.trim();
}

function exitCancelled(message: string): never {
  style(` ${message}`, 1);
  process.exit(2);
}

function getModelRef(cliValue?: string): string | null {
  if (typeof cliValue === "string" && cliValue.trim().length > 0) {
    return cliValue.trim();
  }

  const value = process.env.AI_COMMIT_MODEL;
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

async function resolveDisplayModelRef(
  repoRoot: string,
  requestedModelRef: string | null,
): Promise<string | null> {
  try {
    return (
      (await getPiCommitModelOptions(repoRoot, requestedModelRef)).selectedModelRef ??
      requestedModelRef
    );
  } catch {
    // Keep model lookup informational; generation owns the user-facing error.
    return requestedModelRef;
  }
}

function modelLabel(modelRef: string | null): string {
  return pc.cyan(modelRef ?? "unavailable");
}

function normalizeAvailableModelRef(modelRef: string, availableModelRefs: string[]): string {
  if (availableModelRefs.includes(modelRef)) return modelRef;
  const matches = availableModelRefs.filter((available) => available.endsWith(`/${modelRef}`));
  return matches.length === 1 ? (matches[0] ?? modelRef) : modelRef;
}

async function getFallbackModels(
  repoRoot: string,
  currentModelRef: string | null,
): Promise<string[]> {
  const piOptions = await getPiCommitModelOptions(repoRoot, currentModelRef);
  const raw = process.env.AI_COMMIT_FALLBACK_MODELS;
  let models = piOptions.availableModelRefs;

  if (typeof raw === "string" && raw.length > 0) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !Array.isArray((parsed as { models?: unknown }).models)
      ) {
        return [];
      }

      models = (parsed as { models: unknown[] }).models.filter(
        (model): model is string => typeof model === "string" && model.length > 0,
      );
    } catch {
      return [];
    }
  }

  return [
    ...new Set(
      models.map((model) => normalizeAvailableModelRef(model, piOptions.availableModelRefs)),
    ),
  ].filter((model) => model !== piOptions.selectedModelRef);
}

function formatGitError(error: GitError): string {
  const detail = error.stderr.length > 0 ? error.stderr : "git command failed";
  return `${error.command}: ${detail}`;
}

function exitStagedIndexChanged(): never {
  style(" Staged changes changed while preparing the commit message", 1);
  style(" Review the index and run ai_commit again", 3);
  process.exit(1);
}

function requireUnchangedStagedSnapshot(expectedSnapshot: string): void {
  const currentSnapshotResult = getStagedSnapshot();
  if (currentSnapshotResult.isErr()) {
    style(" Failed to verify staged snapshot", 1);
    style(` ${formatGitError(currentSnapshotResult.error)}`, 1);
    process.exit(1);
  }
  if (currentSnapshotResult.value !== expectedSnapshot) exitStagedIndexChanged();
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

function shouldSuggestAnotherModel(error: GenerateError): boolean {
  if (error.kind !== "sdk") {
    return false;
  }

  const message = error.message.toLowerCase();
  return [
    "model is not supported",
    "not supported when using codex with a chatgpt account",
    "unsupported model",
    "model not found",
  ].some((value) => message.includes(value));
}

async function selectFallbackModel(
  repoRoot: string,
  currentModelRef: string | null,
): Promise<string | null> {
  let options: string[];
  try {
    options = await getFallbackModels(repoRoot, currentModelRef);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    style(` Failed to load alternate Pi models: ${message}`, 3);
    return null;
  }
  if (options.length === 0) {
    style(" No alternate Pi models are configured", 3);
    return null;
  }

  const selected = await choose("Select a model", options);
  if (selected === null) {
    return null;
  }

  return options.includes(selected) ? selected : null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.restartServer) {
    style(" Pi commit backend does not use a persistent server", 3);
    return;
  }

  if (!isInGitRepo()) {
    style(" Not in a git repository", 1);
    process.exit(1);
  }

  const stagedSnapshotResult = getStagedSnapshot();
  if (stagedSnapshotResult.isErr()) {
    style(" Failed to read staged snapshot", 1);
    style(` ${formatGitError(stagedSnapshotResult.error)}`, 1);
    process.exit(1);
  }
  const stagedSnapshot = stagedSnapshotResult.value;

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

  const repoRootResult = getRepoRoot();
  if (repoRootResult.isErr()) {
    style(" Failed to read repository root", 1);
    style(` ${formatGitError(repoRootResult.error)}`, 1);
    process.exit(1);
  }
  const repoRoot = repoRootResult.value;
  const repoName = basename(repoRoot);

  const remoteOriginResult = getRemoteOriginUrl();
  if (args.verbose && remoteOriginResult.isErr()) {
    style(` Could not read remote.origin.url: ${formatGitError(remoteOriginResult.error)}`, 3);
  }
  const remoteOrigin = remoteOriginResult.unwrapOr("");

  let modelRef = getModelRef(args.modelRef);
  let displayModelRef = modelRef;
  if (hasOnlyLockfiles(stagedFiles) === false) {
    displayModelRef = await resolveDisplayModelRef(repoRoot, modelRef);
  }

  if (args.verbose) {
    style(` Repo: ${repoName} (${repoRoot})`);
    if (remoteOrigin.length > 0) {
      style(` Remote: ${remoteOrigin}`);
    }
    style(` Branch: ${branch}`);
    style(` Model: ${modelLabel(displayModelRef)}`);
  }

  let commitMsg = "";
  let shouldEditCommitMessage = true;

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
    requireUnchangedStagedSnapshot(stagedSnapshot);
    if (stagedDiff.length === 0) {
      style(" Empty staged diff after lockfile filters", 3);
      process.exit(1);
    }

    const context = {
      repoRoot,
      repoName,
      remoteOrigin,
      branch,
      stagedFiles,
      stagedDiff,
    };

    while (true) {
      const generatedAttempt = await withSpinner(
        `Analyzing staged diff with ${modelLabel(displayModelRef)}...`,
        () =>
          generateCommit(context, modelRef, { debug: args.debug }).match(
            (value) => ({ ok: true as const, value }),
            (error) => ({ ok: false as const, error }),
          ),
      );

      if (generatedAttempt.ok === false) {
        if (generatedAttempt.error.kind === "timeout") {
          style(" Timed out generating commit message", 1);

          const action = await choose("Timed out", ["Retry", "Retry with another model", "Cancel"]);

          if (action === null || action === "Cancel") {
            exitCancelled("Commit cancelled");
          }

          if (action === "Retry with another model") {
            const selectedModel = await selectFallbackModel(repoRoot, modelRef);
            if (selectedModel === null) {
              exitCancelled("Commit cancelled");
            }

            modelRef = selectedModel;
            displayModelRef = selectedModel;
          }

          continue;
        }

        if (shouldSuggestAnotherModel(generatedAttempt.error)) {
          style(` Model failed: ${generatedAttempt.error.message}`, 3);

          const action = await choose("Try another model?", ["Retry with another model", "Cancel"]);

          if (action === null || action === "Cancel") {
            exitCancelled("Commit cancelled");
          }

          const selectedModel = await selectFallbackModel(repoRoot, modelRef);
          if (selectedModel === null) {
            exitCancelled("Commit cancelled");
          }

          modelRef = selectedModel;
          displayModelRef = selectedModel;

          if (args.verbose) {
            style(` Model: ${modelLabel(modelRef)}`);
          }

          continue;
        }

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
        "Proceed",
        "Retry",
        "Cancel",
      ]);
      if (action === null || action === "Cancel") {
        exitCancelled("Commit cancelled");
      }

      if (action === "Edit current message") {
        break;
      }

      if (action === "Proceed") {
        shouldEditCommitMessage = false;
        break;
      }
    }
  }

  const finalMessage = await resolveFinalCommitMessage(commitMsg, shouldEditCommitMessage);
  if (finalMessage === null) {
    exitCancelled("Commit cancelled");
  }

  if (finalMessage.length === 0) {
    exitCancelled("Commit cancelled (empty message)");
  }

  if (args.dryRun) {
    copyCommitCommandToClipboard(finalMessage);
    style(" Dry run - would execute:", 6);
    style(`  git commit -m "${finalMessage}"`, 2);
    style(" Staged files:", 6);
    for (const file of stagedFiles) {
      style(`  ${file}`);
    }
    return;
  }

  requireUnchangedStagedSnapshot(stagedSnapshot);

  copyCommitCommandToClipboard(finalMessage);
  const commitResult = commit(finalMessage, stagedSnapshot);
  if (commitResult.isErr()) {
    if (commitResult.error.kind === "staged-index-changed") exitStagedIndexChanged();
    if (commitResult.error.kind === "index-sync-failed") {
      styleBlock(commitResult.error.commitOutput);
      style(" Commit created, but failed to synchronize the Git index", 1);
      styleBlock(commitResult.error.message);
      process.exit(1);
    }
    style(" Commit failed", 1);
    styleBlock(commitResult.error.stderr);
    process.exit(1);
  }

  styleBlock(commitResult.value);
  style(" Commit successful!", 2);
}

if (import.meta.main) {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      style(` Failed with unexpected error: ${message}`, 1);
      process.exit(1);
    });
}
