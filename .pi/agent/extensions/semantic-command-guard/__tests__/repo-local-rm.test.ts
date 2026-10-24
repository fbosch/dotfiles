import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  test.each(["rm -rf src", "rm -f -- 'src/file with spaces'", "rm -rf build"])(
    "accepts literal targets within the Git worktree: %s",
    (command) => {
      const root = createRepo();
      expect(isRepoLocalRm(command, root)).toBe(true);
    },
  );

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
    'rm -rf "$HOME/target"',
    "rm -rf src/*",
    "rm -rf src; echo done",
    "sudo rm -rf src",
    "rm --unknown src",
  ])("keeps root, external, or unresolved targets under review: %s", (command) => {
    const root = createRepo();
    expect(isRepoLocalRm(command, root)).toBe(false);
  });

  test.each([
    "rm -rf link/victim",
    "rm -rf link/../victim",
    "rm -rf link/../missing/victim",
    "rm -rf link/./../victim",
    "rm -rf safe link/../victim",
  ])("keeps escaping symlink targets under review: %s", (command) => {
    const root = createRepo();
    const external = mkdtempSync(join(tmpdir(), "repo-local-rm-outside-"));
    roots.push(external);
    mkdirSync(join(external, "parent", "child"), { recursive: true });
    writeFileSync(join(external, "parent", "victim"), "data");
    symlinkSync(join(external, "parent", "child"), join(root, "link"));

    expect(isRepoLocalRm(command, root)).toBe(false);
  });

  test("keeps absolute escaping symlink targets under review", () => {
    const root = createRepo();
    const external = mkdtempSync(join(tmpdir(), "repo-local-rm-outside-"));
    roots.push(external);
    mkdirSync(join(external, "parent", "child"), { recursive: true });
    writeFileSync(join(external, "parent", "victim"), "data");
    symlinkSync(join(external, "parent", "child"), join(root, "link"));

    expect(isRepoLocalRm(`rm -rf ${realpathSync(root)}/link/../victim`, root)).toBe(false);
  });

  test("protects the repository root reached through a directory symlink", () => {
    const root = createRepo();
    mkdirSync(join(root, "parent"));
    mkdirSync(join(root, "target"));
    symlinkSync(join(root, "target"), join(root, "parent", "link"));

    expect(isRepoLocalRm("rm -rf parent/link/..", root)).toBe(false);
  });

  test("accepts repo-local parents reached through a directory symlink", () => {
    const root = createRepo();
    mkdirSync(join(root, "real", "child"), { recursive: true });
    writeFileSync(join(root, "real", "victim"), "data");
    symlinkSync(join(root, "real", "child"), join(root, "link"));

    expect(isRepoLocalRm("rm -rf link/../victim", root)).toBe(true);
    expect(isRepoLocalRm(`rm -rf ${realpathSync(root)}/link/../victim`, root)).toBe(true);
  });

  test("resolves parent traversal inside a symlink destination before granting an exemption", () => {
    const root = createRepo();
    const external = mkdtempSync(join(tmpdir(), "repo-local-rm-outside-"));
    roots.push(external);
    mkdirSync(join(external, "parent", "child"), { recursive: true });
    writeFileSync(join(external, "parent", "victim"), "outside");
    writeFileSync(join(root, "victim"), "inside");
    symlinkSync(join(external, "parent", "child"), join(root, "inner"));
    symlinkSync("inner/..", join(root, "link"));

    expect(isRepoLocalRm("rm -rf link/victim", root)).toBe(false);
  });

  test("keeps unresolved symlink loops under review", () => {
    const root = createRepo();
    symlinkSync("loop", join(root, "loop"));

    expect(isRepoLocalRm("rm -rf loop/../victim", root)).toBe(false);
  });
});
