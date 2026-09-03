import { afterEach, describe, expect, test } from "bun:test";
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
import { join } from "node:path";
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
  return path;
}

describe("locked JSON file", () => {
  test("releases its lock when an update fails", () => {
    const path = settingsFile();

    expect(() =>
      updateLockedJsonFile(path, () => {
        throw new Error("update failed");
      }),
    ).toThrow("update failed");
    expect(existsSync(`${path}.lock`)).toBe(false);

    updateLockedJsonFile(path, () => ({ count: 1 }));
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ count: 1 });
  });

  test("does not write or remove a replacement lock after losing ownership", () => {
    const path = settingsFile();
    const lockPath = `${path}.lock`;

    expect(() =>
      updateLockedJsonFile(path, () => {
        rmdirSync(lockPath);
        mkdirSync(lockPath);
        utimesSync(lockPath, new Date(0), new Date(0));
        return { count: 1 };
      }),
    ).toThrow("settings lock ownership was lost");

    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ count: 0 });
    expect(existsSync(lockPath)).toBe(true);
  });
});
