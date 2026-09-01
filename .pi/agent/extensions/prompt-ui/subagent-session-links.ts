import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { hyperlink, stripTerminalSequences, Text, type TUI } from "@earendil-works/pi-tui";

export const SUBAGENT_SESSIONS_URL = "pi-action://subagents/sessions";

const TOOL_RENDER_PATCH = Symbol.for("dotfiles:pi-subagent-session-tool-links");
const TUI_URL_PATCH = Symbol.for("dotfiles:pi-subagent-session-url-handler");
const OSC8_OPEN = "\u001b]8;";
const TOOL_CALL_PREFIX = "› ";

interface ToolRenderPatchState {
  agentNames: Set<string>;
  originalRender: (this: Text, width: number) => string[];
}

interface TuiUrlPatchState {
  openSessions: () => void;
  originalOpenUrl?: (url: string) => void;
}

type PatchableTextPrototype = typeof Text.prototype & Record<symbol, unknown>;
type PatchableTui = TUI &
  Record<symbol, unknown> & {
    openUrl?: (url: string) => void;
  };

function normalizedAgentNames(agentNames: readonly string[]): Set<string> {
  return new Set(agentNames.map((name) => name.toLowerCase()));
}

export function isSubagentToolTitle(line: string, agentNames: ReadonlySet<string>): boolean {
  const title = stripTerminalSequences(line).trimStart();
  if (title.startsWith(TOOL_CALL_PREFIX) === false) return false;

  const label = title.slice(TOOL_CALL_PREFIX.length).split("  ", 1)[0]?.trim().toLowerCase();
  return label !== undefined && agentNames.has(label);
}

export function linkSubagentToolBlock(
  lines: readonly string[],
  agentNames: ReadonlySet<string>,
): string[] {
  if (lines.some((line) => isSubagentToolTitle(line, agentNames)) === false) return [...lines];

  return lines.map((line) =>
    line.includes(OSC8_OPEN) ? line : hyperlink(line, SUBAGENT_SESSIONS_URL),
  );
}

export function installSubagentToolTitleLinks(agentNames: readonly string[]): void {
  const prototype = Text.prototype as PatchableTextPrototype;
  const existing = prototype[TOOL_RENDER_PATCH] as ToolRenderPatchState | undefined;
  if (existing !== undefined) {
    existing.agentNames = normalizedAgentNames(agentNames);
    return;
  }

  const state: ToolRenderPatchState = {
    agentNames: normalizedAgentNames(agentNames),
    originalRender: prototype.render,
  };
  prototype[TOOL_RENDER_PATCH] = state;
  prototype.render = function renderClickableSubagentTitle(width: number): string[] {
    return linkSubagentToolBlock(state.originalRender.call(this, width), state.agentNames);
  };
}

export function installSubagentSessionsUrlHandler(tui: TUI, openSessions: () => void): void {
  if (tui.mode !== "fullscreen") return;

  const patchableTui = tui as PatchableTui;
  const existing = patchableTui[TUI_URL_PATCH] as TuiUrlPatchState | undefined;
  if (existing !== undefined) {
    existing.openSessions = openSessions;
    return;
  }

  const state: TuiUrlPatchState = {
    openSessions,
    ...(patchableTui.openUrl === undefined
      ? {}
      : { originalOpenUrl: patchableTui.openUrl.bind(tui) }),
  };
  patchableTui[TUI_URL_PATCH] = state;
  patchableTui.openUrl = (url) => {
    if (url === SUBAGENT_SESSIONS_URL) {
      state.openSessions();
      return;
    }

    state.originalOpenUrl?.(url);
  };
}

export function installClickableSubagentSessions(
  tui: TUI,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  agentNames: readonly string[],
): void {
  installSubagentToolTitleLinks(agentNames);
  installSubagentSessionsUrlHandler(tui, () => {
    try {
      pi.sendUserMessage("/subagents:sessions", { expandPromptTemplates: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Could not open subagent sessions: ${message}`, "error");
    }
  });
}
