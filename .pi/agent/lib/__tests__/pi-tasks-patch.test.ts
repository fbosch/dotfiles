import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const agentRoot = resolve(import.meta.dir, "../..");
const patchPath = resolve(agentRoot, "patches/@tintinweb+pi-tasks+0.9.0.patch");
const installedPackage = resolve(agentRoot, "npm/node_modules/@tintinweb/pi-tasks");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the Pi tasks patch uses host TypeBox and the configured static active glyph", async () => {
  const fixture = mkdtempSync(resolve(tmpdir(), "pi-tasks-patch-"));
  temporaryDirectories.push(fixture);
  const packageDir = resolve(fixture, "node_modules/@tintinweb/pi-tasks");
  mkdirSync(packageDir, { recursive: true });
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

  const pristineManifest = JSON.parse(
    readFileSync(resolve(packageDir, "package.json"), "utf8"),
  ) as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  expect(pristineManifest.peerDependencies?.typebox).toBeUndefined();
  expect(pristineManifest.dependencies?.typebox).toBe("^1.1.34");

  const forward = Bun.spawnSync(["git", "apply", patchPath], { cwd: fixture, stderr: "pipe" });
  expect(forward.exitCode, forward.stderr.toString()).toBe(0);
  const patchedManifest = JSON.parse(readFileSync(resolve(packageDir, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  expect(patchedManifest.peerDependencies?.typebox).toBe("*");
  expect(patchedManifest.dependencies?.typebox).toBeUndefined();

  const { resolveTaskGlyphs } = await import(
    pathToFileURL(resolve(packageDir, "src/task-glyphs.ts")).href
  );
  const taskConfig = JSON.parse(readFileSync(resolve(agentRoot, "tasks-config.json"), "utf8")) as {
    glyphs?: { spinner?: string[] };
  };
  expect(resolveTaskGlyphs(taskConfig.glyphs).spinner).toEqual(["◼"]);
});
