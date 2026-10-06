import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  DefaultPackageManager,
  type ExtensionContext,
  getAgentDir,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { discoverPackagePatches, type PackagePatch } from "../../lib/patch-catalog";
import type { UpdateDetail } from "./updates";

export interface UpdateAllResult {
  readonly updated: number;
  readonly failed: readonly string[];
  readonly cancelled: boolean;
}

export interface UpdateAllDependencies {
  readonly installPackage: (context: ExtensionContext, update: UpdateDetail) => Promise<void>;
  readonly readPatches: () => readonly PackagePatch[];
}

const DEFAULT_DEPENDENCIES: UpdateAllDependencies = {
  installPackage: installConfiguredPackage,
  readPatches: readConfiguredPatches,
};

export async function updateAllAvailablePackages(
  context: ExtensionContext,
  updates: readonly UpdateDetail[],
  dependencies: UpdateAllDependencies = DEFAULT_DEPENDENCIES,
): Promise<UpdateAllResult> {
  const patchMismatches = findPatchMismatches(updates, dependencies.readPatches());
  if (patchMismatches.length > 0) {
    const targets = patchMismatches
      .map(({ name, current, latest }) => `${name} ${current} → ${latest}`)
      .join(", ");
    const confirmed = await context.ui.confirm(
      "Update packages with local patches?",
      `Updating ${targets} will install versions that do not match their local patches. Continue?`,
    );
    if (!confirmed) return { updated: 0, failed: [], cancelled: true };
  }

  let updated = 0;
  const failed: string[] = [];
  for (const update of updates) {
    try {
      await dependencies.installPackage(context, update);
      updated += 1;
    } catch {
      failed.push(update.name);
    }
  }
  return { updated, failed: Object.freeze(failed), cancelled: false };
}

function findPatchMismatches(
  updates: readonly UpdateDetail[],
  patches: readonly PackagePatch[],
): readonly UpdateDetail[] {
  return updates.filter((update) =>
    patches.some(
      (patch) =>
        patch.name === update.name &&
        patch.version === update.current &&
        patch.version !== update.latest,
    ),
  );
}

async function installConfiguredPackage(
  context: ExtensionContext,
  update: UpdateDetail,
): Promise<void> {
  const agentDir = getAgentDir();
  const settings = SettingsManager.create(context.cwd, agentDir, {
    projectTrusted: context.isProjectTrusted(),
  });
  const manager = new DefaultPackageManager({
    cwd: context.cwd,
    agentDir,
    settingsManager: settings,
  });
  await manager.installAndPersist(`npm:${update.name}@${update.latest}`, {
    local: update.scope === "project",
  });
}

function readConfiguredPatches(): readonly PackagePatch[] {
  const directory = join(getAgentDir(), "patches");
  return existsSync(directory) ? discoverPackagePatches(directory) : [];
}
