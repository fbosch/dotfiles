import { ResultAsync } from "neverthrow";
import {
  generateCommitWithPi,
  type GeneratedCommit,
  type GenerateError,
  type GenerateOptions,
} from "../index";

export type { GeneratedCommit, GenerateError };

export interface GitContext {
  repoRoot: string;
  repoName: string;
  remoteOrigin: string;
  branch: string;
  stagedFiles: string[];
  stagedDiff: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function normalizeGenerateError(error: unknown): GenerateError {
  if (
    isRecord(error) &&
    (error.kind === "connection" ||
      error.kind === "timeout" ||
      error.kind === "session" ||
      error.kind === "parse" ||
      error.kind === "sdk") &&
    typeof error.message === "string"
  ) {
    if (error.kind === "parse" && typeof error.debug === "string") {
      return { kind: error.kind, message: error.message, debug: error.debug };
    }
    return { kind: error.kind, message: error.message };
  }

  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (
    normalized.includes("timed out") ||
    normalized.includes("timeout") ||
    normalized.includes("aborted")
  ) {
    return { kind: "timeout", message };
  }
  return { kind: "sdk", message };
}

export function generateCommit(
  context: GitContext,
  modelRef: string | null,
  options: GenerateOptions = {},
): ResultAsync<GeneratedCommit, GenerateError> {
  return ResultAsync.fromPromise(
    generateCommitWithPi(
      context.repoRoot,
      {
        branch: context.branch,
        stagedFiles: context.stagedFiles,
        stagedDiff: context.stagedDiff,
      },
      modelRef,
      options,
    ),
    normalizeGenerateError,
  );
}
