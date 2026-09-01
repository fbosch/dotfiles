import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { hyperlink, stripTerminalSequences, Text, type TUI } from "@earendil-works/pi-tui";

export const SUBAGENT_SESSIONS_URL = "pi-action://subagents/sessions";

const TOOL_RENDER_PATCH = Symbol.for("dotfiles:pi-subagent-session-tool-links");
const TUI_URL_PATCH = Symbol.for("dotfiles:pi-subagent-session-url-handler");
const OSC8_OPEN = "\u001b]8;";
const PATCH_VERSION = 1;
const TOOL_CALL_PREFIX = "› ";

interface ToolRenderPatchState {
  version: typeof PATCH_VERSION;
  agentNames: Set<string>;
  linkLines: typeof linkSubagentToolBlock;
  originalRender: (this: Text, width: number) => string[];
  patchedRender: (this: Text, width: number) => string[];
  references: number;
}

interface TuiUrlPatchState {
  version: typeof PATCH_VERSION;
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

function isCurrentPatchState(value: unknown): value is { version: typeof PATCH_VERSION } {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === PATCH_VERSION
  );
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
  const installedState = prototype[TOOL_RENDER_PATCH];
  if (isCurrentPatchState(installedState)) {
    const existing = installedState as ToolRenderPatchState;
    existing.agentNames = normalizedAgentNames(agentNames);
    existing.linkLines = linkSubagentToolBlock;
    existing.references += 1;
    return once(() => uninstallToolRenderPatch(prototype, existing));
  }
  restoreLegacyToolRenderPatch(prototype, installedState);

  const originalRender = prototype.render;
  const state: ToolRenderPatchState = {
    version: PATCH_VERSION,
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

function restoreLegacyToolRenderPatch(
  prototype: PatchableTextPrototype,
  installedState: unknown,
): void {
  if (typeof installedState !== "object" || installedState === null) return;
  if ("originalRender" in installedState && typeof installedState.originalRender === "function") {
    prototype.render = installedState.originalRender as typeof prototype.render;
  }
  prototype[TOOL_RENDER_PATCH] = undefined;
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
  const installedState = patchableTui[TUI_URL_PATCH];
  if (isCurrentPatchState(installedState)) {
    const existing = installedState as TuiUrlPatchState;
    existing.openSessions = openSessions;
    existing.references += 1;
    return once(() => uninstallTuiUrlPatch(patchableTui, existing));
  }
  restoreLegacyTuiUrlPatch(patchableTui, installedState);

  const state: TuiUrlPatchState = {
    version: PATCH_VERSION,
    openSessions,
    ...(patchableTui.openUrl === undefined ? {} : { originalOpenUrl: patchableTui.openUrl }),
    patchedOpenUrl: () => {},
    references: 1,
  };
  state.patchedOpenUrl = (url) => {
    if (url === SUBAGENT_SESSIONS_URL) {
      state.openSessions();
      return;
    }

    state.originalOpenUrl?.call(patchableTui, url);
  };
  patchableTui[TUI_URL_PATCH] = state;
  // TuiAltScreen reads this field at mouse release; Pi has no internal-action link API.
  patchableTui.openUrl = state.patchedOpenUrl;
  return once(() => uninstallTuiUrlPatch(patchableTui, state));
}

function restoreLegacyTuiUrlPatch(patchableTui: PatchableTui, installedState: unknown): void {
  if (typeof installedState !== "object" || installedState === null) return;
  if ("originalOpenUrl" in installedState && typeof installedState.originalOpenUrl === "function") {
    patchableTui.openUrl = installedState.originalOpenUrl as (url: string) => void;
  } else {
    delete patchableTui.openUrl;
  }
  patchableTui[TUI_URL_PATCH] = undefined;
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
