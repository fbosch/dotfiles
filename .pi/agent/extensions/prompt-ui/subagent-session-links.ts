import { readFileSync } from "node:fs";
import {
  type AgentToolResult,
  type ExtensionContext,
  getAgentDir,
  getMarkdownTheme,
  type Theme,
  type ToolDefinition,
  ToolExecutionComponent,
  truncateLine,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  hyperlink,
  isKeyRelease,
  type MarkdownTheme,
  matchesKey,
  type Terminal,
  Text,
  type TUI,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  type AgentWidgetColors,
  colorizeSubagentToolLine,
  loadAgentWidgetColors,
} from "./subagent-widget-frame";

export const SUBAGENT_SESSION_URL_PREFIX = "pi-action://subagents/session";

const TOOL_RENDER_PATCH = Symbol.for("dotfiles:pi-subagent-session-tool-links");
const TUI_URL_PATCH = Symbol.for("dotfiles:pi-subagent-session-url-handler");
const TERMINAL_WRITE_PATCH = Symbol.for("dotfiles:pi-subagent-session-terminal-filter");
const OSC8_OPEN = "\u001b]8;";
const OSC8_SEQUENCE = new RegExp(
  `${OSC8_OPEN}[^;]*;([^\\u0007\\u001b]*)(?:\\u0007|\\u001b\\\\)`,
  "g",
);
const PATCH_VERSION = 5;
const OVERLAY_HEIGHT = "70%";
const OVERLAY_WIDTH = "90%";
const TRANSCRIPT_TOOL_PREVIEW_LINES = 5;
const TRANSCRIPT_TOOL_PREVIEW_LINE_CHARS = 500;
const TRANSCRIPT_TOOL_PARAMETERS = Type.Object({});
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
    theme?: Theme;
    agentColors?: AgentWidgetColors;
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

interface SubagentToolLinkOptions {
  theme?: Theme;
  agentColors?: AgentWidgetColors;
}

