import { spawnSync } from "node:child_process";

type CmdResult = {
  status: number;
  stdout: string;
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

export function isInGitRepo(): boolean {
  return runGit(["rev-parse", "--git-dir"]).status === 0;
}

export function getBranchName(): string {
  const result = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  return result.status === 0 ? result.stdout : "";
}

export function getPreviousCommitSubject(): string {
  const result = runGit(["log", "-1", '--pretty=format:%s']);
  return result.status === 0 ? result.stdout : "";
}

export function getStagedFiles(): string[] {
  const result = runGit(["diff", "--cached", "--name-only"]);
  if (result.status !== 0 || result.stdout.length === 0) {
    return [];
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function getStagedDiff(maxChars = 12000): string {
  const result = runGit([
    "diff",
    "--cached",
    "--ignore-all-space",
    "--",
    ":!*-lock.*",
    ":!*.lock",
  ]);

  if (result.status !== 0) {
    return "";
  }

  if (result.stdout.length <= maxChars) {
    return result.stdout;
  }

  const marker = "\n\n[Diff truncated]\n";
  const headRoom = Math.max(0, maxChars - marker.length);
  return `${result.stdout.slice(0, headRoom)}${marker}`;
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

export function commit(message: string): CmdResult {
  return runGit(["commit", "-m", message]);
}
