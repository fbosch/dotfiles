import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const agentRoot = resolve(import.meta.dir, "../..");
const patchPath = resolve(agentRoot, "patches/@ff-labs+pi-fff+0.11.0.patch");
const installedPackage = resolve(agentRoot, "npm/node_modules/@ff-labs/pi-fff");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the FFF patch round-trips and preserves native Pi integration fixes", () => {
  const fixture = mkdtempSync(resolve(tmpdir(), "pi-fff-patch-"));
  temporaryDirectories.push(fixture);
  const packageDir = resolve(fixture, "node_modules/@ff-labs/pi-fff");
  mkdirSync(dirname(packageDir), { recursive: true });
  cpSync(installedPackage, packageDir, { recursive: true });

  const reverse = Bun.spawnSync(["git", "apply", "--reverse", "--check", patchPath], {
    cwd: fixture,
    stderr: "pipe",
  });
  expect(reverse.exitCode, reverse.stderr.toString()).toBe(0);
  const reverseApply = Bun.spawnSync(["git", "apply", "--reverse", patchPath], {
    cwd: fixture,
    stderr: "pipe",
  });
  expect(reverseApply.exitCode, reverseApply.stderr.toString()).toBe(0);

  const filePicker = readFileSync(resolve(packageDir, "src/file-picker.ts"), "utf8");
  const index = readFileSync(resolve(packageDir, "src/index.ts"), "utf8");
  expect(filePicker).not.toContain('disableWatch: process.platform === "darwin"');
  expect(index).not.toContain('programmatic: "read-only" as const');
  expect(index).not.toContain("gitStatus: mixed.item.gitStatus");

  const forward = Bun.spawnSync(["git", "apply", patchPath], { cwd: fixture, stderr: "pipe" });
  expect(forward.exitCode, forward.stderr.toString()).toBe(0);
  expect(readFileSync(resolve(packageDir, "src/file-picker.ts"), "utf8")).toContain(
    'disableWatch: process.platform === "darwin"',
  );
  const patchedIndex = readFileSync(resolve(packageDir, "src/index.ts"), "utf8");
  expect(patchedIndex).toContain("gitStatus: mixed.item.gitStatus");
  expect(patchedIndex.match(/programmatic: "read-only" as const/g)).toHaveLength(2);
});
