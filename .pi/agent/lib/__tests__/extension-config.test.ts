import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cachedJsonConfigReader } from "../extension-config";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const directory = mkdtempSync(join(tmpdir(), "pi-extension-config-"));
  roots.push(directory);
  return directory;
}

function write(path: string, value: unknown, mtimeSeconds: number): void {
  writeFileSync(path, JSON.stringify(value));
  utimesSync(path, mtimeSeconds, mtimeSeconds);
}

test("cached config reader reuses parsed settings until the file changes", () => {
  const path = join(root(), "settings.json");
  write(path, { mode: "shadow" }, 1_000);
  const read = cachedJsonConfigReader(() => path);

  const first = read();
  expect(first).toEqual({ mode: "shadow" });
  expect(read()).toBe(first);

  write(path, { mode: "confirm" }, 2_000);
  expect(read()).toEqual({ mode: "confirm" });
});

test("cached config reader follows edits through a symlinked settings file", () => {
  const directory = root();
  const target = join(directory, "target.json");
  const link = join(directory, "settings.json");
  write(target, { enabled: false }, 1_000);
  symlinkSync(target, link);
  const read = cachedJsonConfigReader(() => link);

  expect(read()).toEqual({ enabled: false });
  write(target, { enabled: true }, 2_000);
  expect(read()).toEqual({ enabled: true });
});

test("cached config reader picks up created files and rejects invalid JSON on every read", () => {
  const path = join(root(), "settings.json");
  const read = cachedJsonConfigReader(() => path);
  expect(read()).toBeUndefined();

  writeFileSync(path, "{");
  expect(read).toThrow("Cannot load extension config");
  expect(read).toThrow("Cannot load extension config");

  write(path, { enabled: true }, 3_000);
  expect(read()).toEqual({ enabled: true });
});
