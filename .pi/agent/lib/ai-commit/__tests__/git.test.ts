import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  commit,
  DIFF_TRUNCATED_MARKER,
  getStagedDiff,
  getStagedSnapshot,
  hasOnlyLockfiles,
  isLockfile,
} from "../src/git";

const temporaryDirectories: string[] = [];
const originalPwd = process.env.PWD;

function createRepository(): string {
  const directory = mkdtempSync(join(tmpdir(), "pi-ai-commit-"));
  temporaryDirectories.push(directory);
  const result = spawnSync("git", ["init", "--quiet", directory], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  process.env.PWD = directory;
  return directory;
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
}

function gitOutput(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

afterEach(() => {
  process.env.PWD = originalPwd;
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("staged Git context", () => {
  test("changes the snapshot only when the index changes", () => {
    const repository = createRepository();
    const path = join(repository, "value.ts");
    writeFileSync(path, "export const value = 1;\n");
    git(repository, ["add", "value.ts"]);
    const before = getStagedSnapshot()._unsafeUnwrap();

    writeFileSync(path, "export const value = 2;\n");
    expect(getStagedSnapshot()._unsafeUnwrap()).toBe(before);

    git(repository, ["add", "value.ts"]);
    expect(getStagedSnapshot()._unsafeUnwrap()).not.toBe(before);
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

    const diff = getStagedDiff(300)._unsafeUnwrap();
    expect(diff.length).toBeLessThanOrEqual(300);
    expect(diff.endsWith(DIFF_TRUNCATED_MARKER)).toBeTrue();
  });

  test("synchronizes index updates made by commit hooks", () => {
    const repository = createRepository();
    git(repository, ["config", "user.name", "Pi Test"]);
    git(repository, ["config", "user.email", "pi-test@example.invalid"]);
    writeFileSync(join(repository, "verified.txt"), "verified\n");
    writeFileSync(join(repository, "hooked.txt"), "hooked\n");
    git(repository, ["add", "verified.txt"]);
    const snapshot = getStagedSnapshot()._unsafeUnwrap();

    const hookPath = join(repository, ".git", "hooks", "pre-commit");
    writeFileSync(hookPath, "#!/bin/sh\ngit add hooked.txt\n");
    chmodSync(hookPath, 0o755);

    expect(commit("test: hook update", snapshot).isOk()).toBeTrue();
    expect(gitOutput(repository, ["show", "--pretty=format:", "--name-only", "HEAD"])).toBe(
      "hooked.txt\nverified.txt",
    );
    expect(gitOutput(repository, ["diff", "--cached", "--name-only"])).toBe("");
  });

  test("does not commit changes staged after the verified snapshot", () => {
    const repository = createRepository();
    git(repository, ["config", "user.name", "Pi Test"]);
    git(repository, ["config", "user.email", "pi-test@example.invalid"]);
    writeFileSync(join(repository, "verified.txt"), "verified\n");
    writeFileSync(join(repository, "late.txt"), "late\n");
    git(repository, ["add", "verified.txt"]);
    const snapshot = getStagedSnapshot()._unsafeUnwrap();

    const hookPath = join(repository, ".git", "hooks", "pre-commit");
    writeFileSync(hookPath, "#!/bin/sh\nunset GIT_INDEX_FILE\ngit add late.txt\n");
    chmodSync(hookPath, 0o755);

    expect(commit("test: verified snapshot", snapshot).isOk()).toBeTrue();
    expect(gitOutput(repository, ["show", "--pretty=format:", "--name-only", "HEAD"])).toBe(
      "verified.txt",
    );
    expect(gitOutput(repository, ["diff", "--cached", "--name-only"])).toBe("late.txt");
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
