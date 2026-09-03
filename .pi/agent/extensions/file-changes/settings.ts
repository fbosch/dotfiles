import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface FileChangesSettings {
  readonly hideFileChanges: boolean;
  readonly warnings: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

export function resolveFileChangesSettings(settings: unknown): FileChangesSettings {
  if (isRecord(settings) === false || settings.hideFileChanges === undefined) {
    return { hideFileChanges: false, warnings: [] };
  }

  if (typeof settings.hideFileChanges !== "boolean") {
    return {
      hideFileChanges: false,
      warnings: ["global hideFileChanges: expected a boolean"],
    };
  }

  return { hideFileChanges: settings.hideFileChanges, warnings: [] };
}

export function loadFileChangesSettings(
  settingsPath = join(getAgentDir(), "settings.json"),
): FileChangesSettings {
  let source: string;
  try {
    source = readFileSync(settingsPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { hideFileChanges: false, warnings: [] };
    }
    return {
      hideFileChanges: false,
      warnings: [
        `Cannot load Pi settings from ${settingsPath}: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }

  try {
    return resolveFileChangesSettings(JSON.parse(source));
  } catch (error) {
    return {
      hideFileChanges: false,
      warnings: [
        `Cannot load Pi settings from ${settingsPath}: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}
