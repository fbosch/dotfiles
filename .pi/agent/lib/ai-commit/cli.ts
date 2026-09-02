#!/usr/bin/env bun

import { basename } from "node:path";
import {
  commit,
  GitCommandError,
  getBranchName,
  getRepoRoot,
  getStagedDiff,
  getStagedFiles,
  getStagedSnapshot,
  hasOnlyLockfiles,
  isInGitRepo,
} from "./git";
import { type GeneratedCommit, type GenerateError, generateCommitWithPi } from "./index";
import {
  choose,
  copyCommitCommandToClipboard,
  formatCommitCommand,
  InteractiveInputError,
  input,
  PromptInterruptedError,
  status,
  writeResult,
} from "./ui";

interface Args {
  dryRun: boolean;
  verbose: boolean;
  debug: boolean;
  accept: boolean;
  help: boolean;
  legacyRestart: boolean;
  modelRef?: string;
}

class CliInputError extends Error {}

const HELP = `Generate and optionally commit a conventional commit message from staged changes.

Usage:
  ai_commit [options]

Options:
  -d, --dry          Show the commit without creating it
  -m, --model MODEL  Override the configured Pi model
  -y, --yes          Accept the generated message without prompting
  -v, --verbose      Show resolved repository and model details
      --debug        Include bounded model-response details in parse errors
  -h, --help         Show this help

Environment:
  AI_COMMIT_MODEL             Pi model reference used when --model is absent
  AI_COMMIT_FALLBACK_MODELS   JSON object with a models string array
  AI_COMMIT_TIMEOUT_MS        Model timeout in milliseconds, minimum 5000

The active Pi auth profile and default model are used unless overridden.`;

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    dryRun: false,
    verbose: false,
    debug: false,
    accept: false,
    help: false,
    legacyRestart: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    switch (value) {
      case "-d":
      case "--dry":
        args.dryRun = true;
        break;
      case "-v":
      case "--verbose":
        args.verbose = true;
        break;
      case "--debug":
        args.debug = true;
        break;
      case "-y":
      case "--yes":
        args.accept = true;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "restart":
      case "restart-server":
      case "--restart":
      case "--restart-server":
        args.legacyRestart = true;
        break;
      case "-m":
      case "--model": {
        const modelRef = argv[index + 1]?.trim();
        if (modelRef === undefined || modelRef.length === 0) {
          throw new CliInputError(`${value} requires a Pi model reference`);
        }
        args.modelRef = modelRef;
        index += 1;
        break;
      }
      default:
        if (value?.startsWith("--model=") === true) {
          const modelRef = value.slice("--model=".length).trim();
          if (modelRef.length === 0)
            throw new CliInputError("--model requires a Pi model reference");
          args.modelRef = modelRef;
          break;
        }
        throw new CliInputError(`Unknown argument: ${value ?? ""}`);
    }
  }

  return args;
}

function configuredModelRef(args: Args): string | null {
  if (args.modelRef !== undefined) return args.modelRef;
  const value = process.env.AI_COMMIT_MODEL?.trim();
  return value === undefined || value.length === 0 ? null : value;
}

function fallbackModels(): string[] {
  const raw = process.env.AI_COMMIT_FALLBACK_MODELS;
  if (raw === undefined || raw.length === 0) return [];

  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      Array.isArray((value as { models?: unknown }).models) === false
    ) {
      return [];
    }
    return (value as { models: unknown[] }).models.filter(
      (model): model is string => typeof model === "string" && model.trim().length > 0,
    );
  } catch {
    return [];
  }
}

function isGenerateError(error: unknown): error is GenerateError {
  if (typeof error !== "object" || error === null || !("kind" in error) || !("message" in error)) {
    return false;
  }
  return (
    typeof error.message === "string" &&
    ["connection", "timeout", "session", "parse", "sdk"].includes(String(error.kind))
  );
}

function formatGenerateError(error: GenerateError): string {
  switch (error.kind) {
    case "connection":
      return `Connection error: ${error.message}`;
    case "timeout":
      return `Timeout: ${error.message}`;
    case "session":
      return `Session error: ${error.message}`;
    case "parse":
      return `Parse error: ${error.message}`;
    case "sdk":
      return `SDK error: ${error.message}`;
  }
}

function shouldSuggestAnotherModel(error: GenerateError): boolean {
  if (error.kind !== "sdk") return false;
  const message = error.message.toLowerCase();
  return ["model is not supported", "unsupported model", "model not found"].some((value) =>
    message.includes(value),
  );
}

async function selectFallbackModel(currentModelRef: string | null): Promise<string | null> {
  const models = fallbackModels().filter((model) => model !== currentModelRef);
  if (models.length === 0) {
    status("Warning", "No alternate Pi models are configured. Use --model to select one.");
    return null;
  }
  return (await choose("Select a Pi model", models)) ?? null;
}

