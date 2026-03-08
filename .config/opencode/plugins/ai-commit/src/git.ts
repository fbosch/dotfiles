import { spawnSync } from "node:child_process";
import { err, ok, type Result } from "neverthrow";

type CmdResult = {
  status: number;
  stdout: string;
  stderr: string;
};

export const DEFAULT_STAGED_DIFF_MAX_CHARS = 6000;
export const DIFF_TRUNCATED_MARKER = "\n\n[Diff truncated]\n";

export type GitError = {
  kind: "git";
  command: string;
  stderr: string;
};

function runGit(args: string[]): CmdResult {
  const result = spawnSync("git", args, {
    encoding: "utf8",
  });

  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

function gitResult(args: string[]): Result<string, GitError> {
  const result = runGit(args);
  if (result.status === 0) {
    return ok(result.stdout);
  }

  return err({
    kind: "git",
    command: `git ${args.join(" ")}`,
    stderr: result.stderr,
  });
}

export function isInGitRepo(): boolean {
  return runGit(["rev-parse", "--git-dir"]).status === 0;
}

export function getBranchName(): Result<string, GitError> {
  return gitResult(["rev-parse", "--abbrev-ref", "HEAD"]);
}

export function getPreviousCommitSubject(): Result<string, GitError> {
  return gitResult(["log", "-1", "--pretty=format:%s"]);
}

export function getStagedFiles(): Result<string[], GitError> {
  return gitResult(["diff", "--cached", "--name-only"]).map((stdout) => {
    if (stdout.length === 0) {
      return [];
    }

    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  });
}

export function getStagedDiff(maxChars = DEFAULT_STAGED_DIFF_MAX_CHARS): Result<string, GitError> {
  return gitResult([
    "diff",
    "--cached",
    "--ignore-all-space",
    "-U1",
    "--",
    ":!*-lock.*",
    ":!*.lock",
  ]).map((stdout) => {
    if (stdout.length <= maxChars) {
      return stdout;
    }

    const headRoom = Math.max(0, maxChars - DIFF_TRUNCATED_MARKER.length);
    return `${stdout.slice(0, headRoom)}${DIFF_TRUNCATED_MARKER}`;
  });
}

export function isLockfile(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.endsWith(".lock") ||
    lower.includes("-lock.") ||
    lower.endsWith("pnpm-lock.yaml") ||
    lower.endsWith("package-lock.json") ||
    lower.endsWith("yarn.lock") ||
    lower.endsWith("bun.lock") ||
    lower.endsWith("bun.lockb") ||
    lower.endsWith("cargo.lock") ||
    lower.endsWith("gemfile.lock") ||
    lower.endsWith("poetry.lock")
  );
}

export function hasOnlyLockfiles(paths: string[]): boolean {
  if (paths.length === 0) {
    return false;
  }

  return paths.every(isLockfile);
}

export function commit(message: string): Result<string, GitError> {
  return gitResult(["commit", "-m", message]);
}