// shortcut: Pi has no tool-result link hook. Read the component's runtime fields until
// Pi or pi-subagents exposes a supported renderer or direct-transcript action.
interface PatchableToolExecution {
  toolName?: unknown;
  toolCallId?: unknown;
  args?: Record<string, unknown>;
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

function registrationForTui(
  registrations: ToolRenderPatchState["registrations"],
  tui: unknown,
): ToolRenderPatchState["registrations"][number] | undefined {
  for (let index = registrations.length - 1; index >= 0; index -= 1) {
    const registration = registrations[index];
    if (registration === undefined) continue;
    if (registration.tui === tui) return registration;
  }
  return undefined;
}

export function installSubagentToolLinks(
  tui?: TUI,
  service?: SubagentsService,
  options: SubagentToolLinkOptions = {},
): () => void {
  restoreLegacyTextToolRenderPatch();
  const prototype = ToolExecutionComponent.prototype as PatchableToolPrototype;
  const registration: ToolRenderPatchState["registrations"][number] = {
    owner: Symbol(),
    ...(tui === undefined ? {} : { tui }),
    ...(service === undefined ? {} : { service }),
    ...(options.theme === undefined ? {} : { theme: options.theme }),
    ...(options.agentColors === undefined ? {} : { agentColors: options.agentColors }),
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
    const registration = registrationForTui(state.registrations, component.ui);
    const theme = registration?.theme;
    const agentColors = registration?.agentColors;
    const coloredLines =
      component.toolName === "subagent" && theme !== undefined && agentColors !== undefined
        ? lines.map((line) => colorizeSubagentToolLine(line, agentColors, theme))
        : lines;
    const target = subagentTarget(component, registration?.service);
    return target === undefined
      ? coloredLines
      : state.linkLines(coloredLines, subagentSessionUrl(target));
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

export function installSubagentTerminalLinkFilter(tui: TUI): () => void {
  if (tui.mode !== "fullscreen") return () => {};

  const terminal = tui.terminal as PatchableTerminal;
  const owner = Symbol();
  const installedState = terminal[TERMINAL_WRITE_PATCH];
  if (isCurrentPatchState(installedState)) {
    const existing = installedState as TerminalWritePatchState;
    existing.owners.push(owner);
    return once(() => uninstallTerminalWritePatch(terminal, existing, owner));
  }
  restoreLegacyTerminalWritePatch(terminal, installedState);

  const originalWrite = terminal.write;
  const state: TerminalWritePatchState = {
    version: PATCH_VERSION,
    owners: [owner],
    internalLinkOpen: false,
    originalWrite,
    patchedWrite: originalWrite,
  };
  state.patchedWrite = function writeWithoutInternalLinks(data: string): void {
    state.originalWrite.call(terminal, stripSubagentSessionLinks(data, state));
  };
  terminal[TERMINAL_WRITE_PATCH] = state;
  // Keep OSC-8 in TuiAltScreen's frame for hit-testing, but hide internal links from
  // the terminal so it cannot apply native hyperlink hover styling.
  terminal.write = state.patchedWrite;
  return once(() => uninstallTerminalWritePatch(terminal, state, owner));
}

function restoreLegacyTerminalWritePatch(
  terminal: PatchableTerminal,
  installedState: unknown,
): void {
  if (typeof installedState !== "object" || installedState === null) return;
  if ("originalWrite" in installedState && typeof installedState.originalWrite === "function") {
    terminal.write = installedState.originalWrite as Terminal["write"];
  }
  terminal[TERMINAL_WRITE_PATCH] = undefined;
}

function uninstallTerminalWritePatch(
  terminal: PatchableTerminal,
  state: TerminalWritePatchState,
  owner: symbol,
): void {
  const index = state.owners.indexOf(owner);
  if (index >= 0) state.owners.splice(index, 1);
  if (state.owners.length > 0) return;
  if (terminal.write === state.patchedWrite) terminal.write = state.originalWrite;
  if (terminal[TERMINAL_WRITE_PATCH] === state) terminal[TERMINAL_WRITE_PATCH] = undefined;
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

export interface SubagentTranscriptSource {
  getMessages(): readonly unknown[];
  subscribe(onChange: (event?: unknown) => void): (() => void) | undefined;
  streaming(): unknown;
  getToolDefinition(name: string): ToolDefinition | undefined;
}

interface SessionNavigationModule {
  fileSnapshotSource(
    outputFile: string,
    readFile: (path: string) => string,
  ): SubagentTranscriptSource;
  liveSource(record: InternalSubagentRecord): SubagentTranscriptSource;
}

interface SessionNavigatorModule {
  TranscriptOverlay: new (options: {
    tui: TUI;
    theme: Theme;
    source: SubagentTranscriptSource;
    done: (result: undefined) => void;
    cwd: string;
    markdownTheme: MarkdownTheme;
  }) => Component & { dispose?(): void };
}

function compactToolArguments(args: object): string {
  const serialized = JSON.stringify(args);
  if (serialized === undefined || serialized === "{}") return "";
  return truncateLine(serialized, TRANSCRIPT_TOOL_PREVIEW_LINE_CHARS).text;
}

function compactToolOutput(result: AgentToolResult<unknown>, theme: Theme): string {
  const output = result.content
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("\n");
  if (output.length === 0) {
    return result.content.some((content) => content.type === "image")
      ? theme.fg("muted", "[image output omitted]")
      : "";
  }

  const lines = output.split("\n");
  const visibleLines = lines
    .slice(0, TRANSCRIPT_TOOL_PREVIEW_LINES)
    .map((line) =>
      theme.fg("toolOutput", truncateLine(line, TRANSCRIPT_TOOL_PREVIEW_LINE_CHARS).text),
    );
  const remaining = lines.length - visibleLines.length;
  if (remaining > 0) {
    visibleLines.push(theme.fg("muted", `... (${remaining} more lines)`));
  }
  return visibleLines.join("\n");
}

function createCompactTranscriptToolDefinition(
  name: string,
): ToolDefinition<typeof TRANSCRIPT_TOOL_PARAMETERS> {
  return {
    name,
    label: name,
    description: "Read-only transcript preview",
    parameters: TRANSCRIPT_TOOL_PARAMETERS,
    async execute() {
      throw new Error("Transcript previews cannot execute tools.");
    },
    renderCall(args, theme) {
      const argumentsText = compactToolArguments(args);
      const title = theme.fg("toolTitle", theme.bold(name));
      return new Text(
        argumentsText.length === 0 ? title : `${title} ${theme.fg("muted", argumentsText)}`,
        0,
        0,
      );
    },
    renderResult(result, _options, theme) {
      return new Text(compactToolOutput(result, theme), 0, 0);
    },
  };
}

// pi-subagents expands live tools and snapshots have no renderer, so both paths
// need a bounded definition before TranscriptContent builds the overlay.
export function compactSubagentTranscriptSource(
  source: SubagentTranscriptSource,
): SubagentTranscriptSource {
  const definitions = new Map<string, ToolDefinition>();
  return {
    getMessages: () => source.getMessages(),
    subscribe: (onChange) => source.subscribe(onChange),
    streaming: () => source.streaming(),
    getToolDefinition: (name) => {
      const existing = definitions.get(name);
      if (existing !== undefined) return existing;
      const definition = createCompactTranscriptToolDefinition(name);
      definitions.set(name, definition);
      return definition;
    },
  };
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

  let overlayComponent: Component | undefined;
  let overlayHandle: { isFocused(): boolean } | undefined;
  // A non-overlay prompt can temporarily steal focus from this inspection overlay;
  // consume Escape here so it closes the overlay instead of cancelling the prompt.
  const removeEscapeHandler =
    typeof ctx.ui.onTerminalInput === "function"
      ? ctx.ui.onTerminalInput((data) => {
          if (
            overlayComponent === undefined ||
            overlayHandle?.isFocused() !== false ||
            isKeyRelease(data) ||
            matchesKey(data, "escape") === false
          ) {
            return undefined;
          }

          overlayComponent.handleInput?.(data);
          return { consume: true };
        })
      : undefined;

  try {
    const { navigation, navigator } = await loadSessionNavigator();
    let source: SubagentTranscriptSource;
    if (hasLiveSession) {
      source = navigation.liveSource(liveRecord);
    } else {
      if (outputFile === undefined) return;
      source = navigation.fileSnapshotSource(outputFile, (path) => readFileSync(path, "utf8"));
    }
    source = compactSubagentTranscriptSource(source);
    const markdownTheme = getMarkdownTheme();
    await ctx.ui.custom<undefined>(
      (tui, theme, _keybindings, done) => {
        overlayComponent = new navigator.TranscriptOverlay({
          tui,
          theme,
          source,
          done,
          cwd: ctx.cwd,
          markdownTheme,
        });
        return overlayComponent;
      },
      {
        overlay: true,
        overlayOptions: {
          anchor: "center",
          width: OVERLAY_WIDTH,
          maxHeight: OVERLAY_HEIGHT,
        },
        onHandle: (handle) => {
          overlayHandle = handle;
        },
      },
    );
  } catch {
    ctx.ui.notify("Could not read the selected subagent session.", "error");
  } finally {
    removeEscapeHandler?.();
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
  const uninstallToolLinks = installSubagentToolLinks(tui, service, {
    theme: ctx.ui.theme,
    agentColors: loadAgentWidgetColors(ctx.cwd, getAgentDir()),
  });
  const uninstallUrlHandler = installSubagentSessionUrlHandler(tui, (target) => {
    if (service === undefined) {
      ctx.ui.notify("Could not access subagent sessions.", "error");
      return;
    }

    void openSubagentSession(target, service, ctx);
  });
  const uninstallTerminalFilter = installSubagentTerminalLinkFilter(tui);
  return () => {
    uninstallTerminalFilter();
    uninstallUrlHandler();
    uninstallToolLinks();
  };
}
