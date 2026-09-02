import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { ProjectReference } from "./types";

const REFERENCE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function resolveReferencePath(cwd: string, configuredPath: string, home: string): string {
  const expandedPath =
    configuredPath === "~"
      ? home
      : configuredPath.startsWith("~/")
        ? join(home, configuredPath.slice(2))
        : configuredPath;
  const absolutePath = isAbsolute(expandedPath) ? expandedPath : resolve(cwd, expandedPath);
  const canonicalPath = realpathSync(absolutePath);

  if (statSync(canonicalPath).isDirectory() === false) {
    throw new Error(`Reference path is not a directory: ${configuredPath}`);
  }
  return canonicalPath;
}

export function loadConfiguredProjectReferences(cwd: string, home: string): ProjectReference[] {
  const settingsPath = join(cwd, ".pi", "settings.json");
  if (existsSync(settingsPath) === false) return [];

  let settings: unknown;
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Cannot load project references from ${settingsPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (isRecord(settings) === false) {
    throw new Error(`Project settings must contain a JSON object: ${settingsPath}`);
  }

  const configuredReferences = settings.references;
  if (configuredReferences === undefined) return [];
  if (isRecord(configuredReferences) === false) {
    throw new Error(`Project references must contain an object: ${settingsPath}`);
  }

  return Object.entries(configuredReferences).map(([name, value]): ProjectReference => {
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
      return { name, path: resolveReferencePath(cwd, path, home), description };
    } catch (error) {
      throw new Error(
        `Cannot resolve project reference "${name}" (${path}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}
