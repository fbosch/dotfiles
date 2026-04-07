#!/usr/bin/env bun

import { spawn, spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import process from "node:process";
import pc from "picocolors";
import { match } from "ts-pattern";

import {
  commit,
  getBranchName,
  type GitError,
  getPreviousCommitInfo,
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
  withSpinner,
} from "./src/ui";

const FALLBACK_MODELS: ReadonlyArray<{ label: string; ref: string }> = [
  { label: "claude-haiku-4-5  (anthropic)", ref: "anthropic/claude-haiku-4-5" },
  { label: "gpt-5.3-codex-spark  (openai)", ref: "openai/gpt-5.3-codex-spark" },
  {
    label: "grok-code-fast-1  (github-copilot)",
    ref: "github-copilot/grok-code-fast-1",
  },
];
const OPENCODE_SERVER_HOST = "127.0.0.1";
const OPENCODE_SERVER_PORT = 4096;
const SERVER_RETRY_TIMEOUT_MS = 5000;
const SERVER_RETRY_INTERVAL_MS = 200;
const SERVER_STOP_TIMEOUT_MS = 3000;

type Args = {
  dryRun: boolean;
  verbose: boolean;
  modelRef?: string;
  debug: boolean;
  restartServer: boolean;
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
    restartServer:
      argv.includes("--restart-server") ||
      argv.includes("--restart") ||
      argv[0] === "restart-server" ||
      argv[0] === "restart",
  };
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

function formatGitError(error: GitError): string {
  const detail = error.stderr.length > 0 ? error.stderr : "git command failed";
  return `${error.command}: ${detail}`;
}

function formatGenerateError(error: GenerateError): string {
  return match(error)
    .with(
      { kind: "connection" },
      ({ message }) => `Connection error: ${message}`,
    )
    .with({ kind: "timeout" }, ({ message }) => `Timeout: ${message}`)
    .with({ kind: "session" }, ({ message }) => `Session error: ${message}`)
    .with({ kind: "sdk" }, ({ message }) => `SDK error: ${message}`)
    .with({ kind: "parse" }, ({ message }) => `Parse error: ${message}`)
    .exhaustive();
}

function reportGenerateError(error: GenerateError): never {
  style(` Failed to generate commit message: ${formatGenerateError(error)}`, 1);
  if (
    error.kind === "parse" &&
    typeof error.debug === "string" &&
    error.debug.length > 0
  ) {
    style(` Debug: ${error.debug}`, 3);
  }
  process.exit(1);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function shouldStartServer(error: GenerateError): boolean {
  if (error.kind !== "connection" && error.kind !== "session") {
    return false;
  }

  const message = error.message.toLowerCase();
  return ["unable to connect", "econnrefused", "fetch failed", "connect"].some(
    (value) => message.includes(value),
  );
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
  ].some((value) => message.includes(value));
}

async function selectFallbackModel(currentModelRef: string | null): Promise<string | null> {
  const options = FALLBACK_MODELS.filter((model) => model.ref !== currentModelRef);
  if (options.length === 0) {
    return null;
  }

  const selected = await choose("Select a model", options.map((model) => model.label));
  if (selected === null) {
    return null;
  }

  const found = options.find((model) => model.label === selected);
  return found?.ref ?? null;
}

function isServerReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({
      host: OPENCODE_SERVER_HOST,
      port: OPENCODE_SERVER_PORT,
    });

    const finish = (reachable: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(reachable);
    };

    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function waitForServer(): Promise<boolean> {
  const deadline = Date.now() + SERVER_RETRY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await isServerReachable()) {
      return true;
    }

    await sleep(SERVER_RETRY_INTERVAL_MS);
  }

  return false;
}

async function waitForServerToStop(): Promise<boolean> {
  const deadline = Date.now() + SERVER_STOP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if ((await isServerReachable()) === false) {
      return true;
    }

    await sleep(SERVER_RETRY_INTERVAL_MS);
  }

  return false;
}

