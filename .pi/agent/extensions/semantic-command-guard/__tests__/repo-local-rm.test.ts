import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isRepoLocalRm } from "../repo-local-rm";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "repo-local-rm-"));
  roots.push(root);
  mkdirSync(join(root, ".git"));
  return root;
}

describe("repo-local rm exemption", () => {
  test.each([
    "rm -rf src",
    "rm -f -- 'src/file with spaces'",
    "rm -rf build",
  ])("accepts literal targets within the Git worktree: %s", (command) => {
    const root = createRepo();
    expect(isRepoLocalRm(command, root)).toBe(true);
  });

  test("resolves relative targets from a nested working directory", () => {
    const root = createRepo();
    const cwd = join(root, "packages", "app");
    mkdirSync(cwd, { recursive: true });
    expect(isRepoLocalRm("rm -rf ../shared", cwd)).toBe(true);
  });

  test.each([
    "rm -rf .",
    "rm -rf ..",
    "rm -rf ../outside",
    "rm -rf \"$HOME/target\"",
    "rm -rf src/*",
    "rm -rf src; echo done",
    "sudo rm -rf src",
    "rm --unknown src",
  ])("keeps root, external, or unresolved targets under review: %s", (command) => {
    const root = createRepo();
    expect(isRepoLocalRm(command, root)).toBe(false);
  });

  test("does not exempt paths that traverse a symlink outside the worktree", () => {
    const root = createRepo();
    const external = mkdtempSync(join(tmpdir(), "repo-local-rm-outside-"));
    roots.push(external);
    mkdirSync(join(external, "parent", "child"), { recursive: true });
    writeFileSync(join(external, "parent", "victim"), "data");
    symlinkSync(join(external, "parent", "child"), join(root, "link"));

    expect(isRepoLocalRm("rm -rf link/victim", root)).toBe(false);
    expect(isRepoLocalRm("rm -rf link/../victim", root)).toBe(false);
  });
});
