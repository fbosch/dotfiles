import { readFileSync } from "node:fs";
import {
  type ExtensionContext,
  getMarkdownTheme,
  type Theme,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  hyperlink,
  type MarkdownTheme,
  type Terminal,
  Text,
  type TUI,
} from "@earendil-works/pi-tui";

export const SUBAGENT_SESSION_URL_PREFIX = "pi-action://subagents/session";

const TOOL_RENDER_PATCH = Symbol.for("dotfiles:pi-subagent-session-tool-links");
const TUI_URL_PATCH = Symbol.for("dotfiles:pi-subagent-session-url-handler");
const TERMINAL_WRITE_PATCH = Symbol.for("dotfiles:pi-subagent-session-terminal-filter");
const OSC8_OPEN = "\u001b]8;";
const OSC8_SEQUENCE = /\u001b]8;[^;]*;([^\u0007\u001b]*)(?:\u0007|\u001b\\)/g;
const PATCH_VERSION = 4;
const OVERLAY_HEIGHT = "70%";
const OVERLAY_WIDTH = "90%";
// shortcut: pi-subagents exposes records but not its transcript renderer. Reuse the
// pinned package modules until its public API can open a transcript by agent ID.
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
  registrations: Array<{
    owner: symbol;
    tui?: TUI;
    service?: SubagentsService;
  }>;
}

interface TuiUrlPatchState {
  version: typeof PATCH_VERSION;
  registrations: Array<{
    owner: symbol;
    openSession: (target: SubagentSessionTarget) => void;
  }>;
  originalOpenUrl?: (url: string) => void;
  patchedOpenUrl: (url: string) => void;
}

interface TerminalWritePatchState {
  version: typeof PATCH_VERSION;
  owners: symbol[];
  internalLinkOpen: boolean;
  originalWrite: Terminal["write"];
  patchedWrite: Terminal["write"];
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
  toolCallId?: unknown;
  ui?: unknown;
  result?: { details?: SubagentToolDetails };
}
type PatchableToolPrototype = typeof ToolExecutionComponent.prototype & Record<symbol, unknown>;
type PatchableTextPrototype = typeof Text.prototype & Record<symbol, unknown>;
type PatchableTerminal = Terminal & Record<symbol, unknown>;
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
  const url = new URL(SUBAGENT_SESSION_URL_PREFIX);
  url.searchParams.set("id", target.agentId);
  url.searchParams.set("name", target.displayName);
  url.searchParams.set("description", target.description);
  return url.toString();
}

export function parseSubagentSessionUrl(url: string): SubagentSessionTarget | undefined {
  try {
    const query = url.split("?", 2)[1]?.split("#", 1)[0] ?? "";
    if (/%(?![\dA-Fa-f]{2})/.test(query)) return undefined;

    const parsed = new URL(url);
    if (
      parsed.protocol !== "pi-action:" ||
      parsed.hostname !== "subagents" ||
      parsed.pathname !== "/session" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.port !== "" ||
      parsed.hash !== ""
    ) {
      return undefined;
    }

    const parameters = [...parsed.searchParams.keys()];
    if (
      parameters.length !== 3 ||
      parsed.searchParams.getAll("id").length !== 1 ||
      parsed.searchParams.getAll("name").length !== 1 ||
      parsed.searchParams.getAll("description").length !== 1
    ) {
      return undefined;
    }

    const agentId = parsed.searchParams.get("id");
    const displayName = parsed.searchParams.get("name");
    const description = parsed.searchParams.get("description");
    if (agentId === null || agentId.length === 0 || displayName === null || description === null) {
      return undefined;
    }
    return { agentId, displayName, description };
  } catch {
    return undefined;
  }
}

export function linkSubagentToolBlock(lines: readonly string[], url: string): string[] {
  return lines.map((line) => (line.includes(OSC8_OPEN) ? line : hyperlink(line, url)));
}

function stripSubagentSessionLinks(
  data: string,
  state: Pick<TerminalWritePatchState, "internalLinkOpen">,
): string {
  return data.replace(OSC8_SEQUENCE, (sequence, url: string) => {
    if (url.startsWith(SUBAGENT_SESSION_URL_PREFIX)) {
      state.internalLinkOpen = true;
      return "";
    }
    if (url.length === 0 && state.internalLinkOpen) {
      state.internalLinkOpen = false;
      return "";
    }
    return sequence;
  });
}

