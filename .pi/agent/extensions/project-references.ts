import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";

export const PROJECT_REFERENCES_START = "<available_references>";
export const PROJECT_REFERENCES_END = "</available_references>";

export interface ProjectReference {
  name: string;
  path: string;
  description: string;
}

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

export function loadProjectReferences(
  cwd: string,
  projectTrusted: boolean,
  home = homedir(),
): ProjectReference[] {
  if (projectTrusted === false) return [];

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

  return Object.entries(configuredReferences)
    .map(([name, value]): ProjectReference => {
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
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function formatProjectReferences(references: readonly ProjectReference[]): string {
  const entries = references.map((reference) =>
    [
      "  <reference>",
      `    <name>${escapeXml(reference.name)}</name>`,
      `    <path>${escapeXml(reference.path)}</path>`,
      `    <description>${escapeXml(reference.description)}</description>`,
      "  </reference>",
    ].join("\n"),
  );
  return [
    "Project references provide additional directories that can be accessed when relevant.",
    PROJECT_REFERENCES_START,
    ...entries,
    PROJECT_REFERENCES_END,
  ].join("\n");
}

export function appendProjectReferences(
  systemPrompt: string,
  references: readonly ProjectReference[],
): string {
  if (references.length === 0 || systemPrompt.includes(PROJECT_REFERENCES_START)) {
    return systemPrompt;
  }
  return `${systemPrompt}\n\n${formatProjectReferences(references)}`;
}

export function createReferenceAutocompleteProvider(
  provider: AutocompleteProvider,
  references: readonly ProjectReference[],
): AutocompleteProvider {
  return {
    ...provider,
    triggerCharacters: [...new Set([...(provider.triggerCharacters ?? []), "@"])],
    getSuggestions: async (lines, cursorLine, cursorCol, options) => {
      const suggestions = await provider.getSuggestions(lines, cursorLine, cursorCol, options);
      const textBeforeCursor = lines[cursorLine]?.slice(0, cursorCol) ?? "";
      const prefix = /(?:^|\s)(@[A-Za-z0-9._-]*)$/.exec(textBeforeCursor)?.[1];
      if (prefix === undefined) return suggestions;

      const referenceItems = references
        .filter((reference) =>
          reference.name.toLowerCase().startsWith(prefix.slice(1).toLowerCase()),
        )
        .map(
          (reference): AutocompleteItem => ({
            value: `@${reference.name}`,
            label: `@${reference.name}`,
            description: `Reference · ${reference.description}`,
          }),
        );
      if (referenceItems.length === 0) return suggestions;

      return {
        items: [
          ...referenceItems,
          ...(suggestions?.items.filter(
            (suggestion) =>
              referenceItems.some((reference) => reference.value === suggestion.value) === false,
          ) ?? []),
        ],
        prefix,
      };
    },
  };
}

export default function projectReferences(pi: ExtensionAPI): void {
  let references: ProjectReference[] = [];

  pi.on("session_start", (_event, ctx) => {
    try {
      references = loadProjectReferences(ctx.cwd, ctx.isProjectTrusted());
    } catch (error) {
      references = [];
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      return;
    }

    if (references.length > 0 && ctx.hasUI) {
      ctx.ui.addAutocompleteProvider((provider) =>
        createReferenceAutocompleteProvider(provider, references),
      );
    }
  });

  pi.on("before_agent_start", (event) => ({
    systemPrompt: appendProjectReferences(event.systemPrompt, references),
  }));
}
