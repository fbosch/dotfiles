import { existsSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  CANDIDATE_LIMITS,
  type CandidateAncestor,
  type CandidateInspection,
  inspectToolCandidates,
} from "./candidates";
import type { WorkspaceIdentity } from "./workspace";

export async function inspectConfiguredCandidates(
  context: ExtensionContext,
  workspace: WorkspaceIdentity | undefined,
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
    return inspectToolCandidates({
      ancestors: buildAncestorChain(context.cwd, workspace.root),
      formatter: loadFormatterSettings(context),
      lsp: loadLspSettings(context),
      markerReader: (directory, marker) => {
        try {
          const target = resolveMarkerTarget(directory, marker);
          return target !== undefined && existsSync(target);
        } catch {
          return false;
        }
      },
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
