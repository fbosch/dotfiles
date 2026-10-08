import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadConfiguredGlobalReferences, loadConfiguredProjectReferences } from "./configured";
import { loadDocsCacheReferences } from "./docs-cache";
import type { ProjectReference } from "./types";

function assertNoReferenceCollisions(
  configuredReferences: readonly ProjectReference[],
  docsCacheReferences: readonly ProjectReference[],
): void {
  const configuredNames = new Map(
    configuredReferences.map((reference) => [reference.name.toLowerCase(), reference.name]),
  );
  for (const reference of docsCacheReferences) {
    const configuredName = configuredNames.get(reference.name.toLowerCase());
    if (configuredName !== undefined) {
      throw new Error(
        `Docs-cache reference "${reference.name}" conflicts with configured reference "${configuredName}".`,
      );
    }
  }
}

function mergeConfiguredReferences(
  globalReferences: readonly ProjectReference[],
  projectReferences: readonly ProjectReference[],
): ProjectReference[] {
  const referencesByName = new Map<string, ProjectReference>();
  for (const reference of [...globalReferences, ...projectReferences]) {
    referencesByName.set(reference.name.toLowerCase(), reference);
  }
  return [...referencesByName.values()];
}

export function loadProjectReferences(
  cwd: string,
  projectTrusted: boolean,
  home = homedir(),
  agentDirectory = getAgentDir(),
): ProjectReference[] {
  const globalReferences = loadConfiguredGlobalReferences(agentDirectory, home);
  const projectReferences = projectTrusted ? loadConfiguredProjectReferences(cwd, home) : [];
  const canonicalCwd = realpathSync(cwd);
  const configuredReferences = mergeConfiguredReferences(
    globalReferences,
    projectReferences,
  ).filter((reference) => reference.path !== canonicalCwd);
  const docsCacheReferences = (projectTrusted ? loadDocsCacheReferences(cwd) : []).filter(
    (reference) => reference.path !== canonicalCwd,
  );
  assertNoReferenceCollisions(configuredReferences, docsCacheReferences);
  return [...configuredReferences, ...docsCacheReferences].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}
