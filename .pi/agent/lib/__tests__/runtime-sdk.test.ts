import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findRuntimeExecutable,
  inspectRuntimeSdk,
  resolveRuntimeSdk,
  runtimeSdkConfig,
  syncRuntimeSdk,
} from "../runtime-sdk";

const directories: string[] = [];
function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), "pi-sdk-"));
  directories.push(directory);
  return directory;
}
function packageFixture(root: string, version = "1.4.0"): string {
  const directory = join(root, "lib/pi/node_modules/@earendil-works/pi-coding-agent");
  mkdirSync(join(directory, "dist"), { recursive: true });
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({
      name: "@earendil-works/pi-coding-agent",
      version,
    }),
  );
  writeFileSync(join(directory, "dist/index.d.ts"), "export {};");
  writeFileSync(join(directory, "dist/index.js"), "export {};");
  return directory;
}
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

test("resolves the SDK belonging to a symlinked installation binary", () => {
  const root = workspace();
  const directory = packageFixture(root);
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin/pi"), "");
  const link = join(workspace(), "pi");
  symlinkSync(join(root, "bin/pi"), link);
  expect(resolveRuntimeSdk(link)).toEqual({ directory: realpathSync(directory), version: "1.4.0" });
});

test("refuses an unresolved wrapper instead of using local development dependencies", () => {
  const binary = join(workspace(), "pi");
  writeFileSync(binary, "");
  expect(() => resolveRuntimeSdk(binary)).toThrow("Expected one Pi SDK");
});

test("rejects malformed manifests and packages without installed declarations", () => {
  const directory = packageFixture(workspace());
  writeFileSync(join(directory, "package.json"), "{");
  expect(() => inspectRuntimeSdk(directory)).toThrow("Cannot read Pi SDK manifest");
  writeFileSync(join(directory, "package.json"), '{"name":"another-package","version":"1.4.0"}');
  expect(() => inspectRuntimeSdk(directory)).toThrow("Not an installed Pi SDK");
  writeFileSync(
    join(directory, "package.json"),
    '{"name":"@earendil-works/pi-coding-agent","version":"1.4.0"}',
  );
  rmSync(join(directory, "dist/index.d.ts"));
  expect(() => inspectRuntimeSdk(directory)).toThrow("Not an installed Pi SDK");
});

test("maps the installed SDK family and detects stale editor configuration", () => {
  const root = workspace();
  const directory = packageFixture(root);
  const sibling = join(directory, "../pi-ai");
  mkdirSync(sibling);
  writeFileSync(join(sibling, "package.json"), '{"name":"@earendil-works/pi-ai"}');
  const sdk = inspectRuntimeSdk(directory);
  expect(runtimeSdkConfig(sdk).compilerOptions.paths["@earendil-works/pi-ai"]).toEqual([
    realpathSync(sibling),
  ]);
  const agent = workspace();
  expect(() => syncRuntimeSdk(agent, sdk, true)).toThrow("declarations are stale");
  syncRuntimeSdk(agent, sdk);
  expect(() => syncRuntimeSdk(agent, sdk, true)).not.toThrow();
  const upgraded = inspectRuntimeSdk(packageFixture(workspace(), "1.5.0"));
  expect(() => syncRuntimeSdk(agent, upgraded, true)).toThrow("declarations are stale");
});

test("the sync CLI rejects unknown arguments", () => {
  const result = Bun.spawnSync(
    [process.execPath, join(import.meta.dir, "../runtime-sdk.ts"), "--typo"],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain("Usage:");
});

test("ignores bun run's development CLI when selecting the runtime", () => {
  const root = workspace();
  const shadow = join(root, "node_modules/.bin");
  const runtime = join(root, "bin");
  mkdirSync(shadow, { recursive: true });
  mkdirSync(runtime);
  writeFileSync(join(shadow, "pi"), "", { mode: 0o755 });
  writeFileSync(join(runtime, "pi"), "", { mode: 0o755 });
  expect(findRuntimeExecutable(`${shadow}:${runtime}`)).toBe(join(runtime, "pi"));
});
