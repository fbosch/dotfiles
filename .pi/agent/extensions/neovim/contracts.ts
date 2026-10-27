import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

export const MAX_METADATA_STRING_BYTES = 4096;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function canonicalPath(path: string): string | undefined {
  if (/^[A-Za-z][A-Za-z\d+.-]*:/u.test(path)) return undefined;
  let existingPath = resolve(path);
  const missingSegments: string[] = [];

  while (true) {
    try {
      return resolve(realpathSync(existingPath), ...missingSegments);
    } catch {
      try {
        lstatSync(existingPath);
        return undefined;
      } catch (error) {
        if (isRecord(error) === false || error.code !== "ENOENT") return undefined;
      }
      const parent = dirname(existingPath);
      if (parent === existingPath) return undefined;
      missingSegments.unshift(basename(existingPath));
      existingPath = parent;
    }
  }
}

export function worktreesMatch(left: string, right: string): boolean {
  const canonicalLeft = canonicalPath(left);
  return canonicalLeft !== undefined && canonicalLeft === canonicalPath(right);
}

export function pathIsCanonical(path: string): boolean {
  return isAbsolute(path) && canonicalPath(path) === path;
}

export function pathIsInsideWorktree(path: string, cwd: string): boolean {
  if (path === "") return true;
  const absoluteCwd = canonicalPath(cwd);
  if (absoluteCwd === undefined) return false;
  const absolutePath = canonicalPath(isAbsolute(path) ? path : resolve(absoluteCwd, path));
  if (absolutePath === undefined) return false;
  const pathFromCwd = relative(absoluteCwd, absolutePath);
  return (
    pathFromCwd === "" ||
    (pathFromCwd.startsWith("..") === false && isAbsolute(pathFromCwd) === false)
  );
}
