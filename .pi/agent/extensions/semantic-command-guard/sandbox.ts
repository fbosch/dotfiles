import { lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { isRecord } from "../shared/is-record";
import { commandFileAccesses } from "./file-access";

interface FilesystemGrant {
  path: string;
  access: "read" | "write" | "readwrite";
  is_file: boolean;
}

export interface NonoCapabilities {
  fs: FilesystemGrant[];
  deny_paths: string[];
}

export function readNonoCapabilities(
  capFile = process.env.NONO_CAP_FILE,
): NonoCapabilities | undefined {
  if (!capFile || !isAbsolute(capFile)) return undefined;
  try {
    const value: unknown = JSON.parse(readFileSync(capFile, "utf8"));
    // Runtime metadata is a launcher signal, not proof of kernel enforcement.
    if (
      !isRecord(value) ||
      typeof value.net_blocked !== "boolean" ||
      !Array.isArray(value.fs) ||
      !Array.isArray(value.deny_paths) ||
      !value.deny_paths.every((path: unknown) => typeof path === "string" && isAbsolute(path))
    )
      return undefined;
    const fs: FilesystemGrant[] = [];
    for (const grant of value.fs) {
      if (
        !isRecord(grant) ||
        typeof grant.path !== "string" ||
        !isAbsolute(grant.path) ||
        typeof grant.is_file !== "boolean"
      )
        return undefined;
      const access = grant.access;
      if (access !== "read" && access !== "write" && access !== "readwrite") return undefined;
      fs.push({ path: grant.path, access, is_file: grant.is_file });
    }
    return { fs, deny_paths: value.deny_paths };
  } catch {
    return undefined;
  }
}

function within(root: string, candidate: string): boolean {
  const suffix = relative(root, candidate);
  return suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix);
}

function canonicalPath(cwd: string, target: string): string | undefined {
  const absolute = isAbsolute(target) ? target : `${realpathSync(cwd)}${sep}${target}`;
  const walk = (path: string, depth: number): string | undefined => {
    if (depth > 40) return undefined;
    const root = parse(path).root;
    let candidate = root;
    // Resolve links, including dangling ones, before applying "..".
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
        )
          return undefined;
        candidate = next;
      }
    }
    return candidate;
  };
  return walk(absolute, 0);
}

export function commandFitsSandbox(
  command: string,
  cwd: string,
  capabilities: NonoCapabilities | undefined,
): boolean {
  if (!capabilities) return false;
  const accesses = commandFileAccesses(command);
  if (!accesses) return false;
  try {
    const granted = (path: string, access: "read" | "write"): string | undefined => {
      const candidate = canonicalPath(cwd, path);
      if (!candidate) return undefined;
      // Parent operations may include denied descendants. Bypass exceptions stay
      // under review instead of reconstructing nono's platform-specific deny rules.
      if (
        capabilities.deny_paths.some(
          (denied) =>
            within(denied, candidate) ||
            within(candidate, denied) ||
            within(denied, resolve(cwd, path)),
        )
      )
        return undefined;
      return capabilities.fs.some(
        (grant) =>
          (grant.access === access || grant.access === "readwrite") &&
          (grant.is_file ? candidate === grant.path : within(grant.path, candidate)),
      )
        ? candidate
        : undefined;
    };
    return accesses.every(({ path, access, destinationNames }) => {
      const candidate = granted(path, access);
      if (!candidate) return false;
      if (!destinationNames) return true;
      try {
        if (!lstatSync(candidate).isDirectory()) return true;
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return true;
        return false;
      }
      // Copying into a directory can follow a symlink at destination/source-name.
      return destinationNames.every(
        (name) => granted(join(candidate, name), "write") !== undefined,
      );
    });
  } catch {
    return false;
  }
}
