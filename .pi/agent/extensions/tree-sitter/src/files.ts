/**
 * Utility to recursively find project files matching known extensions.
 * Skips common generated, dependency, cache, and VCS directories.
 */
import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadSyntaxRuntime } from "./runtime.js";

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
  ".devenv",
  ".direnv",
  ".docs",
  ".tox",
  "__pycache__",
  "venv",
  ".venv",
  "vendor",
  ".bundle",
  "elm-stuff",
  ".gradle",
  "coverage",
]);

export const DEFAULT_PROJECT_FILE_LIMIT = 2000;

export interface ProjectFileSearch {
  readonly files: string[];
  readonly limit: number;
  readonly truncated: boolean;
}

export interface ProjectFileSearchOptions {
  readonly maxFiles?: number;
  readonly signal?: AbortSignal;
}

/** Find source files with known extensions under `dir`. */
export async function findProjectFiles(
  dir: string,
  options: ProjectFileSearchOptions = {},
): Promise<ProjectFileSearch> {
  const { maxFiles = DEFAULT_PROJECT_FILE_LIMIT, signal } = options;
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1) {
    throw new RangeError("maxFiles must be a positive safe integer");
  }

  signal?.throwIfAborted();
  const {
    languages: { allExtensions },
  } = await loadSyntaxRuntime();
  const exts = new Set(allExtensions());
  const files: string[] = [];

  async function walk(path: string): Promise<void> {
    signal?.throwIfAborted();
    if (files.length > maxFiles) return;

    let entries: Dirent[];
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      signal?.throwIfAborted();
      return;
    }

    signal?.throwIfAborted();
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      signal?.throwIfAborted();
      if (files.length > maxFiles) break;
      const full = join(path, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) await walk(full);
      } else if (entry.isFile()) {
        const ext = entry.name.match(/\.[^.]+$/)?.[0]?.toLowerCase();
        if (ext && exts.has(ext)) files.push(full);
      }
    }
  }

  await walk(dir);
  const truncated = files.length > maxFiles;
  if (truncated) files.length = maxFiles;
  return { files, limit: maxFiles, truncated };
}

/** Read file content, returning null for ordinary filesystem errors. */
export async function readFileSafe(path: string, signal?: AbortSignal): Promise<string | null> {
  try {
    return await import("node:fs/promises").then(({ readFile }) =>
      readFile(path, { encoding: "utf-8", signal }),
    );
  } catch {
    signal?.throwIfAborted();
    return null;
  }
}
