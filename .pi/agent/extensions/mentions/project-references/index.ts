import { homedir } from "node:os";
import {
  type ExtensionAPI,
  type ExtensionContext,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { type AgentMention, loadAgentMentions } from "../agent-mentions";
import { createReferenceAutocompleteProvider } from "./autocomplete";
import { loadConfiguredProjectReferences } from "./configured";
import { loadDocsCacheReferences } from "./docs-cache";
import { appendProjectReferences, formatProjectReferences } from "./formatting";
import { formatAnsiReferenceMentions } from "./reference-mentions";
import { PROJECT_REFERENCES_END, PROJECT_REFERENCES_START, type ProjectReference } from "./types";

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
        `Docs-cache reference "${reference.name}" conflicts with project reference "${configuredName}".`,
      );
    }
  }
}

export function loadProjectReferences(
  cwd: string,
  projectTrusted: boolean,
  home = homedir(),
): ProjectReference[] {
  if (projectTrusted === false) return [];

  const configuredReferences = loadConfiguredProjectReferences(cwd, home);
  const docsCacheReferences = loadDocsCacheReferences(cwd);
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
