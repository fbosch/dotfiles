import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { updateLockedJsonFile } from "../locked-json-file";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function settingsFile(): string {
  const directory = mkdtempSync(join(tmpdir(), "locked-json-file-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "settings.json");
  writeFileSync(path, '{"count":0}\n');
  temporaryDirectories.push(settingsLockPath(path));
  return path;
}

function settingsLockPath(path: string): string {
  const directory = process.env.PI_LOCKFILE_DIR;
  return directory
    ? join(
        directory,
        `${createHash("sha256")
          .update(`${resolve(path)}.lock`)
          .digest("hex")}.lock`,
      )
    : `${path}.lock`;
}
describe("locked JSON file", () => {
  test("releases its lock when an update fails", () => {
    const path = settingsFile();

    expect(() =>
      updateLockedJsonFile(path, () => {
        throw new Error("update failed");
      }),
    ).toThrow("update failed");
    expect(existsSync(settingsLockPath(path))).toBe(false);

    updateLockedJsonFile(path, () => ({ count: 1 }));
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ count: 1 });
  });

  test("does not write or remove a replacement lock after losing ownership", () => {
    const path = settingsFile();
    const lockPath = settingsLockPath(path);

    expect(() =>
      updateLockedJsonFile(path, (_current, assertOwned) => {
        assertOwned();
        rmdirSync(lockPath);
        mkdirSync(lockPath);
        utimesSync(lockPath, new Date(0), new Date(0));
        expect(assertOwned).toThrow("settings lock ownership was lost");
        return { count: 1 };
      }),
    ).toThrow("settings lock ownership was lost");

    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ count: 0 });
    expect(existsSync(lockPath)).toBe(true);
  });
});
