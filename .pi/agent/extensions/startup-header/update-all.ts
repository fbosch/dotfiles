import { existsSync } from "node:fs";
import { join } from "node:path";
import { type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { discoverPackagePatches, type PackagePatch } from "../../lib/patch-catalog";
import { installPackageInPiCli, type PackageInstallOutputHandler } from "./package-install";
import type { UpdateDetail } from "./updates";

export interface UpdateAllResult {
  readonly updated: number;
  readonly failed: readonly string[];
  readonly cancelled: boolean;
}

export interface UpdateAllProgress {
  readonly onStart: () => void;
  readonly onOutput: PackageInstallOutputHandler;
}

export interface UpdateAllDependencies {
  readonly installPackage: (
    context: ExtensionContext,
    update: UpdateDetail,
    onOutput: PackageInstallOutputHandler,
  ) => Promise<void>;
  readonly readPatches: () => readonly PackagePatch[];
}

const DEFAULT_DEPENDENCIES: UpdateAllDependencies = {
  installPackage: installPackageInPiCli,
  readPatches: readConfiguredPatches,
};

export async function updateAllAvailablePackages(
  context: ExtensionContext,
  updates: readonly UpdateDetail[],
  dependencies: UpdateAllDependencies = DEFAULT_DEPENDENCIES,
  progress?: UpdateAllProgress,
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

  // Complete the patch warning first so the output overlay does not stack over a confirmation.
  if (updates.length > 0) progress?.onStart();
  const onOutput = progress?.onOutput ?? (() => {});
  let updated = 0;
  const failed: string[] = [];
  for (const update of updates) {
    onOutput(
      "stdout",
      `\n--- Updating ${update.name} (${update.current} → ${update.latest}) ---\n`,
    );
    try {
      await dependencies.installPackage(context, update, onOutput);
      updated += 1;
    } catch (error) {
      failed.push(update.name);
      onOutput(
        "stderr",
        `\nUpdate failed for ${update.name}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
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

function readConfiguredPatches(): readonly PackagePatch[] {
  const directory = join(getAgentDir(), "patches");
  return existsSync(directory) ? discoverPackagePatches(directory) : [];
}
