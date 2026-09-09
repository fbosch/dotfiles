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
    const output = await readGit(cwd, [
      "rev-parse",
      "--show-toplevel",
      "--path-format=absolute",
      "--git-dir",
      "--git-common-dir",
      "--abbrev-ref",
      "HEAD",
    ]);
    const [root, gitDir, commonDir, branchName] = nonEmptyLines(output);
    if (
      root === undefined ||
      gitDir === undefined ||
      commonDir === undefined ||
      branchName === undefined
    ) {
      return undefined;
    }
    const branch = branchName === "HEAD" ? undefined : branchName;
    return Object.freeze({
      ...(branch === undefined ? {} : { branch }),
      detached: branch === undefined,
      root,
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