function subagentTarget(
  component: PatchableToolExecution,
  service: SubagentsService | undefined,
): SubagentSessionTarget | undefined {
  if (component.toolName !== "subagent") return undefined;

  const details = component.result?.details;
  const agentId =
    typeof details?.agentId === "string"
      ? details.agentId
      : resolveRunningAgentId(component.toolCallId, service);
  const displayName = details?.displayName;
  const description = details?.description;
  if (agentId === undefined || typeof displayName !== "string" || typeof description !== "string") {
    return undefined;
  }
  return {
    agentId,
    displayName,
    description,
  };
}

function resolveRunningAgentId(
  toolCallId: unknown,
  service: SubagentsService | undefined,
): string | undefined {
  if (typeof toolCallId !== "string" || service === undefined) return undefined;
  return service.manager?.listAgents().find((record) => record.toolCallId === toolCallId)?.id;
}

function serviceForTui(
  registrations: ToolRenderPatchState["registrations"],
  tui: unknown,
): SubagentsService | undefined {
  for (let index = registrations.length - 1; index >= 0; index -= 1) {
    const registration = registrations[index];
    if (registration === undefined) continue;
    if (registration.tui === tui) return registration.service;
  }
  return undefined;
}

export function installSubagentToolLinks(tui?: TUI, service?: SubagentsService): () => void {
  restoreLegacyTextToolRenderPatch();
  const prototype = ToolExecutionComponent.prototype as PatchableToolPrototype;
  const registration: ToolRenderPatchState["registrations"][number] = {
    owner: Symbol(),
    ...(tui === undefined ? {} : { tui }),
    ...(service === undefined ? {} : { service }),
  };
  const installedState = prototype[TOOL_RENDER_PATCH];
  if (isCurrentPatchState(installedState)) {
    const existing = installedState as ToolRenderPatchState;
    existing.linkLines = linkSubagentToolBlock;
    existing.registrations.push(registration);
    return once(() => uninstallToolRenderPatch(prototype, existing, registration.owner));
  }
  restoreLegacyToolRenderPatch(prototype, installedState);

  const originalRender = prototype.render;
  const state: ToolRenderPatchState = {
    version: PATCH_VERSION,
    linkLines: linkSubagentToolBlock,
    originalRender,
    patchedRender: originalRender,
    registrations: [registration],
  };
  state.patchedRender = function renderClickableSubagentTitle(width: number): string[] {
    const lines = state.originalRender.call(this, width);
    const component = this as unknown as PatchableToolExecution;
    const target = subagentTarget(component, serviceForTui(state.registrations, component.ui));
    return target === undefined ? lines : state.linkLines(lines, subagentSessionUrl(target));
  };
  prototype[TOOL_RENDER_PATCH] = state;
  prototype.render = state.patchedRender;
  return once(() => uninstallToolRenderPatch(prototype, state, registration.owner));
}

function restoreLegacyTextToolRenderPatch(): void {
  const prototype = Text.prototype as PatchableTextPrototype;
  const installedState = prototype[TOOL_RENDER_PATCH];
  if (typeof installedState !== "object" || installedState === null) return;
  if ("originalRender" in installedState && typeof installedState.originalRender === "function") {
    prototype.render = installedState.originalRender as typeof prototype.render;
  }
  prototype[TOOL_RENDER_PATCH] = undefined;
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
  owner: symbol,
): void {
  const index = state.registrations.findIndex((registration) => registration.owner === owner);
  if (index >= 0) state.registrations.splice(index, 1);
  if (state.registrations.length > 0) return;
  if (prototype.render === state.patchedRender) prototype.render = state.originalRender;
  if (prototype[TOOL_RENDER_PATCH] === state) prototype[TOOL_RENDER_PATCH] = undefined;
}

