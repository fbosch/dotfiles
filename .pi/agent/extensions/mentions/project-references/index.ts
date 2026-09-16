import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { type AgentMention, loadAgentMentions } from "../agent-mentions";
import { createReferenceAutocompleteProvider } from "./autocomplete";
import { loadConfiguredGlobalReferences, loadConfiguredProjectReferences } from "./configured";
import { loadDocsCacheReferences } from "./docs-cache";
import { appendProjectReferences, formatProjectReferences } from "./formatting";
import { formatAnsiReferenceMentions } from "./reference-mentions";
import { PROJECT_REFERENCES_END, PROJECT_REFERENCES_START, type ProjectReference } from "./types";

const USER_MESSAGE_RENDER_PATCH = Symbol.for("dotfiles:pi-reference-mention-colors");

interface UserMessageReferenceColors {
  cwd: string;
  references: readonly ProjectReference[];
  foregroundAnsi: string;
  imageForegroundAnsi: string;
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
          activeColors.imageForegroundAnsi,
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

function assertNoReferenceCollisions(
  configuredReferences: readonly ProjectReference[],
  docsCacheReferences: readonly ProjectReference[],
): void {
  const configuredNames = new Map(
    configuredReferences.map((reference) => [reference.name.toLowerCase(), reference.name]),
  );
  for (const reference of docsCacheReferences) {
    const configuredName = configuredNames.get(reference.name.toLowerCase());
    if (configuredName !== undefined) {
      throw new Error(
        `Docs-cache reference "${reference.name}" conflicts with configured reference "${configuredName}".`,
      );
    }
  }
}

function mergeConfiguredReferences(
  globalReferences: readonly ProjectReference[],
  projectReferences: readonly ProjectReference[],
): ProjectReference[] {
  const referencesByName = new Map<string, ProjectReference>();
  for (const reference of [...globalReferences, ...projectReferences]) {
    referencesByName.set(reference.name.toLowerCase(), reference);
  }
  return [...referencesByName.values()];
}

export function loadProjectReferences(
  cwd: string,
  projectTrusted: boolean,
  home = homedir(),
  agentDirectory = getAgentDir(),
): ProjectReference[] {
  const globalReferences = loadConfiguredGlobalReferences(agentDirectory, home);
  const projectReferences = projectTrusted ? loadConfiguredProjectReferences(cwd, home) : [];
  const canonicalCwd = realpathSync(cwd);
  const configuredReferences = mergeConfiguredReferences(
    globalReferences,
    projectReferences,
  ).filter((reference) => reference.path !== canonicalCwd);
  const docsCacheReferences = (projectTrusted ? loadDocsCacheReferences(cwd) : []).filter(
    (reference) => reference.path !== canonicalCwd,
  );
  assertNoReferenceCollisions(configuredReferences, docsCacheReferences);
  return [...configuredReferences, ...docsCacheReferences].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
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

export { formatAnsiReferenceMentions, formatReferenceMentions } from "./reference-mentions";
export type { ProjectReference } from "./types";
export {
  appendProjectReferences,
  createReferenceAutocompleteProvider,
  formatProjectReferences,
  loadConfiguredProjectReferences,
  loadDocsCacheReferences,
  PROJECT_REFERENCES_END,
  PROJECT_REFERENCES_START,
};

export default function projectReferences(pi: ExtensionAPI, agentDirectory = getAgentDir()): void {
  let references: ProjectReference[] = [];
  let activeContext: ExtensionContext | undefined;
  const disposeUserMessageColors = installUserMessageReferenceColors(() => {
    if (activeContext === undefined) return undefined;
    return {
      cwd: activeContext.cwd,
      references,
      foregroundAnsi: activeContext.ui.theme.getFgAnsi("mdLink"),
      imageForegroundAnsi: activeContext.ui.theme.getFgAnsi("accent"),
      restoreAnsi: activeContext.ui.theme.getFgAnsi("userMessageText"),
    };
  });

  pi.on("session_start", (_event, ctx) => {
    activeContext = ctx;
    try {
      references = loadProjectReferences(
        ctx.cwd,
        ctx.isProjectTrusted(),
        undefined,
        agentDirectory,
      );
      assertNoAgentMentionCollisions(
        references,
        loadAgentMentions(ctx.cwd, agentDirectory, ctx.isProjectTrusted()),
      );
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
