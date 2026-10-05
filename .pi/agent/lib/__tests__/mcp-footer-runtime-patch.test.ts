import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const agentRoot = resolve(import.meta.dir, "../..");
const packageRoot = resolve(agentRoot, "node_modules/@earendil-works/pi-coding-agent");
const packageFile = resolve(packageRoot, "dist/extensions/mcp/index.js");
const packageManifest = resolve(packageRoot, "package.json");
const patchPath = resolve(agentRoot, "runtime-patches/pi-coding-agent-0.99.1-mcp-footer.patch");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the pinned Pi MCP patch moves connection health into footer status", () => {
  const manifest = JSON.parse(readFileSync(packageManifest, "utf8")) as { version: string };
  expect(manifest.version).toBe("0.99.1");

  const fixture = mkdtempSync(resolve(tmpdir(), "pi-mcp-footer-patch-"));
  temporaryDirectories.push(fixture);
  const fixtureFile = resolve(
    fixture,
    "node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/index.js",
  );
  mkdirSync(dirname(fixtureFile), { recursive: true });
  cpSync(packageFile, fixtureFile);
  const installedSource = readFileSync(fixtureFile, "utf8");
  if (installedSource.includes('ctx.ui.setStatus("mcp", status);')) {
    const restore = Bun.spawnSync(["git", "apply", "--reverse", "-p1", patchPath], {
      cwd: fixture,
      stderr: "pipe",
    });
    expect(restore.exitCode, restore.stderr.toString()).toBe(0);
  }
  const pristineSource = readFileSync(fixtureFile, "utf8");

  const apply = Bun.spawnSync(["git", "apply", "-p1", patchPath], {
    cwd: fixture,
    stderr: "pipe",
  });
  expect(apply.exitCode, apply.stderr.toString()).toBe(0);

  const patchedSource = readFileSync(fixtureFile, "utf8");
  expect(patchedSource).toContain('ctx.ui.setStatus("mcp", status);');
  expect(patchedSource).toMatch(
    /MCP \$\{connectedCount\}\/\$\{enabled\.length\}\$\{hasFailure \? "!" : ""\}/,
  );
  expect(patchedSource).not.toContain("MCP servers need attention:");

  const reverse = Bun.spawnSync(["git", "apply", "--reverse", "-p1", patchPath], {
    cwd: fixture,
    stderr: "pipe",
  });
  expect(reverse.exitCode, reverse.stderr.toString()).toBe(0);
  expect(readFileSync(fixtureFile, "utf8")).toBe(pristineSource);
});
