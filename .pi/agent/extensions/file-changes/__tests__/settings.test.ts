import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadFileChangesSettings,
  resolveFileChangesSettings,
  writeFileChangesSetting,
} from "../settings";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("file changes settings", () => {
  test.each([undefined, {}, { showFileChanges: true }])(
    "shows file changes when the setting is absent or true: %j",
    (settings) => {
      expect(resolveFileChangesSettings(settings)).toEqual({
        showFileChanges: true,
        warnings: [],
      });
    },
  );

  test("hides file changes when configured globally", () => {
    expect(resolveFileChangesSettings({ showFileChanges: false })).toEqual({
      showFileChanges: false,
      warnings: [],
    });
  });

  test("warns and shows file changes for an invalid setting", () => {
    expect(resolveFileChangesSettings({ showFileChanges: "yes" })).toEqual({
      showFileChanges: true,
      warnings: ["global showFileChanges: expected a boolean"],
    });
  });

  test("loads the setting from a Pi settings file", () => {
    const directory = mkdtempSync(join(tmpdir(), "file-changes-settings-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "settings.json");
    writeFileSync(path, '{"showFileChanges":false}\n');

    expect(loadFileChangesSettings(path)).toEqual({
      showFileChanges: false,
      warnings: [],
    });
  });

  test("updates the global setting without dropping other settings", () => {
    const directory = mkdtempSync(join(tmpdir(), "file-changes-settings-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "settings.json");
    writeFileSync(path, '{"theme":"dark","hideFileChanges":true}\n');

    writeFileChangesSetting(false, path);

    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      theme: "dark",
      showFileChanges: false,
    });
  });
});