export function installSubagentSessionUrlHandler(
  tui: TUI,
  openSession: (target: SubagentSessionTarget) => void,
): () => void {
  if (tui.mode !== "fullscreen") return () => {};

  const patchableTui = tui as PatchableTui;
  const registration = { owner: Symbol(), openSession };
  const installedState = patchableTui[TUI_URL_PATCH];
  if (isCurrentPatchState(installedState)) {
    const existing = installedState as TuiUrlPatchState;
    existing.registrations.push(registration);
    return once(() => uninstallTuiUrlPatch(patchableTui, existing, registration.owner));
  }
  restoreLegacyTuiUrlPatch(patchableTui, installedState);

  const state: TuiUrlPatchState = {
    version: PATCH_VERSION,
    registrations: [registration],
    ...(patchableTui.openUrl === undefined ? {} : { originalOpenUrl: patchableTui.openUrl }),
    patchedOpenUrl: () => {},
  };
  state.patchedOpenUrl = (url) => {
    const target = parseSubagentSessionUrl(url);
    if (target !== undefined) {
      state.registrations.at(-1)?.openSession(target);
      return;
    }

    state.originalOpenUrl?.call(patchableTui, url);
  };
  patchableTui[TUI_URL_PATCH] = state;
  // TuiAltScreen reads this field at mouse release; Pi has no internal-action link API.
  patchableTui.openUrl = state.patchedOpenUrl;
  return once(() => uninstallTuiUrlPatch(patchableTui, state, registration.owner));
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
  getRecord(id: string): { outputFile?: string; status: string } | undefined;
  manager?: {
    getRecord(id: string): InternalSubagentRecord | undefined;
    listAgents(): InternalSubagentRecord[];
  };
}

interface InternalSubagentRecord {
  id: string;
  toolCallId?: string;
  isSessionReady(): boolean;
}

interface SessionNavigationModule {
  fileSnapshotSource(outputFile: string, readFile: (path: string) => string): unknown;
  liveSource(record: InternalSubagentRecord): unknown;
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

export async function openSubagentSession(
  target: SubagentSessionTarget,
  service: SubagentsService,
  ctx: ExtensionContext,
): Promise<void> {
  const record = service.getRecord(target.agentId);
  if (record === undefined) {
    ctx.ui.notify("The selected subagent session is no longer available.", "warning");
    return;
  }

  const liveRecord = service.manager?.getRecord(target.agentId);
  const hasLiveSession = liveRecord?.isSessionReady() === true;
  const outputFile = record.outputFile;
  if (hasLiveSession === false && outputFile === undefined) {
    ctx.ui.notify("The selected subagent session is not ready yet.", "warning");
    return;
  }

  if (hasLiveSession === false && (record.status === "queued" || record.status === "running")) {
    ctx.ui.notify("Opening the current transcript snapshot. Reopen it to refresh.", "info");
  }

  try {
    const { navigation, navigator } = await loadSessionNavigator();
    let source: unknown;
    if (hasLiveSession) {
      source = navigation.liveSource(liveRecord);
    } else {
      if (outputFile === undefined) return;
      source = navigation.fileSnapshotSource(outputFile, (path) => readFileSync(path, "utf8"));
    }
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

function uninstallTuiUrlPatch(
  patchableTui: PatchableTui,
  state: TuiUrlPatchState,
  owner: symbol,
): void {
  const index = state.registrations.findIndex((registration) => registration.owner === owner);
  if (index >= 0) state.registrations.splice(index, 1);
  if (state.registrations.length > 0) return;
  if (patchableTui.openUrl === state.patchedOpenUrl) {
    if (state.originalOpenUrl === undefined) {
      delete patchableTui.openUrl;
    } else {
      patchableTui.openUrl = state.originalOpenUrl;
    }
  }
  if (patchableTui[TUI_URL_PATCH] === state) patchableTui[TUI_URL_PATCH] = undefined;
}

export function installClickableSubagentSessions(tui: TUI, ctx: ExtensionContext): () => void {
  if (tui.mode !== "fullscreen") return () => {};

  const service = getSubagentsService();
  const uninstallToolLinks = installSubagentToolLinks(tui, service);
  const uninstallUrlHandler = installSubagentSessionUrlHandler(tui, (target) => {
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
