import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalProjectRoot, findServerRoot, readProjectFile } from "../paths";

test("finds the nearest server root without walking above the project", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-lsp-paths-"));
  try {
    const nested = join(directory, "packages", "app", "src");
    await mkdir(nested, { recursive: true });
    await writeFile(join(directory, "package.json"), "{}");
    await writeFile(join(directory, "packages", "app", "package.json"), "{}");
    const filePath = join(nested, "index.ts");
    await writeFile(filePath, "export {};");
    const root = await canonicalProjectRoot(directory);

    expect(await findServerRoot(root, filePath, ["package.json"])).toBe(
      join(directory, "packages", "app"),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects symlinks that escape the project", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-lsp-containment-"));
  const outside = await mkdtemp(join(tmpdir(), "pi-lsp-outside-"));
  try {
    await writeFile(join(outside, "escaped.lua"), "return true");
    await symlink(join(outside, "escaped.lua"), join(directory, "escaped.lua"));
    const root = await canonicalProjectRoot(directory);

    await expect(readProjectFile(root, "escaped.lua", "lua")).rejects.toThrow(
      "resolves outside the project root",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
