import {
  type ExtensionUIContext,
  type ExtensionWidgetOptions,
  getAgentDir,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  hyperlink,
  stripTerminalSequences,
  type TUI,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { loadAgentMentions } from "../mentions/agent-mentions";
import { paintDockBottomEdge, paintDockRow } from "./dock-rendering";
import { type SubagentSessionTarget, subagentSessionUrl } from "./subagent-session-target";
import { rememberSubagentTranscriptRecord } from "./subagent-transcript-records";
import { colorizeHex } from "./terminal-color";

const AGENT_WIDGET_KEY = "agents";
const TODO_WIDGET_KEY = "rpiv-todos";
const FRAMED_WIDGET_KEYS = new Set([AGENT_WIDGET_KEY, TODO_WIDGET_KEY]);
const WIDGET_PADDING_X = 2;
const AGENT_WIDGET_PATCH = Symbol.for("dotfiles:pi-subagent-widget-frame");
const SUBAGENTS_SERVICE_KEY = Symbol.for("@gotgenes/pi-subagents:service");
const AGENT_HEADER_PATTERN = /^(?:├─|└─)\s+\S+\s+/;
const AGENT_ACTIVITY_PATTERN = /^\s*(?:│\s*)?⎿\s/;
const DESCRIPTION_MATCH_CHARS = 12;
const PATCH_VERSION = 2;

type WidgetComponent = Component & { dispose?(): void };
type WidgetFactory = (tui: TUI, theme: Theme) => WidgetComponent;
type WidgetContent = string[] | WidgetFactory | undefined;
type SetWidget = (key: string, content: WidgetContent, options?: ExtensionWidgetOptions) => void;
export type AgentWidgetColors = ReadonlyMap<string, string>;
export type AgentWidgetDisplayNames = ReadonlyMap<string, string>;

export interface AgentWidgetMetadata {
  colors: AgentWidgetColors;
  displayNames: AgentWidgetDisplayNames;
}

export interface WidgetSubagentRecord {
  id: string;
  type: string;
  description: string;
  status: string;
  isBackground: boolean;
  completedAt?: number;
  outputFile?: string;
}

interface WidgetSubagentsService {
  listAgents(): WidgetSubagentRecord[];
}

export interface SubagentWidgetFrameOptions {
  cwd?: string;
  agentDirectory?: string;
  agentColors?: AgentWidgetColors;
  agentDisplayNames?: AgentWidgetDisplayNames;
  loadAgentMetadata?: () => AgentWidgetMetadata;
  getSubagents?: () => readonly WidgetSubagentRecord[];
  sessionId?: string;
}

type PatchableUI = ExtensionUIContext &
  Record<symbol, unknown> & {
    setWidget: SetWidget;
  };

interface WidgetPatchState {
  version: typeof PATCH_VERSION;
  registrations: Array<{
    owner: symbol;
    wrap: (key: string, factory: WidgetFactory) => WidgetFactory;
  }>;
  originalSetWidget: SetWidget;
  patchedSetWidget: SetWidget;
}

class WidgetFrame implements Component {
  constructor(
    private readonly component: WidgetComponent,
    private readonly theme: Theme,
    private readonly getAgentMetadata: () => AgentWidgetMetadata,
    private readonly getSubagents: () => readonly WidgetSubagentRecord[],
    private readonly sessionId: string,
    private readonly colorizeLines: boolean,
  ) {}

  render(width: number): string[] {
    if (width <= 0) return this.component.render(width);

    const paddingX = width >= WIDGET_PADDING_X * 2 + 1 ? WIDGET_PADDING_X : 0;
    const contentWidth = width - paddingX * 2;
    const backgroundAnsi = this.theme.getBgAnsi("toolPendingBg");
    // The underlying widget may render against the terminal width, so clip its
    // output here before adding the panel inset.
    const renderedContent = this.component.render(contentWidth);
    // The todo widget can be asked to render after its list empties, before
    // the host removes the old widget slot; do not leave its frame behind.
    if (renderedContent.length === 0) return [];
    // A widget may provide a full trailing spacer; consume it so the dock edge
    // below is the only bottom spacing and remains half-height.
    const contentToRender =
      renderedContent.at(-1) === "" ? renderedContent.slice(0, -1) : renderedContent;
    const agentMetadata = this.colorizeLines ? this.getAgentMetadata() : undefined;
    let content = contentToRender
      .map((line) =>
        agentMetadata === undefined
          ? line
          : colorizeSubagentWidgetLine(line, agentMetadata.colors, this.theme),
      )
      .map((line) => truncateToWidth(line, contentWidth, ""));
    if (agentMetadata !== undefined) {
      let subagents: readonly WidgetSubagentRecord[] = [];
      try {
        subagents = this.getSubagents();
        for (const record of subagents) rememberSubagentTranscriptRecord(this.sessionId, record);
      } catch {
        // Keep the prompt usable if the optional cross-extension service is reloading.
      }
      content = linkSubagentWidgetLines(content, subagents, agentMetadata.displayNames);
    }
    content = content.map((line) => `${" ".repeat(paddingX)}${line}`);
    const rows = ["", ...content].map((line) => paintDockRow(line, width, "", backgroundAnsi, ""));

    return [...rows, paintDockBottomEdge(width, "", "", backgroundAnsi)];
  }

  invalidate(): void {
    this.component.invalidate();
  }

  dispose(): void {
    this.component.dispose?.();
  }
}

function frameWidget(
  factory: WidgetFactory,
  getAgentMetadata: () => AgentWidgetMetadata,
  getSubagents: () => readonly WidgetSubagentRecord[],
  sessionId: string,
  colorizeLines: boolean,
): WidgetFactory {
  return (tui, theme) =>
    new WidgetFrame(
      factory(tui, theme),
      theme,
      getAgentMetadata,
      getSubagents,
      sessionId,
      colorizeLines,
    );
}

function widgetMetadataFromMentions(
  mentions: ReturnType<typeof loadAgentMentions>,
): AgentWidgetMetadata {
  const colors = new Map<string, string>();
  const displayNames = new Map<string, string>();
  for (const mention of mentions) {
    if (mention.color !== undefined) {
      colors.set(mention.name, mention.color);
      if (mention.displayName !== undefined) colors.set(mention.displayName, mention.color);
    }
    displayNames.set(mention.name.toLowerCase(), mention.displayName ?? mention.name);
  }
  return { colors, displayNames };
}

export function loadAgentWidgetColors(cwd: string, agentDirectory: string): AgentWidgetColors {
  return widgetMetadataFromMentions(loadAgentMentions(cwd, agentDirectory)).colors;
}

export function loadAgentWidgetDisplayNames(
  cwd: string,
  agentDirectory: string,
): AgentWidgetDisplayNames {
  return widgetMetadataFromMentions(loadAgentMentions(cwd, agentDirectory)).displayNames;
}

function publishedWidgetSubagentsService(): WidgetSubagentsService | undefined {
  return (globalThis as Record<symbol, unknown>)[SUBAGENTS_SERVICE_KEY] as
    | WidgetSubagentsService
    | undefined;
}

function widgetSubagents(
  capturedService: WidgetSubagentsService | undefined,
): readonly WidgetSubagentRecord[] {
  const records: WidgetSubagentRecord[] = [];
  const seenIds = new Set<string>();
  const currentService = publishedWidgetSubagentsService();
  const services =
    capturedService === currentService ? [capturedService] : [capturedService, currentService];
  for (const service of services) {
    if (service === undefined) continue;
    try {
      for (const record of service.listAgents()) {
        if (seenIds.has(record.id)) continue;
        seenIds.add(record.id);
        records.push(record);
      }
    } catch {
      // Another observed service generation can still identify the rendered row.
    }
  }
  return records;
}

function widgetTarget(
  record: WidgetSubagentRecord,
  displayNames: AgentWidgetDisplayNames,
): SubagentSessionTarget {
  return {
    agentId: record.id,
    displayName: displayNames.get(record.type.toLowerCase()) ?? record.type,
    description: record.description,
  };
}

function matchingRecordIndex(
  records: readonly WidgetSubagentRecord[],
  header: string,
  displayNames: AgentWidgetDisplayNames,
  allowOrderFallback: boolean,
): number | undefined {
  const nameMatches = records.flatMap((record, index) => {
    const name = displayNames.get(record.type.toLowerCase()) ?? record.type;
    const nextCharacter = header[name.length];
    return header.startsWith(name) && (nextCharacter === undefined || /\s/.test(nextCharacter))
      ? [index]
      : [];
  });
  const fullDescriptionMatches = nameMatches.filter((index) => {
    const description = records[index]?.description ?? "";
    return description.length > 0 && header.includes(description);
  });
  if (fullDescriptionMatches.length === 1) return fullDescriptionMatches[0];

  const descriptionMatches = nameMatches.filter((index) => {
    const description = records[index]?.description ?? "";
    const prefixLength = Math.min(description.length, DESCRIPTION_MATCH_CHARS);
    return prefixLength > 0 && header.includes(description.slice(0, prefixLength));
  });
  if (descriptionMatches.length === 1) return descriptionMatches[0];
  if (allowOrderFallback && descriptionMatches.length > 0) return descriptionMatches[0];
  if (nameMatches.length === 1) return nameMatches[0];
  return allowOrderFallback ? nameMatches[0] : undefined;
}

export function linkSubagentWidgetLines(
  lines: readonly string[],
  records: readonly WidgetSubagentRecord[],
  displayNames: AgentWidgetDisplayNames,
): string[] {
  // Queued agents render as one aggregate row with no identity, so only rows that
  // can be mapped to one session receive links.
  const finished = records.filter(
    (record) =>
      record.isBackground &&
      record.completedAt !== undefined &&
      record.status !== "running" &&
      record.status !== "queued",
  );
  const running = records.filter((record) => record.isBackground && record.status === "running");

  const linked = [...lines];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    const plainLine = stripTerminalSequences(line).trimStart();
    const prefix = AGENT_HEADER_PATTERN.exec(plainLine)?.[0];
    if (prefix === undefined) continue;
    const isRunning = AGENT_ACTIVITY_PATTERN.test(
      stripTerminalSequences(lines[lineIndex + 1] ?? ""),
    );
    const candidates = isRunning ? running : finished;
    // Running rows preserve service order. Completed records can outlive the widget,
    // so ambiguous completed rows stay unlinked instead of opening the wrong session.
    const candidateIndex = matchingRecordIndex(
      candidates,
      plainLine.slice(prefix.length),
      displayNames,
      isRunning,
    );
    if (candidateIndex === undefined) continue;
    const [record] = candidates.splice(candidateIndex, 1);
    if (record === undefined) continue;
    const url = subagentSessionUrl(widgetTarget(record, displayNames));
    linked[lineIndex] = hyperlink(line, url);
    const activityLine = lines[lineIndex + 1];
    if (isRunning && activityLine !== undefined) {
      linked[lineIndex + 1] = hyperlink(activityLine, url);
    }
  }
  return linked;
}

