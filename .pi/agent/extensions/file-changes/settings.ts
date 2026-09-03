import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readLockedJsonFile, updateLockedJsonFile } from "../../lib/locked-json-file";

export interface FileChangesSettings {
  readonly showFileChanges: boolean;
  readonly warnings: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function defaultSettings(): FileChangesSettings {
  return { showFileChanges: true, warnings: [] };
}

function settingsError(settingsPath: string, error: unknown): string {
  return `Cannot load Pi settings from ${settingsPath}: ${error instanceof Error ? error.message : String(error)}`;
}

export function resolveFileChangesSettings(settings: unknown): FileChangesSettings {
  if (isRecord(settings) === false || settings.showFileChanges === undefined) {
    return defaultSettings();
  }

  if (typeof settings.showFileChanges !== "boolean") {
    return {
      showFileChanges: true,
      warnings: ["global showFileChanges: expected a boolean"],
    };
  }

  return { showFileChanges: settings.showFileChanges, warnings: [] };
}

export function loadFileChangesSettings(
  settingsPath = join(getAgentDir(), "settings.json"),
): FileChangesSettings {
  try {
    const settings = readLockedJsonFile(settingsPath);
    return settings === undefined ? defaultSettings() : resolveFileChangesSettings(settings);
  } catch (error) {
    return { ...defaultSettings(), warnings: [settingsError(settingsPath, error)] };
  }
}

export function writeFileChangesSetting(
  showFileChanges: boolean,
  settingsPath = join(getAgentDir(), "settings.json"),
): void {
  try {
    updateLockedJsonFile(settingsPath, (current) => {
      const settings = current ?? {};
      if (isRecord(settings) === false) {
        throw new Error(`Cannot update Pi settings from ${settingsPath}: expected a JSON object`);
      }

      settings.showFileChanges = showFileChanges;
      delete settings.hideFileChanges;
      return settings;
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Cannot update Pi settings")) {
      throw error;
    }
    throw new Error(settingsError(settingsPath, error));
  }
}
