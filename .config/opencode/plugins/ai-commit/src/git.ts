import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { err, ok, type Result } from "neverthrow";

type RunGitOptions = Omit<SpawnSyncOptionsWithStringEncoding, "encoding">;

type CmdResult = {
  status: number;
  stdout: string;
  stderr: string;
};

type DiffFileBlock = {
  header: string;
  hunks: string[];
};

type CompressedDiffFileBlock = {
  parts: string[];
};

export const DEFAULT_STAGED_DIFF_MAX_CHARS = 6000;
export const DIFF_TRUNCATED_MARKER = "\n\n[Diff truncated]\n";
const DIFF_FILE_HEADER_PREFIX = "diff --git ";

export type GitError = {
  kind: "git";
  command: string;
  stderr: string;
};

export type PreviousCommitInfo = {
  subject: string;
  isMerge: boolean;
};

function runGit(
  args: string[],
  options?: RunGitOptions,
): CmdResult {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    cwd: process.env.PWD,
    ...options,
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

export function getPreviousCommitInfo(): Result<PreviousCommitInfo, GitError> {
  return gitResult(["show", "-s", "--format=%s%n%P", "HEAD"]).map((stdout) => {
    const [subjectLine = "", parentLine = ""] = stdout.split("\n");
    const parentCount = parentLine
      .split(/\s+/u)
      .map((value) => value.trim())
      .filter((value) => value.length > 0).length;

    return {
      subject: subjectLine.trim(),
      isMerge: parentCount >= 2,
    };
  });
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

    return compressDiff(stdout, maxChars);
  });
}

function compressDiff(diff: string, maxChars: number): string {
  const blocks = splitDiffIntoFileBlocks(diff);
  if (blocks.length === 0) {
    return truncateDiff(diff, maxChars);
  }

  const maxBodyChars = Math.max(0, maxChars - DIFF_TRUNCATED_MARKER.length);
  const compressed = buildCompressedDiff(blocks, maxBodyChars);
  if (compressed.length === 0) {
    return truncateDiff(diff, maxChars);
  }

  return `${compressed}${DIFF_TRUNCATED_MARKER}`;
}

function buildCompressedDiff(blocks: DiffFileBlock[], maxChars: number): string {
  const includedBlocks: CompressedDiffFileBlock[] = [];
  let currentLength = 0;

  for (const block of blocks) {
    const additionalLength = getAdditionalLength(currentLength, block.header);
    if (currentLength + additionalLength > maxChars) {
      break;
    }

    includedBlocks.push({
      parts: [block.header],
    });
    currentLength += additionalLength;
  }

  let appendedAnyHunk = false;

  let hunkIndex = 0;
  while (true) {
    let appendedHunk = false;
    let truncatedBlockIndex: number | null = null;
    let truncatedHunk: string | null = null;

    for (const [index, compressedBlock] of includedBlocks.entries()) {
      const hunk = blocks[index]?.hunks[hunkIndex];
      if (hunk === undefined) {
        continue;
      }

      const additionalLength = getAdditionalLength(currentLength, hunk, compressedBlock.parts);
      if (currentLength + additionalLength <= maxChars) {
        compressedBlock.parts.push(hunk);
        currentLength += additionalLength;
        appendedHunk = true;
        appendedAnyHunk = true;
        continue;
      }

      if (appendedAnyHunk === false && truncatedHunk === null) {
        const remainingChars = maxChars - currentLength;
        truncatedHunk = truncateSegment(hunk, remainingChars, compressedBlock.parts);
        truncatedBlockIndex = truncatedHunk === null ? null : index;
      }
    }

    if (appendedHunk === false && appendedAnyHunk === false && truncatedBlockIndex !== null && truncatedHunk !== null) {
      includedBlocks[truncatedBlockIndex]?.parts.push(truncatedHunk);
      currentLength = maxChars;
      appendedHunk = true;
      appendedAnyHunk = true;
    }

    if (appendedHunk === false) {
      break;
    }

    hunkIndex += 1;
  }

  return includedBlocks
    .flatMap((block) => block.parts)
    .join("\n");
}

function splitDiffIntoFileBlocks(diff: string): DiffFileBlock[] {
  const lines = diff.split("\n");
  const rawBlocks: string[] = [];
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith(DIFF_FILE_HEADER_PREFIX)) {
      if (currentLines.length > 0) {
        rawBlocks.push(currentLines.join("\n"));
      }

      currentLines = [line];
      continue;
    }

    if (currentLines.length === 0) {
      continue;
    }

    currentLines.push(line);
  }

  if (currentLines.length > 0) {
    rawBlocks.push(currentLines.join("\n"));
  }

  return rawBlocks.map(splitFileBlock).filter((block) => block.header.length > 0);
}

function splitFileBlock(block: string): DiffFileBlock {
  const lines = block.split("\n");
  const headerLines: string[] = [];
  const hunks: string[] = [];
  let currentHunk: string[] = [];

  for (const line of lines) {
    if (line.startsWith("@@")) {
      if (currentHunk.length > 0) {
        hunks.push(currentHunk.join("\n"));
      }

      currentHunk = [line];
      continue;
    }

    if (currentHunk.length === 0) {
      headerLines.push(line);
      continue;
    }

    currentHunk.push(line);
  }

  if (currentHunk.length > 0) {
    hunks.push(currentHunk.join("\n"));
  }

  return {
    header: headerLines.join("\n"),
    hunks,
  };
}

function getAdditionalLength(
  currentLength: number,
  nextPart: string,
  blockParts: string[] = [],
): number {
  if (nextPart.length === 0) {
    return 0;
  }

  if (blockParts.length > 0) {
    return 1 + nextPart.length;
  }

  return currentLength === 0 ? nextPart.length : nextPart.length + 1;
}

function truncateSegment(segment: string, maxChars: number, blockParts: string[]): string | null {
  const additionalLength = blockParts.length > 0 ? 1 : 0;
  const availableChars = maxChars - additionalLength;
  if (availableChars <= 0) {
    return null;
  }

  return segment.slice(0, availableChars);
}

function truncateDiff(diff: string, maxChars: number): string {
  const headRoom = Math.max(0, maxChars - DIFF_TRUNCATED_MARKER.length);
  return `${diff.slice(0, headRoom)}${DIFF_TRUNCATED_MARKER}`;
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
  const result = runGit(["commit", "-m", message], {
    stdio: "inherit",
  });

  if (result.status === 0) {
    return ok("");
  }

  return err({
    kind: "git",
    command: `git commit -m ${JSON.stringify(message)}`,
    stderr: "git commit failed",
  });
}