/** Apply explicit agent colors to header lines while preserving the widget's own styling. */
function colorizeAgentHeaderLine(
  line: string,
  agentColors: AgentWidgetColors,
  theme: Theme,
  headerPattern: RegExp,
): string {
  const plainLine = stripTerminalSequences(line).trimStart();
  const headerPrefix = headerPattern.exec(plainLine)?.[0];
  if (headerPrefix === undefined) return line;

  const headerText = plainLine.slice(headerPrefix.length);
  const names = [...agentColors.keys()].sort((left, right) => right.length - left.length);
  for (const name of names) {
    const nextCharacter = headerText[name.length];
    if (
      headerText.startsWith(name) === false ||
      (nextCharacter !== undefined && /\s/.test(nextCharacter) === false)
    ) {
      continue;
    }
    const start = line.indexOf(name);
    const color = agentColors.get(name);
    if (start === -1 || color === undefined) continue;
    return `${line.slice(0, start)}${colorizeHex(theme, color)(name)}${line.slice(start + name.length)}`;
  }
  return line;
}

export function colorizeSubagentWidgetLine(
  line: string,
  agentColors: AgentWidgetColors,
  theme: Theme,
): string {
  return colorizeAgentHeaderLine(line, agentColors, theme, /^(?:├─|└─)\s+\S+\s+/);
}

