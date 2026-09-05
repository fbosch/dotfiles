import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ProjectReference } from "./types";

const DOCS_CACHE_INVALID_NAME_PATTERN = /[<>:"/\\|?*]/;
const DOCS_CACHE_TRAILING_DOT_SPACE_PATTERN = /[.\s]+$/u;
const DOCS_CACHE_RESERVED_NAMES = new Set([".", "..", "CON", "PRN", "AUX", "NUL", "COM1", "LPT1"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function repositoryLabel(repo: string): string {
  const sshMatch = repo.match(/^[^@]+@[^:]+:(.+)$/);
  const value = sshMatch?.[1] ?? repo.replace(/^https?:\/\/[^/]+\//, "");
  return value.replace(/\.git$/i, "").replace(/^\/+/, "");
}

function isDocsCacheReferenceName(name: string): boolean {
  if (
    name.length === 0 ||
    name.length > 200 ||
    name.trim().length === 0 ||
    DOCS_CACHE_TRAILING_DOT_SPACE_PATTERN.test(name) ||
    DOCS_CACHE_INVALID_NAME_PATTERN.test(name) ||
    DOCS_CACHE_RESERVED_NAMES.has(name.toUpperCase())
  ) {
    return false;
  }

  return [...name].every((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && codePoint > 0x1f && codePoint !== 0x7f;
  });
}

export function loadDocsCacheReferences(cwd: string): ProjectReference[] {
  const lockPath = join(cwd, "docs-lock.json");
  if (existsSync(lockPath) === false) return [];

  let lock: unknown;
  try {
    lock = JSON.parse(readFileSync(lockPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Cannot load docs-cache references from ${lockPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (isRecord(lock) === false || lock.version !== 1 || isRecord(lock.sources) === false) {
    throw new Error(`Invalid docs-cache lock file: ${lockPath}`);
  }

  return Object.entries(lock.sources).map(([name, value]): ProjectReference => {
    if (isDocsCacheReferenceName(name) === false) {
      throw new Error(`Invalid docs-cache reference name: ${name}`);
    }
    if (isRecord(value) === false || typeof value.repo !== "string" || value.repo.trim() === "") {
      throw new Error(`Docs-cache source "${name}" requires a repository.`);
    }

    // The lock format omits cacheDir, so lock-only discovery follows docs-cache's default layout.
    const cachePath = resolve(cwd, ".docs", name);
    const path = existsSync(cachePath) ? realpathSync(cachePath) : cachePath;
    const description = `Use for documentation from ${repositoryLabel(value.repo.trim())}.${
      existsSync(join(path, "TOC.md")) ? " Start with TOC.md." : ""
    }`;
    return { name, path, description };
  });
}
