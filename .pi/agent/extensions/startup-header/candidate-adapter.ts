import { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ResolvedFormatterSettings } from "../formatter/settings";
import type { ResolvedLspSettings } from "../lsp/settings";
import {
  CANDIDATE_LIMITS,
  type CandidateAncestor,
  type CandidateInspection,
  inspectToolCandidates,
} from "./candidates";
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
    return inspectToolCandidates({ ancestors: [], projectTrusted: false });
  }
  if (workspace === undefined) {
    return inspectToolCandidates({ ancestors: [], projectTrusted: true });
  }

  try {
    const [{ loadFormatterSettings }, { loadLspSettings }] = await Promise.all([
      import("../formatter/index"),
      import("../lsp/index"),
    ]);
    const formatter = loadFormatterSettings(context);
    const lsp = loadLspSettings(context);
    const ancestors = buildAncestorChain(context.cwd, workspace.root);
    const repositoryFiles =
      discoveredFiles ??
      (await discoverRepositoryFiles(
        workspace.root,
        candidatePathspecs(formatter, lsp, ancestors),
      ));
    return inspectToolCandidates({
      ancestors,
      files: repositoryFiles.files,
      filesTruncated: repositoryFiles.truncated,
      formatter,
      lsp,
      markerReader: markerExistsWithinDirectory,
      projectTrusted: true,
    });
  } catch {
    return inspectToolCandidates({ ancestors: [], projectTrusted: true });
  }
}

export function resolveMarkerTarget(directory: string, marker: string): string | undefined {
  if (marker === "" || isAbsolute(marker)) return undefined;
  const target = resolve(directory, marker);
  const withinDirectory = relative(directory, target);
  if (withinDirectory.startsWith("..") || isAbsolute(withinDirectory)) return undefined;
  return target;
}

export function markerExistsWithinDirectory(directory: string, marker: string): boolean {
  try {
    const target = resolveMarkerTarget(directory, marker);
    if (target === undefined || !existsSync(target)) return false;
    const canonicalDirectory = realpathSync(directory);
    const canonicalTarget = realpathSync(target);
    const withinDirectory = relative(canonicalDirectory, canonicalTarget);
    return !withinDirectory.startsWith("..") && !isAbsolute(withinDirectory);
  } catch {
    return false;
  }
}
function markersExist(
  markers: readonly string[],
  ancestors: readonly CandidateAncestor[],
): boolean {
  return ancestors.some((ancestor) =>
    markers
      .slice(0, CANDIDATE_LIMITS.markersPerEntry)
      .some((marker) => markerExistsWithinDirectory(ancestor.path, marker)),
  );
}

export function candidatePathspecs(
  formatter: ResolvedFormatterSettings,
  lsp: ResolvedLspSettings,
  ancestors: readonly CandidateAncestor[],
): readonly string[] | undefined {
  const extensions = new Set<string>();
  const fileNames = new Set<string>();
  for (const rule of formatter.rules) {
    if (
      !rule.commands.some(
        (command) =>
          command.requireRootMarker === false || markersExist(command.rootMarkers, ancestors),
      )
    ) {
      continue;
    }
    for (const extension of rule.extensions) extensions.add(extension);
    for (const fileName of rule.fileNames) fileNames.add(fileName);
  }
  for (const server of lsp.servers) {
    if (!markersExist(server.rootMarkers, ancestors)) continue;
    for (const language of server.languages) {
      for (const extension of language.extensions) extensions.add(extension);
      for (const fileName of language.fileNames) fileNames.add(fileName);
    }
  }
  const safeLiteral = /^[A-Za-z0-9._+-]+$/u;
  if (
    [...extensions].some(
      (extension) => !extension.startsWith(".") || !safeLiteral.test(extension),
    ) ||
    [...fileNames].some((fileName) => !safeLiteral.test(fileName))
  ) {
    return undefined;
  }
  return Object.freeze([
    ...[...extensions].sort().map((extension) => `:(glob)**/*${extension}`),
    ...[...fileNames].sort().map((fileName) => `:(glob)**/${fileName}`),
  ]);
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

export function buildAncestorChain(cwd: string, root: string): CandidateAncestor[] {
  const canonicalCwd = resolve(cwd);
  const canonicalRoot = resolve(root);
  const outsideRoot = relative(canonicalRoot, canonicalCwd);
  if (outsideRoot.startsWith("..") || isAbsolute(outsideRoot)) return [];

  const ancestors: CandidateAncestor[] = [];
  let directory = canonicalCwd;
  while (ancestors.length <= CANDIDATE_LIMITS.ancestors) {
    ancestors.push({ path: directory });
    if (directory === canonicalRoot) break;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return ancestors;
}
