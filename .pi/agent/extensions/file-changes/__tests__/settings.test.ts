import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFileChangesSettings, resolveFileChangesSettings } from "../settings";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("file changes settings", () => {
  test.each([undefined, {}, { hideFileChanges: false }])(
    "shows file changes when the setting is absent or false: %j",
    (settings) => {
      expect(resolveFileChangesSettings(settings)).toEqual({
        hideFileChanges: false,
        warnings: [],
      });
    },
  );

  test("hides file changes when configured globally", () => {
    expect(resolveFileChangesSettings({ hideFileChanges: true })).toEqual({
      hideFileChanges: true,
      warnings: [],
    });
  });

  test("warns and shows file changes for an invalid setting", () => {
    expect(resolveFileChangesSettings({ hideFileChanges: "yes" })).toEqual({
      hideFileChanges: false,
      warnings: ["global hideFileChanges: expected a boolean"],
    });
  });

  test("loads the setting from a Pi settings file", () => {
    const directory = mkdtempSync(join(tmpdir(), "file-changes-settings-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "settings.json");
    writeFileSync(path, '{"hideFileChanges":true}\n');

    expect(loadFileChangesSettings(path)).toEqual({
      hideFileChanges: true,
      warnings: [],
    });
  });
});
