import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

/** The subset of nono's runtime grants that decides access. */
export interface AccessGrants {
  fs: ReadonlyArray<{
    path: string;
    access: "read" | "write" | "readwrite";
    is_file: boolean;
    source?: string;
  }>;
  deny_paths: readonly string[];
}

export type AccessKind = "read" | "write";

export type AccessDecision =
  | { kind: "granted"; path: string; grant: AccessGrants["fs"][number] }
  | { kind: "denied"; path: string; denied: string }
  | { kind: "ungranted"; path: string }
  | { kind: "unresolved" };

function within(root: string, candidate: string): boolean {
  const suffix = relative(root, candidate);
  return suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix);
}

/** Resolves symlinks (including dangling ones) before applying "..", then returns an absolute path. */
export function canonicalPath(cwd: string, target: string): string | undefined {
  const absolute = isAbsolute(target) ? target : `${realpathSync(cwd)}${sep}${target}`;
  const walk = (path: string, depth: number): string | undefined => {
    if (depth > 40) return undefined;
    const root = parse(path).root;
    let candidate = root;
    for (const component of path.slice(root.length).split(sep)) {
      if (component === "" || component === ".") continue;
      if (component === "..") {
        candidate = dirname(candidate);
        continue;
      }
      const next = join(candidate, component);
      try {
        if (lstatSync(next).isSymbolicLink()) {
          const link = readlinkSync(next);
          const resolved = walk(isAbsolute(link) ? link : `${candidate}${sep}${link}`, depth + 1);
          if (!resolved) return undefined;
          candidate = resolved;
        } else {
          candidate = next;
        }
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          (error.code !== "ENOENT" && error.code !== "ENOTDIR")
        ) {
          return undefined;
        }
        candidate = next;
      }
    }
    return candidate;
  };
  return walk(absolute, 0);
}

export function explainAccess(
  grants: AccessGrants,
  cwd: string,
  target: string,
  access: AccessKind,
): AccessDecision {
  let path: string | undefined;
  try {
    path = canonicalPath(cwd, target);
  } catch {
    return { kind: "unresolved" };
  }
  if (!path) return { kind: "unresolved" };
  // A parent operation may include denied descendants. Nono's bypass exceptions stay
  // classified as denied rather than reconstructing its platform-specific deny rules.
  const lexical = resolve(cwd, target);
  const denied = grants.deny_paths.find(
    (deny) => within(deny, path) || within(path, deny) || within(deny, lexical),
  );
  if (denied !== undefined) return { kind: "denied", path, denied };
  const grant = grants.fs.find(
    (candidate) =>
      (candidate.access === access || candidate.access === "readwrite") &&
      (candidate.is_file ? path === candidate.path : within(candidate.path, path)),
  );
  return grant ? { kind: "granted", path, grant } : { kind: "ungranted", path };
}
