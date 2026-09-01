import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { hyperlink, stripTerminalSequences, Text, type TUI } from "@earendil-works/pi-tui";

export const SUBAGENT_SESSIONS_URL = "pi-action://subagents/sessions";

const TOOL_RENDER_PATCH = Symbol.for("dotfiles:pi-subagent-session-tool-links");
const TUI_URL_PATCH = Symbol.for("dotfiles:pi-subagent-session-url-handler");
const OSC8_OPEN = "\u001b]8;";
const TOOL_CALL_PREFIX = "› ";

interface ToolRenderPatchState {
  agentNames: Set<string>;
  linkLines: typeof linkSubagentToolBlock;
  originalRender: (this: Text, width: number) => string[];
  patchedRender: (this: Text, width: number) => string[];
  references: number;
}

interface TuiUrlPatchState {
  openSessions: () => void;
  originalOpenUrl?: (url: string) => void;
  patchedOpenUrl: (url: string) => void;
  references: number;
}

type PatchableTextPrototype = typeof Text.prototype & Record<symbol, unknown>;
type PatchableTui = TUI &
  Record<symbol, unknown> & {
    openUrl?: (url: string) => void;
  };

function normalizedAgentNames(agentNames: readonly string[]): Set<string> {
  return new Set(agentNames.map((name) => name.toLowerCase()));
}

function once(dispose: () => void): () => void {
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    dispose();
  };
}

export function isSubagentToolTitle(line: string, agentNames: ReadonlySet<string>): boolean {
  const title = stripTerminalSequences(line);
  if (title.startsWith(TOOL_CALL_PREFIX) === false) return false;

  const label = title.slice(TOOL_CALL_PREFIX.length).split("  ", 1)[0]?.trim().toLowerCase();
  return label !== undefined && agentNames.has(label);
}

export function isSubagentToolTitleSource(text: string, agentNames: ReadonlySet<string>): boolean {
  return text.includes("\n") === false && isSubagentToolTitle(text, agentNames);
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

export function installSubagentToolTitleLinks(agentNames: readonly string[]): () => void {
  const prototype = Text.prototype as PatchableTextPrototype;
  const existing = prototype[TOOL_RENDER_PATCH] as ToolRenderPatchState | undefined;
  if (existing !== undefined) {
    existing.agentNames = normalizedAgentNames(agentNames);
    existing.linkLines = linkSubagentToolBlock;
    existing.references += 1;
    return once(() => uninstallToolRenderPatch(prototype, existing));
  }

  const originalRender = prototype.render;
  const state: ToolRenderPatchState = {
    agentNames: normalizedAgentNames(agentNames),
    linkLines: linkSubagentToolBlock,
    originalRender,
    patchedRender: originalRender,
    references: 1,
  };
  state.patchedRender = function renderClickableSubagentTitle(width: number): string[] {
    // Match pi-subagents' original one-line title, not arbitrary rendered result text.
    const text = (this as unknown as { text: string }).text;
    const lines = state.originalRender.call(this, width);
    return isSubagentToolTitleSource(text, state.agentNames)
      ? state.linkLines(lines, state.agentNames)
      : lines;
  };
  prototype[TOOL_RENDER_PATCH] = state;
  prototype.render = state.patchedRender;
  return once(() => uninstallToolRenderPatch(prototype, state));
}

function uninstallToolRenderPatch(
  prototype: PatchableTextPrototype,
  state: ToolRenderPatchState,
): void {
  state.references -= 1;
  if (state.references > 0) return;
  if (prototype.render === state.patchedRender) prototype.render = state.originalRender;
  prototype[TOOL_RENDER_PATCH] = undefined;
}

export function installSubagentSessionsUrlHandler(tui: TUI, openSessions: () => void): () => void {
  if (tui.mode !== "fullscreen") return () => {};

  const patchableTui = tui as PatchableTui;
  const existing = patchableTui[TUI_URL_PATCH] as TuiUrlPatchState | undefined;
  if (existing !== undefined) {
    existing.openSessions = openSessions;
    existing.references += 1;
    return once(() => uninstallTuiUrlPatch(patchableTui, existing));
  }

  const state: TuiUrlPatchState = {
    openSessions,
    ...(patchableTui.openUrl === undefined
      ? {}
      : { originalOpenUrl: patchableTui.openUrl.bind(tui) }),
    patchedOpenUrl: () => {},
    references: 1,
  };
  state.patchedOpenUrl = (url) => {
    if (url === SUBAGENT_SESSIONS_URL) {
      state.openSessions();
      return;
    }

    state.originalOpenUrl?.(url);
  };
  patchableTui[TUI_URL_PATCH] = state;
  // TuiAltScreen reads this field at mouse release; Pi has no internal-action link API.
  patchableTui.openUrl = state.patchedOpenUrl;
  return once(() => uninstallTuiUrlPatch(patchableTui, state));
}

function uninstallTuiUrlPatch(patchableTui: PatchableTui, state: TuiUrlPatchState): void {
  state.references -= 1;
  if (state.references > 0) return;
  if (patchableTui.openUrl === state.patchedOpenUrl) {
    if (state.originalOpenUrl === undefined) {
      delete patchableTui.openUrl;
    } else {
      patchableTui.openUrl = state.originalOpenUrl;
    }
  }
  patchableTui[TUI_URL_PATCH] = undefined;
}

export function installClickableSubagentSessions(
  tui: TUI,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  agentNames: readonly string[],
): () => void {
  if (tui.mode !== "fullscreen") return () => {};

  const uninstallToolLinks = installSubagentToolTitleLinks(agentNames);
  const uninstallUrlHandler = installSubagentSessionsUrlHandler(tui, () => {
    try {
      pi.sendUserMessage("/subagents:sessions", { expandPromptTemplates: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Could not open subagent sessions: ${message}`, "error");
    }
  });
  return () => {
    uninstallUrlHandler();
    uninstallToolLinks();
  };
}
