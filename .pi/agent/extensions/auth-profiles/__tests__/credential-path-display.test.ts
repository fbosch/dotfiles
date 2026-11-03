import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { credentialPathForDisplay } from "../profile-store";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-credential-path-")));
  roots.push(root);
  return root;
}

test("displays a regular credential file at its actual path", () => {
  const path = join(fixture(), "auth.json");
  writeFileSync(path, "{}");
  expect(credentialPathForDisplay(path)).toBe(path);
});

test("follows relative credential symlinks without assuming a store location", () => {
  const root = fixture();
  const stored = join(root, "stored.json");
  const alias = join(root, "work.json");
  writeFileSync(stored, "{}");
  symlinkSync("stored.json", alias);
  expect(credentialPathForDisplay(alias)).toBe(stored);
});

test("displays the configured path before credentials are created", () => {
  const path = join(fixture(), "new-profile.json");
  expect(credentialPathForDisplay(path)).toBe(path);
});

test("reports failed resolution without interrupting profile commands", () => {
  const path = join(fixture(), "loop.json");
  symlinkSync("loop.json", path);
  expect(credentialPathForDisplay(path)).toBe(`${path} (unable to resolve storage path)`);
});
