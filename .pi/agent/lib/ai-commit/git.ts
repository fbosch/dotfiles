import { type SpawnSyncOptionsWithStringEncoding, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

export const DEFAULT_STAGED_DIFF_MAX_CHARS = 6000;
export const DIFF_TRUNCATED_MARKER = "\n\n[Diff truncated]\n";
const DIFF_FILE_HEADER_PREFIX = "diff --git ";

type RunGitOptions = Omit<SpawnSyncOptionsWithStringEncoding, "cwd" | "encoding">;

type DiffFileBlock = {
  header: string;
  hunks: string[];
};

type CompressedDiffFileBlock = {
  parts: string[];
};

export class GitCommandError extends Error {
  readonly command: string;
  readonly stderr: string;

  constructor(args: readonly string[], stderr: string) {
    const command = `git ${args.join(" ")}`;
    super(stderr.length > 0 ? `${command}: ${stderr}` : `${command} failed`);
    this.name = "GitCommandError";
    this.command = command;
    this.stderr = stderr;
  }
}

function runGit(
  cwd: string,
  args: readonly string[],
  options: RunGitOptions = {},
): { stdout: string; stderr: string } {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    ...options,
  });
  const stderr = (result.stderr ?? "").trim();
  if (result.error !== undefined) {
    throw new GitCommandError(args, result.error.message);
  }
  if (result.status !== 0) {
    throw new GitCommandError(args, stderr);
  }
  return { stdout: result.stdout ?? "", stderr };
}

export function isInGitRepo(cwd: string): boolean {
  try {
    runGit(cwd, ["rev-parse", "--git-dir"], { stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

export function getRepoRoot(cwd: string): string {
  return runGit(cwd, ["rev-parse", "--show-toplevel"]).stdout.trim();
}

export function getBranchName(cwd: string): string {
  return runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
}

export function getStagedFiles(cwd: string): string[] {
  const output = runGit(cwd, ["diff", "--cached", "--name-only", "-z"]).stdout;
  return output.split("\0").filter((path) => path.length > 0);
}

export function getStagedSnapshot(cwd: string): string {
  const diff = runGit(cwd, [
    "diff",
    "--cached",
    "--binary",
    "--full-index",
    "--no-ext-diff",
    "--no-textconv",
  ]).stdout;
  return createHash("sha256").update(diff).digest("hex");
}

export function getStagedDiff(cwd: string, maxChars = DEFAULT_STAGED_DIFF_MAX_CHARS): string {
  const diff = runGit(cwd, [
    "diff",
    "--cached",
    "--ignore-all-space",
    "-U1",
    "--no-ext-diff",
    "--no-textconv",
    "--",
    ":!*-lock.*",
    ":!*.lock",
  ]).stdout.trim();

  return diff.length <= maxChars ? diff : compressDiff(diff, maxChars);
}

function compressDiff(diff: string, maxChars: number): string {
  const blocks = splitDiffIntoFileBlocks(diff);
  if (blocks.length === 0) return truncateDiff(diff, maxChars);

  const maxBodyChars = Math.max(0, maxChars - DIFF_TRUNCATED_MARKER.length);
  const compressed = buildCompressedDiff(blocks, maxBodyChars);
  return compressed.length === 0
    ? truncateDiff(diff, maxChars)
    : `${compressed}${DIFF_TRUNCATED_MARKER}`;
}

function buildCompressedDiff(blocks: DiffFileBlock[], maxChars: number): string {
  const includedBlocks: CompressedDiffFileBlock[] = [];
  let currentLength = 0;

  for (const block of blocks) {
    const additionalLength = getAdditionalLength(currentLength, block.header);
    if (currentLength + additionalLength > maxChars) break;
    includedBlocks.push({ parts: [block.header] });
    currentLength += additionalLength;
  }

  let appendedAnyHunk = false;
  let hunkIndex = 0;
  while (true) {
    let appendedHunk = false;
    let truncatedBlockIndex: number | undefined;
    let truncatedHunk: string | undefined;

    for (const [index, compressedBlock] of includedBlocks.entries()) {
      const hunk = blocks[index]?.hunks[hunkIndex];
      if (hunk === undefined) continue;

      const additionalLength = getAdditionalLength(currentLength, hunk, compressedBlock.parts);
      if (currentLength + additionalLength <= maxChars) {
        compressedBlock.parts.push(hunk);
        currentLength += additionalLength;
        appendedHunk = true;
        appendedAnyHunk = true;
        continue;
      }

      if (appendedAnyHunk === false && truncatedHunk === undefined) {
        truncatedHunk = truncateSegment(hunk, maxChars - currentLength, compressedBlock.parts);
        if (truncatedHunk !== undefined) truncatedBlockIndex = index;
      }
    }

    if (
      appendedHunk === false &&
      appendedAnyHunk === false &&
      truncatedBlockIndex !== undefined &&
      truncatedHunk !== undefined
    ) {
      includedBlocks[truncatedBlockIndex]?.parts.push(truncatedHunk);
      appendedHunk = true;
      appendedAnyHunk = true;
    }

    if (appendedHunk === false) break;
    hunkIndex += 1;
  }

  return includedBlocks.flatMap((block) => block.parts).join("\n");
}

function splitDiffIntoFileBlocks(diff: string): DiffFileBlock[] {
  const rawBlocks: string[] = [];
  let currentLines: string[] = [];

  for (const line of diff.split("\n")) {
    if (line.startsWith(DIFF_FILE_HEADER_PREFIX)) {
      if (currentLines.length > 0) rawBlocks.push(currentLines.join("\n"));
      currentLines = [line];
      continue;
    }
    if (currentLines.length > 0) currentLines.push(line);
  }
  if (currentLines.length > 0) rawBlocks.push(currentLines.join("\n"));

  return rawBlocks.map(splitFileBlock).filter((block) => block.header.length > 0);
}

function splitFileBlock(block: string): DiffFileBlock {
  const headerLines: string[] = [];
  const hunks: string[] = [];
  let currentHunk: string[] = [];

  for (const line of block.split("\n")) {
    if (line.startsWith("@@")) {
      if (currentHunk.length > 0) hunks.push(currentHunk.join("\n"));
      currentHunk = [line];
      continue;
    }
    if (currentHunk.length === 0) headerLines.push(line);
    else currentHunk.push(line);
  }
  if (currentHunk.length > 0) hunks.push(currentHunk.join("\n"));

  return { header: headerLines.join("\n"), hunks };
}

function getAdditionalLength(
  currentLength: number,
  nextPart: string,
  blockParts: readonly string[] = [],
): number {
  if (nextPart.length === 0) return 0;
  if (blockParts.length > 0) return nextPart.length + 1;
  return currentLength === 0 ? nextPart.length : nextPart.length + 1;
}

function truncateSegment(
  segment: string,
  maxChars: number,
  blockParts: readonly string[],
): string | undefined {
  const availableChars = maxChars - (blockParts.length > 0 ? 1 : 0);
  return availableChars <= 0 ? undefined : segment.slice(0, availableChars);
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
    lower.endsWith("bun.lockb") ||
    lower.endsWith("gemfile.lock")
  );
}

export function hasOnlyLockfiles(paths: readonly string[]): boolean {
  return paths.length > 0 && paths.every(isLockfile);
}

export function commit(cwd: string, message: string): string {
  const result = runGit(cwd, ["commit", "-m", message]);
  return [result.stderr, result.stdout.trim()].filter((part) => part.length > 0).join("\n");
}
