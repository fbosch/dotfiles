import type {
  ExtensionUIContext,
  ExtensionWidgetOptions,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import {
  DOCK_CHROME_WIDTH,
  DOCK_RAIL,
  DOCK_RIGHT_BORDER,
  paintDockBottomEdge,
  paintDockRow,
} from "./dock-rendering";

const AGENT_WIDGET_KEY = "agents";
const AGENT_WIDGET_PADDING_X = 2;
const AGENT_WIDGET_PATCH = Symbol.for("dotfiles:pi-subagent-widget-frame");
const PATCH_VERSION = 1;

type WidgetComponent = Component & { dispose?(): void };
type WidgetFactory = (tui: TUI, theme: Theme) => WidgetComponent;
type WidgetContent = string[] | WidgetFactory | undefined;
type SetWidget = (key: string, content: WidgetContent, options?: ExtensionWidgetOptions) => void;

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
  ) {}

  render(width: number): string[] {
    if (width <= DOCK_CHROME_WIDTH) return this.component.render(width);

    const availableWidth = width - DOCK_CHROME_WIDTH;
    const paddingX = availableWidth >= AGENT_WIDGET_PADDING_X * 2 + 1 ? AGENT_WIDGET_PADDING_X : 0;
    const contentWidth = availableWidth - paddingX * 2;
    const backgroundAnsi = this.theme.getBgAnsi("toolPendingBg");
    const rail = this.theme.fg("accent", DOCK_RAIL);
    const rightBorder = this.theme.fg("borderMuted", DOCK_RIGHT_BORDER);
    const content = this.component
      .render(contentWidth)
      .map((line) => `${" ".repeat(paddingX)}${line}`);
    const rows = ["", ...content, ""].map((line) =>
      paintDockRow(line, width, rail, backgroundAnsi, rightBorder),
    );

    return [
      ...rows,
      paintDockBottomEdge(
        width,
        this.theme.fg("accent", "▘"),
        this.theme.fg("borderMuted", "▝"),
        backgroundAnsi,
      ),
    ];
  }

  invalidate(): void {
    this.component.invalidate();
  }

  dispose(): void {
    this.component.dispose?.();
  }
}

function frameSubagentWidget(factory: WidgetFactory): WidgetFactory {
  return (tui, theme) => new SubagentWidgetFrame(factory(tui, theme), theme);
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

export function installSubagentWidgetFrame(uiContext: ExtensionUIContext): () => void {
  const ui = uiContext as PatchableUI;
  const owner = Symbol();
  const installedState = ui[AGENT_WIDGET_PATCH];
  if (isCurrentPatchState(installedState)) {
    installedState.wrap = frameSubagentWidget;
    installedState.owners.push(owner);
    return () => uninstallWidgetPatch(ui, installedState, owner);
  }

  const originalSetWidget = ui.setWidget;
  const state: WidgetPatchState = {
    version: PATCH_VERSION,
    owners: [owner],
    originalSetWidget,
    patchedSetWidget: originalSetWidget,
    wrap: frameSubagentWidget,
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
