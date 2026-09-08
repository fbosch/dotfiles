import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface WorkspaceIdentity {
  readonly branch?: string;
  readonly detached: boolean;
  readonly root: string;
  readonly linkedWorktree: boolean;
}

export type GitReader = (cwd: string, args: readonly string[]) => Promise<string>;

export async function inspectWorkspace(
  cwd: string,
  readGit: GitReader = executeGit,
): Promise<WorkspaceIdentity | undefined> {
  try {
    const [root, directories] = await Promise.all([
      readGit(cwd, ["rev-parse", "--show-toplevel"]),
      readGit(cwd, ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"]),
    ]);
    const [gitDir, commonDir] = nonEmptyLines(directories);
    const canonicalRoot = root.trim();
    if (canonicalRoot.length === 0 || gitDir === undefined || commonDir === undefined) {
      return undefined;
    }

    let branch: string | undefined;
    try {
      const candidate = (await readGit(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"])).trim();
      if (candidate.length > 0) branch = candidate;
    } catch {
      // A detached HEAD is a valid Git workspace state.
    }

    return Object.freeze({
      ...(branch === undefined ? {} : { branch }),
      detached: branch === undefined,
      root: canonicalRoot,
      linkedWorktree: gitDir !== commonDir,
    });
  } catch {
    return undefined;
  }
}

async function executeGit(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 8 * 1024,
    timeout: 1_000,
  });
  return stdout;
}

function nonEmptyLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
