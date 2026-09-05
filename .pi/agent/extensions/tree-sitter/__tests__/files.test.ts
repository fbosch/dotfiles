import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { findProjectFiles, readFileSafe } from "../src/files";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function temporaryProject(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "pi-tree-sitter-files-"));
  temporaryDirectories.push(path);
  return path;
}

test("includes hidden source directories while skipping generated hidden directories", async () => {
  const root = await temporaryProject();
  await mkdir(join(root, ".config"));
  await mkdir(join(root, ".git"));
  await writeFile(join(root, "root.ts"), "export const root = true;\n");
  await writeFile(join(root, ".config", "source.ts"), "export const hidden = true;\n");
  await writeFile(join(root, ".git", "ignored.ts"), "export const ignored = true;\n");

  const result = await findProjectFiles(root);
  expect(result.truncated).toBeFalse();
  expect(result.files.map((path) => relative(root, path)).sort()).toEqual([
    ".config/source.ts",
    "root.ts",
  ]);
});

test("reports file-limit truncation", async () => {
  const root = await temporaryProject();
  await Promise.all([
    writeFile(join(root, "one.ts"), "export const one = 1;\n"),
    writeFile(join(root, "two.ts"), "export const two = 2;\n"),
  ]);

  const result = await findProjectFiles(root, { maxFiles: 1 });
  expect(result).toMatchObject({ limit: 1, truncated: true });
  expect(result.files).toHaveLength(1);
});

test("filesystem helpers honor cancellation", async () => {
  const root = await temporaryProject();
  const signal = AbortSignal.abort();

  expect(findProjectFiles(root, { signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(readFileSafe(join(root, "source.ts"), signal)).rejects.toMatchObject({
    name: "AbortError",
  });
});
