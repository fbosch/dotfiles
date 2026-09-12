import { realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { readLockedJsonFile } from "../../../lib/locked-json-file";
import type { ProjectReference } from "./types";

const REFERENCE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function isMissingPath(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function resolveReferencePath(
  pathBase: string,
  configuredPath: string,
  home: string,
): string | undefined {
  const expandedPath =
    configuredPath === "~"
      ? home
      : configuredPath.startsWith("~/")
        ? join(home, configuredPath.slice(2))
        : configuredPath;
  const absolutePath = isAbsolute(expandedPath) ? expandedPath : resolve(pathBase, expandedPath);

  try {
    const canonicalPath = realpathSync(absolutePath);
    if (statSync(canonicalPath).isDirectory() === false) {
      throw new Error(`Reference path is not a directory: ${configuredPath}`);
    }
    return canonicalPath;
  } catch (error) {
    if (isMissingPath(error)) return undefined;
    throw error;
  }
}

export function loadConfiguredReferences(
  settingsPath: string,
  pathBase: string,
  home: string,
): ProjectReference[] {
  let settings: unknown;
  try {
    settings = readLockedJsonFile(settingsPath);
  } catch (error) {
    throw new Error(
      `Cannot load project references from ${settingsPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (settings === undefined) return [];
  if (isRecord(settings) === false) {
    throw new Error(`Project settings must contain a JSON object: ${settingsPath}`);
  }

  const configuredReferences = settings.references;
  if (configuredReferences === undefined) return [];
  if (isRecord(configuredReferences) === false) {
    throw new Error(`Project references must contain an object: ${settingsPath}`);
  }

  return Object.entries(configuredReferences).flatMap(([name, value]): ProjectReference[] => {
    if (REFERENCE_NAME_PATTERN.test(name) === false) {
      throw new Error(`Invalid project reference name: ${name}`);
    }
    if (isRecord(value) === false) {
      throw new Error(`Project reference "${name}" must contain an object.`);
    }

    const path = typeof value.path === "string" ? value.path.trim() : "";
    const description = typeof value.description === "string" ? value.description.trim() : "";
    if (path.length === 0) {
      throw new Error(`Project reference "${name}" requires a path.`);
    }
    if (description.length === 0) {
      throw new Error(`Project reference "${name}" requires a description.`);
    }

    try {
      const resolvedPath = resolveReferencePath(pathBase, path, home);
      return resolvedPath === undefined ? [] : [{ name, path: resolvedPath, description }];
    } catch (error) {
      throw new Error(
        `Cannot resolve project reference "${name}" (${path}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}

export function loadConfiguredProjectReferences(cwd: string, home: string): ProjectReference[] {
  return loadConfiguredReferences(join(cwd, CONFIG_DIR_NAME, "settings.json"), cwd, home);
}

export function loadConfiguredGlobalReferences(
  agentDirectory: string,
  home: string,
): ProjectReference[] {
  return loadConfiguredReferences(join(agentDirectory, "settings.json"), agentDirectory, home);
}
