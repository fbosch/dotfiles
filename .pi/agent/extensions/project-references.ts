import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import {
  type ExtensionAPI,
  type ExtensionContext,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";
import { formatAnsiReferenceMentions } from "../lib/reference-mentions";
import { type AgentMention, loadAgentMentions } from "./agent-mentions";

export const PROJECT_REFERENCES_START = "<available_references>";
export const PROJECT_REFERENCES_END = "</available_references>";

export interface ProjectReference {
  name: string;
  path: string;
  description: string;
}

const REFERENCE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const USER_MESSAGE_RENDER_PATCH = Symbol.for("dotfiles:pi-reference-mention-colors");

interface UserMessageReferenceColors {
  cwd: string;
  references: readonly ProjectReference[];
  foregroundAnsi: string;
  restoreAnsi: string;
}

type UserMessageRender = (this: UserMessageComponent, width: number) => string[];

interface UserMessageRenderPatchState {
  originalRender: UserMessageRender;
  registrations: Map<symbol, () => UserMessageReferenceColors | undefined>;
}

function installUserMessageReferenceColors(
  getColors: () => UserMessageReferenceColors | undefined,
): () => void {
  const prototype = UserMessageComponent.prototype as UserMessageComponent &
    Record<symbol, unknown>;
  let state = prototype[USER_MESSAGE_RENDER_PATCH] as UserMessageRenderPatchState | undefined;
  if (state === undefined) {
    const originalRender = prototype.render as UserMessageRender;
    state = { originalRender, registrations: new Map() };
    const patchState = state;
    prototype[USER_MESSAGE_RENDER_PATCH] = state;
    prototype.render = function renderWithReferenceColors(width: number): string[] {
      const lines = originalRender.call(this, width);
      const activeColors = [...patchState.registrations.values()]
        .reverse()
        .map((getRegistrationColors) => getRegistrationColors())
        .find((colors) => colors !== undefined);
      if (activeColors === undefined) return lines;

      return lines.map((line) =>
        formatAnsiReferenceMentions(
          line,
          activeColors.references,
          activeColors.cwd,
          activeColors.foregroundAnsi,
          activeColors.restoreAnsi,
        ),
      );
    };
  }

  const patchState = state;
  const owner = Symbol("project-references");
  patchState.registrations.set(owner, getColors);
  return () => {
    patchState.registrations.delete(owner);
    if (patchState.registrations.size > 0) return;
    prototype.render = patchState.originalRender;
    delete prototype[USER_MESSAGE_RENDER_PATCH];
  };
}

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

export function assertNoAgentMentionCollisions(
  references: readonly ProjectReference[],
  agentMentions: readonly AgentMention[],
): void {
  const agentsByName = new Map(
    agentMentions.map((mention) => [mention.name.toLowerCase(), mention.name]),
  );
  for (const reference of references) {
    const agentName = agentsByName.get(reference.name.toLowerCase());
    if (agentName !== undefined) {
      throw new Error(
        `Project reference "${reference.name}" conflicts with agent mention @${agentName}.`,
      );
    }
  }
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
  const referenceProvider: AutocompleteProvider = {
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

      const existingItems = suggestions?.items ?? [];
      const existingValues = new Set(existingItems.map((item) => item.value));

      return {
        items: [
          ...referenceItems.filter((reference) => existingValues.has(reference.value) === false),
          ...existingItems,
        ],
        prefix,
      };
    },
    applyCompletion: (lines, cursorLine, cursorCol, item, prefix) =>
      provider.applyCompletion(lines, cursorLine, cursorCol, item, prefix),
  };
  referenceProvider.triggerCharacters = [...new Set([...(provider.triggerCharacters ?? []), "@"])];
  if (provider.shouldTriggerFileCompletion !== undefined) {
    referenceProvider.shouldTriggerFileCompletion = (lines, cursorLine, cursorCol) =>
      provider.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? false;
  }
  return referenceProvider;
}

export default function projectReferences(pi: ExtensionAPI): void {
  let references: ProjectReference[] = [];
  let activeContext: ExtensionContext | undefined;
  const disposeUserMessageColors = installUserMessageReferenceColors(() => {
    if (activeContext === undefined) return undefined;
    return {
      cwd: activeContext.cwd,
      references,
      foregroundAnsi: activeContext.ui.theme.getFgAnsi("warning"),
      restoreAnsi: activeContext.ui.theme.getFgAnsi("userMessageText"),
    };
  });

  pi.on("session_start", (_event, ctx) => {
    activeContext = ctx;
    try {
      references = loadProjectReferences(ctx.cwd, ctx.isProjectTrusted());
      assertNoAgentMentionCollisions(references, loadAgentMentions(ctx.cwd));
    } catch (error) {
      references = [];
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      return;
    }
  });
  pi.on("session_shutdown", () => {
    activeContext = undefined;
    disposeUserMessageColors();
  });

  pi.on("before_agent_start", (event) => ({
    systemPrompt: appendProjectReferences(event.systemPrompt, references),
  }));
}
