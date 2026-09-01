import {
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionUIContext,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { hyperlink, type TUI } from "@earendil-works/pi-tui";

export const SUBAGENT_SESSION_URL_PREFIX = "pi-action://subagents/session/";

const TOOL_RENDER_PATCH = Symbol.for("dotfiles:pi-subagent-session-tool-links");
const TUI_URL_PATCH = Symbol.for("dotfiles:pi-subagent-session-url-handler");
const UI_SELECT_PATCH = Symbol.for("dotfiles:pi-subagent-session-direct-select");
const OSC8_OPEN = "\u001b]8;";
const PATCH_VERSION = 2;

export interface SubagentSessionTarget {
  agentId: string;
  displayName: string;
  description: string;
}

export interface SubagentSessionRecord {
  id: string;
  type: string;
  description: string;
  status: string;
  toolUses: number;
}

interface ToolRenderPatchState {
  version: typeof PATCH_VERSION;
  linkLines: typeof linkSubagentToolBlock;
  originalRender: (this: ToolExecutionComponent, width: number) => string[];
  patchedRender: (this: ToolExecutionComponent, width: number) => string[];
  references: number;
}

interface TuiUrlPatchState {
  version: typeof PATCH_VERSION;
  openSession: (target: SubagentSessionTarget) => void;
  originalOpenUrl?: (url: string) => void;
  patchedOpenUrl: (url: string) => void;
  references: number;
}

interface DirectSelectPatchState {
  version: typeof PATCH_VERSION;
  target: SubagentSessionTarget;
  getRecords: () => readonly SubagentSessionRecord[];
  originalSelect: ExtensionUIContext["select"];
  patchedSelect: ExtensionUIContext["select"];
}

interface SubagentToolDetails {
  agentId?: unknown;
  displayName?: unknown;
  description?: unknown;
}

interface PatchableToolExecution {
  toolName?: unknown;
  result?: { details?: SubagentToolDetails };
}
type PatchableToolPrototype = typeof ToolExecutionComponent.prototype & Record<symbol, unknown>;
type PatchableTui = TUI &
  Record<symbol, unknown> & {
    openUrl?: (url: string) => void;
  };
type PatchableUI = ExtensionUIContext & Record<symbol, unknown>;

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

export function subagentSessionUrl(target: SubagentSessionTarget): string {
  const url = new URL(`${SUBAGENT_SESSION_URL_PREFIX}${encodeURIComponent(target.agentId)}`);
  url.searchParams.set("name", target.displayName);
  url.searchParams.set("description", target.description);
  return url.toString();
}

export function parseSubagentSessionUrl(url: string): SubagentSessionTarget | undefined {
  if (url.startsWith(SUBAGENT_SESSION_URL_PREFIX) === false) return undefined;

  try {
    const parsed = new URL(url);
    const agentId = decodeURIComponent(parsed.pathname.slice("/session/".length));
    const displayName = parsed.searchParams.get("name");
    const description = parsed.searchParams.get("description");
    if (agentId.length === 0 || displayName === null || description === null) return undefined;
    return { agentId, displayName, description };
  } catch {
    return undefined;
  }
}

export function linkSubagentToolBlock(lines: readonly string[], url: string): string[] {
  return lines.map((line) => (line.includes(OSC8_OPEN) ? line : hyperlink(line, url)));
}

function subagentTarget(component: PatchableToolExecution): SubagentSessionTarget | undefined {
  if (component.toolName !== "subagent") return undefined;

  const details = component.result?.details;
  if (
    typeof details?.agentId !== "string" ||
    typeof details.displayName !== "string" ||
    typeof details.description !== "string"
  ) {
    return undefined;
  }
  return {
    agentId: details.agentId,
    displayName: details.displayName,
    description: details.description,
  };
}

export function installSubagentToolLinks(): () => void {
  const prototype = ToolExecutionComponent.prototype as PatchableToolPrototype;
  const installedState = prototype[TOOL_RENDER_PATCH];
  if (isCurrentPatchState(installedState)) {
    const existing = installedState as ToolRenderPatchState;
    existing.linkLines = linkSubagentToolBlock;
    existing.references += 1;
    return once(() => uninstallToolRenderPatch(prototype, existing));
  }
  restoreLegacyToolRenderPatch(prototype, installedState);

  const originalRender = prototype.render;
  const state: ToolRenderPatchState = {
    version: PATCH_VERSION,
    linkLines: linkSubagentToolBlock,
    originalRender,
    patchedRender: originalRender,
    references: 1,
  };
  state.patchedRender = function renderClickableSubagentTitle(width: number): string[] {
    const lines = state.originalRender.call(this, width);
    const target = subagentTarget(this as unknown as PatchableToolExecution);
    return target === undefined ? lines : state.linkLines(lines, subagentSessionUrl(target));
  };
  prototype[TOOL_RENDER_PATCH] = state;
  prototype.render = state.patchedRender;
  return once(() => uninstallToolRenderPatch(prototype, state));
}

function restoreLegacyToolRenderPatch(
  prototype: PatchableToolPrototype,
  installedState: unknown,
): void {
  if (typeof installedState !== "object" || installedState === null) return;
  if ("originalRender" in installedState && typeof installedState.originalRender === "function") {
    prototype.render = installedState.originalRender as typeof prototype.render;
  }
  prototype[TOOL_RENDER_PATCH] = undefined;
}

function uninstallToolRenderPatch(
  prototype: PatchableToolPrototype,
  state: ToolRenderPatchState,
): void {
  state.references -= 1;
  if (state.references > 0) return;
  if (prototype.render === state.patchedRender) prototype.render = state.originalRender;
  prototype[TOOL_RENDER_PATCH] = undefined;
}

export function installSubagentSessionUrlHandler(
  tui: TUI,
  openSession: (target: SubagentSessionTarget) => void,
): () => void {
  if (tui.mode !== "fullscreen") return () => {};

  const patchableTui = tui as PatchableTui;
  const installedState = patchableTui[TUI_URL_PATCH];
  if (isCurrentPatchState(installedState)) {
    const existing = installedState as TuiUrlPatchState;
    existing.openSession = openSession;
    existing.references += 1;
    return once(() => uninstallTuiUrlPatch(patchableTui, existing));
  }
  restoreLegacyTuiUrlPatch(patchableTui, installedState);

  const state: TuiUrlPatchState = {
    version: PATCH_VERSION,
    openSession,
    ...(patchableTui.openUrl === undefined ? {} : { originalOpenUrl: patchableTui.openUrl }),
    patchedOpenUrl: () => {},
    references: 1,
  };
  state.patchedOpenUrl = (url) => {
    const target = parseSubagentSessionUrl(url);
    if (target !== undefined) {
      state.openSession(target);
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

export function findSubagentSessionOption(
  target: SubagentSessionTarget,
  records: readonly SubagentSessionRecord[],
  options: readonly string[],
): string | undefined {
  const record = records.find((candidate) => candidate.id === target.agentId);
  if (record === undefined) return undefined;

  const labelPrefix = `${target.displayName} (${target.description}) · `;
  const statusPrefix = `${labelPrefix}${record.toolUses} tools · ${record.status} · `;
  const statusMatch = options.find((option) => option.startsWith(statusPrefix));
  if (statusMatch !== undefined) return statusMatch;

  const matchingOptions = options.filter((option) => option.startsWith(labelPrefix));
  const matchingRecords = records.filter(
    (candidate) => candidate.type === record.type && candidate.description === record.description,
  );
  const occurrence = matchingRecords.findIndex((candidate) => candidate.id === target.agentId);
  return occurrence < 0 ? undefined : matchingOptions[occurrence];
}

function restoreDirectSelectPatch(ui: PatchableUI, state: DirectSelectPatchState): void {
  if (ui.select === state.patchedSelect) ui.select = state.originalSelect;
  ui[UI_SELECT_PATCH] = undefined;
}

function restoreLegacyDirectSelectPatch(ui: PatchableUI, installedState: unknown): void {
  if (typeof installedState !== "object" || installedState === null) return;
  if ("originalSelect" in installedState && typeof installedState.originalSelect === "function") {
    ui.select = installedState.originalSelect as ExtensionUIContext["select"];
  }
  ui[UI_SELECT_PATCH] = undefined;
}

export function armDirectSubagentSessionSelection(
  ui: ExtensionUIContext,
  target: SubagentSessionTarget,
  getRecords: () => readonly SubagentSessionRecord[],
): () => void {
  const patchableUi = ui as PatchableUI;
  const installedState = patchableUi[UI_SELECT_PATCH];
  if (isCurrentPatchState(installedState)) {
    const existing = installedState as DirectSelectPatchState;
    existing.target = target;
    existing.getRecords = getRecords;
    return once(() => restoreDirectSelectPatch(patchableUi, existing));
  }
  restoreLegacyDirectSelectPatch(patchableUi, installedState);

  const state: DirectSelectPatchState = {
    version: PATCH_VERSION,
    target,
    getRecords,
    originalSelect: patchableUi.select,
    patchedSelect: patchableUi.select,
  };
  state.patchedSelect = async (title, options, opts) => {
    if (title !== "Subagent sessions") {
      return state.originalSelect.call(patchableUi, title, options, opts);
    }

    restoreDirectSelectPatch(patchableUi, state);
    const option = findSubagentSessionOption(state.target, state.getRecords(), options);
    if (option === undefined) {
      patchableUi.notify("The selected subagent session is no longer available.", "warning");
    }
    return option;
  };
  patchableUi[UI_SELECT_PATCH] = state;
  patchableUi.select = state.patchedSelect;
  return once(() => restoreDirectSelectPatch(patchableUi, state));
}

interface SubagentsService {
  listAgents(): SubagentSessionRecord[];
}

function getSubagentsService(): SubagentsService | undefined {
  const key = Symbol.for("@gotgenes/pi-subagents:service");
  return (globalThis as Record<symbol, unknown>)[key] as SubagentsService | undefined;
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
): () => void {
  if (tui.mode !== "fullscreen") return () => {};

  const uninstallToolLinks = installSubagentToolLinks();
  let cancelDirectSelection = () => {};
  const uninstallUrlHandler = installSubagentSessionUrlHandler(tui, (target) => {
    const service = getSubagentsService();
    if (service === undefined) {
      ctx.ui.notify("Could not access subagent sessions.", "error");
      return;
    }

    cancelDirectSelection();
    cancelDirectSelection = armDirectSubagentSessionSelection(ctx.ui, target, () =>
      service.listAgents(),
    );
    try {
      pi.sendUserMessage("/subagents:sessions", { expandPromptTemplates: true });
    } catch (error) {
      cancelDirectSelection();
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Could not open subagent session: ${message}`, "error");
    }
  });
  return () => {
    cancelDirectSelection();
    uninstallUrlHandler();
    uninstallToolLinks();
  };
}
