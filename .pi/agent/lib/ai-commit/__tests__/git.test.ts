import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DIFF_TRUNCATED_MARKER,
  getStagedDiff,
  getStagedFiles,
  getStagedSnapshot,
  hasOnlyLockfiles,
  isLockfile,
} from "../git";

const temporaryDirectories: string[] = [];

function createRepository(): string {
  const directory = mkdtempSync(join(tmpdir(), "pi-ai-commit-"));
  temporaryDirectories.push(directory);
  const result = spawnSync("git", ["init", "--quiet", directory], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return directory;
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("staged Git context", () => {
  test("preserves unusual staged filenames", () => {
    const repository = createRepository();
    const filename = "line\nbreak.ts";
    writeFileSync(join(repository, filename), "export const value = 1;\n");
    git(repository, ["add", "--", filename]);

    expect(getStagedFiles(repository)).toEqual([filename]);
  });

  test("changes the snapshot only when the index changes", () => {
    const repository = createRepository();
    const path = join(repository, "value.ts");
    writeFileSync(path, "export const value = 1;\n");
    git(repository, ["add", "value.ts"]);
    const before = getStagedSnapshot(repository);

    writeFileSync(path, "export const value = 2;\n");
    expect(getStagedSnapshot(repository)).toBe(before);

    git(repository, ["add", "value.ts"]);
    expect(getStagedSnapshot(repository)).not.toBe(before);
  });

  test("bounds a large staged diff and marks truncation", () => {
    const repository = createRepository();
    writeFileSync(
      join(repository, "large.ts"),
      Array.from({ length: 100 }, (_, index) => `export const value${index} = ${index};`).join(
        "\n",
      ),
    );
    git(repository, ["add", "large.ts"]);

    const diff = getStagedDiff(repository, 300);
    expect(diff.length).toBeLessThanOrEqual(300);
    expect(diff.endsWith(DIFF_TRUNCATED_MARKER)).toBeTrue();
  });
});

describe("lockfile detection", () => {
  test("recognizes supported lockfile names", () => {
    for (const path of [
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "bun.lock",
      "Cargo.lock",
      "Gemfile.lock",
      "poetry.lock",
    ]) {
      expect(isLockfile(path)).toBeTrue();
    }
  });

  test("requires at least one path for a lockfile-only change", () => {
    expect(hasOnlyLockfiles([])).toBeFalse();
    expect(hasOnlyLockfiles(["bun.lock", "package-lock.json"])).toBeTrue();
    expect(hasOnlyLockfiles(["bun.lock", "src/index.ts"])).toBeFalse();
  });
});