async function generateMessage(
  repoRoot: string,
  branch: string,
  stagedFiles: readonly string[],
  stagedDiff: string,
  initialModelRef: string | null,
  args: Args,
): Promise<GeneratedCommit | null> {
  let modelRef = initialModelRef;

  while (true) {
    status("Working", `Analyzing staged changes with ${modelRef ?? "the default Pi model"}...`);
    let generated: GeneratedCommit;
    try {
      generated = await generateCommitWithPi(
        repoRoot,
        { branch, stagedFiles, stagedDiff },
        modelRef,
        { debug: args.debug },
      );
    } catch (error) {
      if (isGenerateError(error) === false) throw error;

      if (error.kind === "timeout") {
        status("Error", "Timed out generating the commit message.");
        if (args.accept) throw error;
        const options = ["Retry", "Retry with another model", "Cancel"];
        const action = await choose("Choose the next action", options);
        if (action === "Retry") continue;
        if (action === "Retry with another model") {
          const selected = await selectFallbackModel(modelRef);
          if (selected !== null) {
            modelRef = selected;
            continue;
          }
        }
        return null;
      }

      if (shouldSuggestAnotherModel(error) && args.accept === false) {
        status("Warning", `The selected model failed: ${error.message}`);
        const selected = await selectFallbackModel(modelRef);
        if (selected !== null) {
          modelRef = selected;
          continue;
        }
        return null;
      }

      status("Error", `Failed to generate the commit message. ${formatGenerateError(error)}`);
      if (error.kind === "parse" && args.debug && error.debug !== undefined) {
        status("Info", error.debug);
      }
      throw error;
    }

    if (generated.overLimit === false) return generated;
    status(
      "Warning",
      `Generated message is ${generated.message.length} characters; the limit is 50.`,
    );
    if (args.accept) {
      throw new Error("Generated message exceeds 50 characters; rerun without --yes to edit it");
    }

    const action = await choose("Choose the next action", [
      "Edit current message",
      "Retry",
      "Cancel",
    ]);
    if (action === "Edit current message") return generated;
    if (action !== "Retry") return null;
  }
}

function printDryRun(message: string, stagedFiles: readonly string[]): void {
  writeResult(`Dry run\n  Command  ${formatCommitCommand(message)}\n  Staged files`);
  for (const file of stagedFiles) writeResult(`    - ${file}`);
}

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    status("Error", error instanceof Error ? error.message : String(error));
    process.stderr.write("  Run `ai_commit --help` for usage.\n");
    return 2;
  }

  if (args.help) {
    writeResult(HELP);
    return 0;
  }
  if (args.legacyRestart) {
    status("Info", "The Pi commit backend has no persistent server to restart.");
    return 0;
  }

  const cwd = process.cwd();
  if (isInGitRepo(cwd) === false) {
    status("Error", "The current directory is not in a Git repository.");
    return 1;
  }

  try {
    const repoRoot = getRepoRoot(cwd);
    const stagedFiles = getStagedFiles(repoRoot);
    if (stagedFiles.length === 0) {
      status("Info", "No staged changes found.");
      return 1;
    }

    const stagedSnapshot = getStagedSnapshot(repoRoot);
    const branch = getBranchName(repoRoot);
    const modelRef = configuredModelRef(args);

    if (args.verbose) {
      status("Info", `Repository: ${basename(repoRoot)} (${repoRoot})`);
      status("Info", `Branch: ${branch}`);
      status("Info", `Model: ${modelRef ?? "Pi default"}`);
    }

    let generated: GeneratedCommit;
    if (hasOnlyLockfiles(stagedFiles)) {
      generated = {
        type: "chore",
        scope: "deps",
        subject: "update lock file",
        message: "chore(deps): update lock file",
        overLimit: false,
      };
    } else {
      const stagedDiff = getStagedDiff(repoRoot);
      if (stagedDiff.length === 0) {
        status("Error", "The staged diff is empty after lockfile and whitespace filtering.");
        return 1;
      }
      const result = await generateMessage(
        repoRoot,
        branch,
        stagedFiles,
        stagedDiff,
        modelRef,
        args,
      );
      if (result === null) {
        status("Info", "Commit cancelled.");
        return 2;
      }
      generated = result;
    }

    let finalMessage = generated.message;
    if (args.accept === false) {
      const edited = await input("Edit the commit message", finalMessage);
      if (edited === undefined || edited.trim().length === 0) {
        status("Info", "Commit cancelled.");
        return 2;
      }
      finalMessage = edited.trim();
    }

    if (args.dryRun) {
      copyCommitCommandToClipboard(finalMessage);
      printDryRun(finalMessage, stagedFiles);
      return 0;
    }

    if (getStagedSnapshot(repoRoot) !== stagedSnapshot) {
      status("Error", "The staged changes changed while the commit message was being prepared.");
      process.stderr.write("  Review the index and run `ai_commit` again.\n");
      return 1;
    }

    copyCommitCommandToClipboard(finalMessage);
    const output = commit(repoRoot, finalMessage);
    if (output.length > 0) writeResult(output);
    status("Success", `Created commit ${JSON.stringify(finalMessage)}.`);
    return 0;
  } catch (error) {
    if (error instanceof PromptInterruptedError) return 130;
    if (error instanceof InteractiveInputError) {
      status("Error", error.message);
      return 2;
    }
    if (error instanceof GitCommandError) {
      status("Error", error.message);
      return 1;
    }
    if (isGenerateError(error)) {
      if (error.kind !== "parse" || args.debug === false || error.debug === undefined) {
        status("Error", formatGenerateError(error));
      }
      return 1;
    }
    status("Error", error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await runCli();
}
