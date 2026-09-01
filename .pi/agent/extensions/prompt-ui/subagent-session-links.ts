import { readFileSync } from "node:fs";
import {
  type ExtensionContext,
  getMarkdownTheme,
  type Theme,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { type Component, hyperlink, type MarkdownTheme, type TUI } from "@earendil-works/pi-tui";

export const SUBAGENT_SESSION_URL_PREFIX = "pi-action://subagents/session/";

const TOOL_RENDER_PATCH = Symbol.for("dotfiles:pi-subagent-session-tool-links");
const TUI_URL_PATCH = Symbol.for("dotfiles:pi-subagent-session-url-handler");
const OSC8_OPEN = "\u001b]8;";
const PATCH_VERSION = 2;
const OVERLAY_HEIGHT = "70%";
const OVERLAY_WIDTH = "90%";
const SESSION_NAVIGATION_MODULE = new URL(
  "../../npm/node_modules/@gotgenes/pi-subagents/src/ui/session-navigation.ts",
  import.meta.url,
).href;
const SESSION_NAVIGATOR_MODULE = new URL(
  "../../npm/node_modules/@gotgenes/pi-subagents/src/ui/session-navigator.ts",
  import.meta.url,
).href;

export interface SubagentSessionTarget {
  agentId: string;
  displayName: string;
  description: string;
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

interface SubagentToolDetails {
  agentId?: unknown;
  displayName?: unknown;
  description?: unknown;
}

// shortcut: Pi has no tool-result link hook. Read the component's runtime fields until
// Pi or pi-subagents exposes a supported renderer or direct-transcript action.
interface PatchableToolExecution {
  toolName?: unknown;
  result?: { details?: SubagentToolDetails };
}
type PatchableToolPrototype = typeof ToolExecutionComponent.prototype & Record<symbol, unknown>;
type PatchableTui = TUI &
  Record<symbol, unknown> & {
    openUrl?: (url: string) => void;
  };

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

interface SubagentsService {
  getRecord(id: string): { outputFile?: string } | undefined;
}

interface SessionNavigationModule {
  fileSnapshotSource(outputFile: string, readFile: (path: string) => string): unknown;
}

interface SessionNavigatorModule {
  TranscriptOverlay: new (options: {
    tui: TUI;
    theme: Theme;
    source: unknown;
    done: (result: undefined) => void;
    cwd: string;
    markdownTheme: MarkdownTheme;
  }) => Component & { dispose?(): void };
}

function getSubagentsService(): SubagentsService | undefined {
  // pi-subagents documents this Symbol.for key as its cross-extension service contract.
  // Importing the accessor is not viable here because Pi keeps package dependencies in
  // its isolated package cache rather than this local extension's module-resolution tree.
  const key = Symbol.for("@gotgenes/pi-subagents:service");
  return (globalThis as Record<symbol, unknown>)[key] as SubagentsService | undefined;
}

async function loadSessionNavigator(): Promise<{
  navigation: SessionNavigationModule;
  navigator: SessionNavigatorModule;
}> {
  const [navigation, navigator] = await Promise.all([
    import(SESSION_NAVIGATION_MODULE),
    import(SESSION_NAVIGATOR_MODULE),
  ]);
  return {
    navigation: navigation as unknown as SessionNavigationModule,
    navigator: navigator as unknown as SessionNavigatorModule,
  };
}

async function openSubagentSession(
  target: SubagentSessionTarget,
  service: SubagentsService,
  ctx: ExtensionContext,
): Promise<void> {
  const outputFile = service.getRecord(target.agentId)?.outputFile;
  if (outputFile === undefined) {
    ctx.ui.notify("The selected subagent session is not ready yet.", "warning");
    return;
  }

  try {
    const { navigation, navigator } = await loadSessionNavigator();
    const source = navigation.fileSnapshotSource(outputFile, (path) => readFileSync(path, "utf8"));
    const markdownTheme = getMarkdownTheme();
    await ctx.ui.custom<undefined>(
      (tui, theme, _keybindings, done) =>
        new navigator.TranscriptOverlay({
          tui,
          theme,
          source,
          done,
          cwd: ctx.cwd,
          markdownTheme,
        }),
      {
        overlay: true,
        overlayOptions: {
          anchor: "center",
          width: OVERLAY_WIDTH,
          maxHeight: OVERLAY_HEIGHT,
        },
      },
    );
  } catch {
    ctx.ui.notify("Could not read the selected subagent session.", "error");
  }
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
  ctx: ExtensionContext,
): () => void {
  if (tui.mode !== "fullscreen") return () => {};

  const uninstallToolLinks = installSubagentToolLinks();
  const uninstallUrlHandler = installSubagentSessionUrlHandler(tui, (target) => {
    const service = getSubagentsService();
    if (service === undefined) {
      ctx.ui.notify("Could not access subagent sessions.", "error");
      return;
    }

    void openSubagentSession(target, service, ctx);
  });
  return () => {
    uninstallUrlHandler();
    uninstallToolLinks();
  };
}