async function startServer(forceStart = false): Promise<void> {
  if (forceStart === false && (await isServerReachable())) {
    return;
  }

  const child = spawn(
    "opencode",
    [
      "serve",
      "--hostname",
      OPENCODE_SERVER_HOST,
      "--port",
      String(OPENCODE_SERVER_PORT),
    ],
    {
      detached: true,
      stdio: "ignore",
    },
  );

  child.unref();

  const ready = await Promise.race([
    waitForServer(),
    new Promise<boolean>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) {
          resolve(false);
          return;
        }

        reject(
          new Error(`opencode serve exited with code ${code ?? "unknown"}`),
        );
      });
    }),
  ]);

  if (ready) {
    return;
  }

  throw new Error(
    `Timed out waiting for opencode server on http://${OPENCODE_SERVER_HOST}:${String(OPENCODE_SERVER_PORT)}`,
  );
}

async function restartServer(): Promise<void> {
  const killResult = spawnSync(
    "pkill",
    [
      "-f",
      `opencode serve --hostname ${OPENCODE_SERVER_HOST} --port ${String(OPENCODE_SERVER_PORT)}`,
    ],
    {
      stdio: "ignore",
    },
  );

  if (killResult.error) {
    throw new Error(
      `Failed to restart opencode server: ${killResult.error.message}`,
    );
  }

  await waitForServerToStop();
  await startServer(true);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.restartServer) {
    try {
      await withSpinner("Restarting commit server...", () => restartServer());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      style(` Failed to restart commit server: ${message}`, 1);
      process.exit(1);
    }

    style(
      ` Commit server ready at http://${OPENCODE_SERVER_HOST}:${String(OPENCODE_SERVER_PORT)}`,
      2,
    );
    return;
  }

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

  const previousCommitResult = getPreviousCommitInfo();
  if (args.verbose && previousCommitResult.isErr()) {
    style(
      ` Could not read previous commit subject: ${formatGitError(previousCommitResult.error)}`,
      3,
    );
  }
  const previousCommit = previousCommitResult
    .map((value) => (value.isMerge ? "" : value.subject))
    .unwrapOr("");

  if (args.verbose && previousCommitResult.isOk() && previousCommitResult.value.isMerge) {
    style(" Previous commit is a merge commit; skipping subject context", 3);
  }

  let modelRef = getModelRef(args.modelRef);

  if (args.verbose) {
    style(` Branch: ${branch}`);
    style(` Model: ${modelRef ?? "commit agent default"}`);
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
    let hasStartedServer = false;

    if ((await isServerReachable()) === false) {
      try {
        await startServer();
        hasStartedServer = true;
      } catch {
        // Let the normal generate path surface the real error if startup fails.
      }
    }

    while (true) {
      const generatedAttempt = await withSpinner(
        `Analyzing staged diff with ${modelRef ?? "commit agent"}...`,
        () =>
          generateCommit(context, modelRef, { debug: args.debug }).match(
            (value) => ({ ok: true as const, value }),
            (error) => ({ ok: false as const, error }),
          ),
      );

      if (generatedAttempt.ok === false) {
        if (generatedAttempt.error.kind === "timeout") {
          style(" Timed out generating commit message", 1);

          const action = await choose("Timed out", [
            "Retry",
            "Retry with another model",
            "Cancel",
          ]);

          if (action === null || action === "Cancel") {
            exitCancelled("Commit cancelled");
          }

          if (action === "Retry with another model") {
            const selectedModel = await selectFallbackModel(modelRef);
            if (selectedModel === null) {
              exitCancelled("Commit cancelled");
            }

            modelRef = selectedModel;
          }

          try {
            await restartServer();
            hasStartedServer = true;
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            reportGenerateError({ kind: "connection", message });
          }

          continue;
        }

        if (shouldSuggestAnotherModel(generatedAttempt.error)) {
          style(` Model failed: ${generatedAttempt.error.message}`, 3);

          const action = await choose("Try another model?", [
            "Retry with another model",
            "Cancel",
          ]);

          if (action === null || action === "Cancel") {
            exitCancelled("Commit cancelled");
          }

          const selectedModel = await selectFallbackModel(modelRef);
          if (selectedModel === null) {
            exitCancelled("Commit cancelled");
          }

          modelRef = selectedModel;

          if (args.verbose) {
            style(` Model: ${modelRef}`);
          }

          continue;
        }

        if (
          hasStartedServer === false &&
          shouldStartServer(generatedAttempt.error)
        ) {
          try {
            await startServer();
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            reportGenerateError({ kind: "connection", message });
          }

          hasStartedServer = true;
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

  style(" Commit successful!", 2);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  style(` Failed with unexpected error: ${message}`, 1);
  process.exit(1);
});
