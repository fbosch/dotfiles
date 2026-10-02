import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const agentRoot = resolve(import.meta.dir, "../..");
const installedPackage = resolve(agentRoot, "npm/node_modules/@tintinweb/pi-tasks");

test("pi-tasks uses the configured static active glyph", async () => {
  const { resolveTaskGlyphs } = await import(
    pathToFileURL(resolve(installedPackage, "src/task-glyphs.ts")).href
  );
  const taskConfig = JSON.parse(readFileSync(resolve(agentRoot, "tasks-config.json"), "utf8")) as {
    glyphs?: { spinner?: string[] };
  };

  expect(resolveTaskGlyphs(taskConfig.glyphs).spinner).toEqual(["◼"]);
});

test("pi-tasks uses Pi's host-provided typebox", () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(installedPackage, "package.json"), "utf8"),
  ) as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };

  expect(packageJson.dependencies?.typebox).toBeUndefined();
  expect(packageJson.peerDependencies?.typebox).toBe("*");
});
