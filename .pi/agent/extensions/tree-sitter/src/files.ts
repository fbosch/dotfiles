/**
 * Utility to recursively find project files matching known extensions.
 * Skips node_modules, .git, and other common non-project directories.
 */
import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { allExtensions } from "./languages.js";

const IGNORE_DIRS = new Set<string>([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "target",
  "build",
  "dist",
  ".next",
  ".cache",
  "__pycache__",
  "venv",
  ".venv",
  ".tox",
  "vendor",
  ".bundle",
  "elm-stuff",
  ".gradle",
  "coverage",
]);

/** Find all files with known extensions under `dir`, up to `maxFiles`. */
export async function findProjectFiles(dir: string, maxFiles = 2000): Promise<string[]> {
  const exts = allExtensions();
  const results: string[] = [];

  async function walk(path: string): Promise<void> {
    if (results.length >= maxFiles) return;

    let entries: Dirent[];
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      const full = join(path, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          await walk(full);
        }
      } else if (entry.isFile()) {
        const ext = entry.name.match(/\.[^.]+$/)?.[0]?.toLowerCase();
        if (ext && exts.includes(ext)) {
          results.push(full);
        }
      }
    }
  }

  await walk(dir);
  return results;
}

/** Read file content, return null on error. */
export async function readFileSafe(path: string): Promise<string | null> {
  try {
    const { readFile } = await import("node:fs/promises");
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}
