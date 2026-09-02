import {
  type ExtensionUIContext,
  type ExtensionWidgetOptions,
  getAgentDir,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  stripTerminalSequences,
  type TUI,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { loadAgentMentions } from "../mentions/agent-mentions";
import { paintDockBottomEdge, paintDockRow } from "./dock-rendering";
import { colorizeHex } from "./terminal-color";

const AGENT_WIDGET_KEY = "agents";
const AGENT_WIDGET_PADDING_X = 2;
const AGENT_WIDGET_PATCH = Symbol.for("dotfiles:pi-subagent-widget-frame");
const PATCH_VERSION = 1;

type WidgetComponent = Component & { dispose?(): void };
type WidgetFactory = (tui: TUI, theme: Theme) => WidgetComponent;
type WidgetContent = string[] | WidgetFactory | undefined;
type SetWidget = (key: string, content: WidgetContent, options?: ExtensionWidgetOptions) => void;
export type AgentWidgetColors = ReadonlyMap<string, string>;

export interface SubagentWidgetFrameOptions {
  cwd?: string;
  agentDirectory?: string;
  agentColors?: AgentWidgetColors;
}

type PatchableUI = ExtensionUIContext &
  Record<symbol, unknown> & {
    setWidget: SetWidget;
  };

interface WidgetPatchState {
  version: typeof PATCH_VERSION;
  owners: symbol[];
  originalSetWidget: SetWidget;
  patchedSetWidget: SetWidget;
  wrap: (factory: WidgetFactory) => WidgetFactory;
}

class SubagentWidgetFrame implements Component {
  constructor(
    private readonly component: WidgetComponent,
    private readonly theme: Theme,
    private readonly agentColors: AgentWidgetColors,
  ) {}

  render(width: number): string[] {
    if (width <= 0) return this.component.render(width);

    const paddingX = width >= AGENT_WIDGET_PADDING_X * 2 + 1 ? AGENT_WIDGET_PADDING_X : 0;
    const contentWidth = width - paddingX * 2;
    const backgroundAnsi = this.theme.getBgAnsi("toolPendingBg");
    // pi-subagents currently renders against the terminal width, so clip its
    // output here before adding the panel inset.
    const content = this.component
      .render(contentWidth)
      .map((line) => colorizeSubagentWidgetLine(line, this.agentColors, this.theme))
      .map((line) => `${" ".repeat(paddingX)}${truncateToWidth(line, contentWidth, "")}`);
    const rows = ["", ...content, ""].map((line) =>
      paintDockRow(line, width, "", backgroundAnsi, ""),
    );

    return [...rows, paintDockBottomEdge(width, "", "", backgroundAnsi)];
  }

  invalidate(): void {
    this.component.invalidate();
  }

  dispose(): void {
    this.component.dispose?.();
  }
}

function frameSubagentWidget(
  factory: WidgetFactory,
  agentColors: AgentWidgetColors,
): WidgetFactory {
  return (tui, theme) => new SubagentWidgetFrame(factory(tui, theme), theme, agentColors);
}

function loadAgentWidgetColors(cwd: string, agentDirectory: string): AgentWidgetColors {
  const colors = new Map<string, string>();
  for (const mention of loadAgentMentions(cwd, agentDirectory)) {
    if (mention.color === undefined) continue;
    colors.set(mention.name, mention.color);
    if (mention.displayName !== undefined) colors.set(mention.displayName, mention.color);
  }
  return colors;
}

/** Apply explicit agent colors to header lines while preserving the widget's own styling. */
export function colorizeSubagentWidgetLine(
  line: string,
  agentColors: AgentWidgetColors,
  theme: Theme,
): string {
  const plainLine = stripTerminalSequences(line).trimStart();
  const headerPrefix = /^(?:├─|└─)\s+\S+\s+/.exec(plainLine)?.[0];
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

function isCurrentPatchState(value: unknown): value is WidgetPatchState {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === PATCH_VERSION
  );
}

function uninstallWidgetPatch(ui: PatchableUI, state: WidgetPatchState, owner: symbol): void {
  const index = state.owners.indexOf(owner);
  if (index >= 0) state.owners.splice(index, 1);
  if (state.owners.length > 0) return;
  if (ui.setWidget === state.patchedSetWidget) ui.setWidget = state.originalSetWidget;
  if (ui[AGENT_WIDGET_PATCH] === state) ui[AGENT_WIDGET_PATCH] = undefined;
}

export function installSubagentWidgetFrame(
  uiContext: ExtensionUIContext,
  options: SubagentWidgetFrameOptions = {},
): () => void {
  const ui = uiContext as PatchableUI;
  const agentColors =
    options.agentColors ??
    loadAgentWidgetColors(options.cwd ?? process.cwd(), options.agentDirectory ?? getAgentDir());
  const wrap = (factory: WidgetFactory) => frameSubagentWidget(factory, agentColors);
  const owner = Symbol();
  const installedState = ui[AGENT_WIDGET_PATCH];
  if (isCurrentPatchState(installedState)) {
    installedState.wrap = wrap;
    installedState.owners.push(owner);
    return () => uninstallWidgetPatch(ui, installedState, owner);
  }

  const originalSetWidget = ui.setWidget;
  const state: WidgetPatchState = {
    version: PATCH_VERSION,
    owners: [owner],
    originalSetWidget,
    patchedSetWidget: originalSetWidget,
    wrap,
  };
  state.patchedSetWidget = (key, content, options) => {
    const framedContent =
      key === AGENT_WIDGET_KEY && typeof content === "function" ? state.wrap(content) : content;
    state.originalSetWidget.call(ui, key, framedContent, options);
  };

  ui[AGENT_WIDGET_PATCH] = state;
  ui.setWidget = state.patchedSetWidget;
  return () => uninstallWidgetPatch(ui, state, owner);
}