export function colorizeSubagentToolLine(
  line: string,
  agentColors: AgentWidgetColors,
  theme: Theme,
): string {
  return colorizeAgentHeaderLine(line, agentColors, theme, /^▸\s+/);
}

function isCurrentPatchState(value: unknown): value is WidgetPatchState {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === PATCH_VERSION
  );
}

function restoreLegacyWidgetPatch(ui: PatchableUI, installedState: unknown): void {
  if (typeof installedState !== "object" || installedState === null) return;
  if (
    "originalSetWidget" in installedState &&
    typeof installedState.originalSetWidget === "function"
  ) {
    ui.setWidget = installedState.originalSetWidget as SetWidget;
  }
  ui[AGENT_WIDGET_PATCH] = undefined;
}

function uninstallWidgetPatch(ui: PatchableUI, state: WidgetPatchState, owner: symbol): void {
  const index = state.registrations.findIndex((registration) => registration.owner === owner);
  if (index >= 0) state.registrations.splice(index, 1);
  if (state.registrations.length > 0) return;
  if (ui.setWidget === state.patchedSetWidget) ui.setWidget = state.originalSetWidget;
  if (ui[AGENT_WIDGET_PATCH] === state) ui[AGENT_WIDGET_PATCH] = undefined;
}

export function installSubagentWidgetFrame(
  uiContext: ExtensionUIContext,
  options: SubagentWidgetFrameOptions = {},
): () => void {
  const ui = uiContext as PatchableUI;
  const cwd = options.cwd ?? process.cwd();
  const agentDirectory = options.agentDirectory ?? getAgentDir();
  let loadedMetadata: AgentWidgetMetadata | undefined;
  const getAgentMetadata = (): AgentWidgetMetadata => {
    if (loadedMetadata === undefined) {
      loadedMetadata = (
        options.loadAgentMetadata ??
        (() => widgetMetadataFromMentions(loadAgentMentions(cwd, agentDirectory)))
      )();
    }
    return {
      colors: options.agentColors ?? loadedMetadata.colors,
      displayNames: options.agentDisplayNames ?? loadedMetadata.displayNames,
    };
  };
  const capturedService = publishedWidgetSubagentsService();
  const getSubagents = options.getSubagents ?? (() => widgetSubagents(capturedService));
  const sessionId = options.sessionId ?? cwd;
  const wrap = (key: string, factory: WidgetFactory) =>
    frameWidget(factory, getAgentMetadata, getSubagents, sessionId, key === AGENT_WIDGET_KEY);
  const registration = { owner: Symbol(), wrap };
  const installedState = ui[AGENT_WIDGET_PATCH];
  if (isCurrentPatchState(installedState)) {
    installedState.registrations.push(registration);
    return () => uninstallWidgetPatch(ui, installedState, registration.owner);
  }
  restoreLegacyWidgetPatch(ui, installedState);

  const originalSetWidget = ui.setWidget;
  const state: WidgetPatchState = {
    version: PATCH_VERSION,
    registrations: [registration],
    originalSetWidget,
    patchedSetWidget: originalSetWidget,
  };
  state.patchedSetWidget = (key, content, options) => {
    const activeWrap = state.registrations.at(-1)?.wrap;
    const framedContent =
      FRAMED_WIDGET_KEYS.has(key) && typeof content === "function" && activeWrap !== undefined
        ? activeWrap(key, content)
        : content;
    state.originalSetWidget.call(ui, key, framedContent, options);
  };

  ui[AGENT_WIDGET_PATCH] = state;
  ui.setWidget = state.patchedSetWidget;
  return () => uninstallWidgetPatch(ui, state, registration.owner);
}
