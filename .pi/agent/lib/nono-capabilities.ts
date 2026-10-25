import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

export interface NonoFilesystemGrant {
  path: string;
  access: "read" | "write" | "readwrite";
  is_file: boolean;
  source: string;
}

export interface NonoBypass {
  path: string;
  is_file: boolean;
  removed_denies: string[];
}

export interface NonoCapabilities {
  fs: NonoFilesystemGrant[];
  deny_paths: string[];
  applied_bypasses: NonoBypass[];
  allowed_commands: string[];
  blocked_commands: string[];
  allowed_domains: string[];
  net_blocked: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : undefined;
}

function absolutePaths(value: unknown): string[] | undefined {
  const paths = strings(value);
  return paths?.every((path) => isAbsolute(path)) ? paths : undefined;
}

/** Path of the capability file nono exports to the sandboxed process, when launched under nono. */
export function nonoCapabilityFile(
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return environment.NONO_CAP_FILE || undefined;
}

function parseGrant(grant: unknown): NonoFilesystemGrant | undefined {
  if (
    !isRecord(grant) ||
    typeof grant.path !== "string" ||
    !isAbsolute(grant.path) ||
    typeof grant.is_file !== "boolean" ||
    typeof grant.source !== "string"
  ) {
    return undefined;
  }
  const access = grant.access;
  if (access !== "read" && access !== "write" && access !== "readwrite") return undefined;
  return { path: grant.path, access, is_file: grant.is_file, source: grant.source };
}

function parseBypass(bypass: unknown): NonoBypass | undefined {
  if (
    !isRecord(bypass) ||
    typeof bypass.path !== "string" ||
    !isAbsolute(bypass.path) ||
    typeof bypass.is_file !== "boolean"
  ) {
    return undefined;
  }
  const removedDenies = absolutePaths(bypass.removed_denies);
  if (!removedDenies) return undefined;
  return { path: bypass.path, is_file: bypass.is_file, removed_denies: removedDenies };
}

function parseAll<T>(values: unknown, parse: (value: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const parsed = values.map(parse);
  return parsed.every((item) => item !== undefined) ? (parsed as T[]) : undefined;
}

function parseCapabilities(value: unknown): NonoCapabilities | undefined {
  if (!isRecord(value) || typeof value.net_blocked !== "boolean") return undefined;
  const fs = parseAll(value.fs, parseGrant);
  const appliedBypasses = parseAll(value.applied_bypasses, parseBypass);
  const denyPaths = absolutePaths(value.deny_paths);
  const allowedCommands = strings(value.allowed_commands);
  const blockedCommands = strings(value.blocked_commands);
  const allowedDomains = strings(value.allowed_domains);
  if (
    !fs ||
    !appliedBypasses ||
    !denyPaths ||
    !allowedCommands ||
    !blockedCommands ||
    !allowedDomains
  ) {
    return undefined;
  }
  return {
    fs,
    deny_paths: denyPaths,
    applied_bypasses: appliedBypasses,
    allowed_commands: allowedCommands,
    blocked_commands: blockedCommands,
    allowed_domains: allowedDomains,
    net_blocked: value.net_blocked,
  };
}

// Capability metadata is a launcher signal, not independently verified kernel confinement.
// Parsing is strict: any unexpected shape yields undefined so callers fall back to review.
export function readNonoCapabilities(
  capFile: string | undefined = nonoCapabilityFile(),
): NonoCapabilities | undefined {
  if (!capFile || !isAbsolute(capFile)) return undefined;
  try {
    return parseCapabilities(JSON.parse(readFileSync(capFile, "utf8")));
  } catch {
    return undefined;
  }
}
