import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CANDIDATE_LIMITS, type CandidateInspection, inspectToolCandidates } from "./candidates";
import { loadPiLensServerCandidates, type PiLensServerCandidate } from "./pi-lens-config";
import type { WorkspaceIdentity } from "./workspace";

const execFileAsync = promisify(execFile);
const FILE_LIST_MAX_BUFFER = 512 * 1024;
const MAX_TARGETED_PATHSPECS = 8;
export interface RepositoryFiles {
  readonly files: readonly string[];
  readonly truncated: boolean;
}

export async function inspectConfiguredCandidates(
  context: ExtensionContext,
  workspace: WorkspaceIdentity | undefined,
  discoveredFiles?: RepositoryFiles,
): Promise<CandidateInspection> {
  if (context.isProjectTrusted() === false) {
    return inspectToolCandidates({ projectTrusted: false });
  }
  if (workspace === undefined) {
    return inspectToolCandidates({ projectTrusted: true });
  }

  try {
    const lspServers = loadPiLensServerCandidates(workspace.root);
    const repositoryFiles =
      discoveredFiles ??
      (await discoverRepositoryFiles(workspace.root, candidatePathspecs(lspServers)));
    return inspectToolCandidates({
      files: repositoryFiles.files,
      filesTruncated: repositoryFiles.truncated,
      lspServers,
      projectTrusted: true,
    });
  } catch {
    return inspectToolCandidates({ projectTrusted: true });
  }
}

export function candidatePathspecs(
  lspServers: readonly PiLensServerCandidate[],
): readonly string[] | undefined {
  const extensions = new Set<string>();
  for (const server of lspServers) {
    for (const extension of server.extensions) extensions.add(extension);
  }
  const safeLiteral = /^[A-Za-z0-9._+-]+$/u;
  if (
    [...extensions].some((extension) => !extension.startsWith(".") || !safeLiteral.test(extension))
  ) {
    return undefined;
  }
  return Object.freeze([...extensions].sort().map((extension) => `:(glob)**/*${extension}`));
}

export async function discoverRepositoryFiles(
  root: string,
  pathspecs: readonly string[] | undefined,
): Promise<RepositoryFiles> {
  if (pathspecs?.length === 0) return { files: Object.freeze([]), truncated: false };
  // Git's pathspec evaluation costs more than parsing the full list once the set grows large.
  const targetedPathspecs =
    pathspecs !== undefined && pathspecs.length <= MAX_TARGETED_PATHSPECS ? pathspecs : undefined;
  const { stdout } = await execFileAsync(
    "git",
    [
      "-C",
      root,
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      ...(targetedPathspecs === undefined ? [] : ["--", ...targetedPathspecs]),
    ],
    { encoding: "utf8", maxBuffer: FILE_LIST_MAX_BUFFER, timeout: 1_000 },
  );
  const allFiles = stdout.split(/\r?\n/u).filter((file) => file !== "");
  return {
    files: Object.freeze(allFiles.slice(0, CANDIDATE_LIMITS.repositoryFiles)),
    truncated: allFiles.length > CANDIDATE_LIMITS.repositoryFiles,
  };
}
