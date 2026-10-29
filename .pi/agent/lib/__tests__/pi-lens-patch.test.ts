import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";

const agentRoot = resolve(import.meta.dir, "../..");
const patchPath = resolve(agentRoot, "patches/pi-lens+4.3.0.patch");
const installedBundle = resolve(agentRoot, "npm/node_modules/pi-lens/dist/index.js");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("pi-lens refreshes hashline anchors after immediate formatting", () => {
  const patch = readFileSync(patchPath, "utf8");

  expect(patch).toContain('tool.name === "read"');
  expect(patch).toContain('tool.sourceInfo?.path?.includes("pi-hashline-edit-pro")');
  expect(patch).toContain('readTool.execute("pi-lens-format-hashline-refresh"');
  expect(patch).toContain("+    formatChanged,");
  expect(patch).toContain("result.formatChanged && deps.hashlineRefresh");
  expect(patch).toContain("observedDispatchOutcome?.result?.formatChanged && deps.hashlineRefresh");
  expect(patch).toContain('!getFlag("immediate-format")');
  expect(patch).toContain("deps.shouldDeferFormat?.() ?? true");
  expect(patch).toContain("shouldDeferFormat()");
  expect(patch).toContain("formatResult.fileContent !== beforeFormatContent");
  expect(patch).toContain("--- Post-format hashline anchors ---");
  expect(patch).toContain("Re-read the file before editing");
});

test("pi-lens locates its packaged grammars from the bundled runtime", () => {
  const bundle = readFileSync(installedBundle, "utf8");
  const start = bundle.indexOf("      bundledGrammarsDir() {");
  const end = bundle.indexOf("      _vendoredGrammarsDir;", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const grammarDirectory = resolve(agentRoot, "npm/node_modules/pi-lens/grammars");
  const client = runInNewContext(
    `({ ${bundle.slice(start, end).replace("import.meta.url", JSON.stringify(installedBundle))} })`,
    {
      resolvePackagePath: (_module: string, asset: string) => {
        expect(asset).toBe("grammars");
        return grammarDirectory;
      },
      fs72: { existsSync: (path: string) => path === grammarDirectory },
    },
  );
  expect(client.bundledGrammarsDir()).toBe(grammarDirectory);
  expect(client.bundledGrammarsDir()).toBe(grammarDirectory);
});

test("the tracked patch round-trips against the installed pi-lens bundle", () => {
  const fixture = mkdtempSync(resolve(tmpdir(), "pi-lens-patch-"));
  temporaryDirectories.push(fixture);
  const fixtureBundle = resolve(fixture, "node_modules/pi-lens/dist/index.js");
  mkdirSync(dirname(fixtureBundle), { recursive: true });
  cpSync(installedBundle, fixtureBundle);

  const reverse = Bun.spawnSync(["git", "apply", "--reverse", patchPath], {
    cwd: fixture,
    stderr: "pipe",
  });
  expect(reverse.exitCode, reverse.stderr.toString()).toBe(0);
  expect(readFileSync(fixtureBundle, "utf8")).not.toContain("pi-lens-format-hashline-refresh");

  const forward = Bun.spawnSync(["git", "apply", patchPath], { cwd: fixture, stderr: "pipe" });
  expect(forward.exitCode, forward.stderr.toString()).toBe(0);
  expect(readFileSync(fixtureBundle, "utf8")).toContain("pi-lens-format-hashline-refresh");
});
