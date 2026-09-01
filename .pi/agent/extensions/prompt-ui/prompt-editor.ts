import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteProvider, EditorTheme, TUI } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import { PLAN_MODE_STATUS } from "../plan-mode";
import {
  AutocompleteOverlay,
  createAliasAutocompleteProvider,
  splitEditorLines,
} from "./autocomplete";
import {
  backgroundToForeground,
  fitColumns,
  foregroundToBackground,
  paintDockBottomEdge,
  paintDockRow,
} from "./dock-rendering";

const EDITOR_PADDING_X = 1;
const DOCK_RAIL = "▌";
const DOCK_RIGHT_BORDER = "▐";
const DOCK_CHROME_WIDTH = visibleWidth(DOCK_RAIL) + visibleWidth(DOCK_RIGHT_BORDER);

export interface PromptEditorState {
  isWorking(): boolean;
  getBranch(): string | null;
  getStatuses(): readonly string[];
}

interface PromptKeybindings {
  getKeys(
    action: "app.interrupt" | "app.model.select" | "app.thinking.cycle" | "tui.input.tab",
  ): string[];
}

function formatCwd(cwd: string): string {
  const home = process.env.HOME;
  if (home === undefined) return cwd;
  if (cwd === home) return "~";
  if (cwd.startsWith(`${home}/`)) return `~${cwd.slice(home.length)}`;
  return cwd;
}

function formatContext(ctx: ExtensionContext): string {
  const usage = ctx.getContextUsage();
  if (usage?.percent === null || usage?.percent === undefined) return "ctx ?";
  return `ctx ${Math.round(usage.percent)}%`;
}

function formatProvider(provider: string): string {
  if (provider === "openai" || provider === "openai-codex") return "OpenAI";
  return provider
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function formatKey(key: string): string {
  return key === "escape" ? "esc" : key;
}

function keyHint(
  keybindings: PromptKeybindings,
  action: "app.interrupt" | "app.model.select" | "app.thinking.cycle" | "tui.input.tab",
  description: string,
): string {
  const key = keybindings.getKeys(action)[0];
  return key === undefined ? "" : `${formatKey(key)} ${description}`;
}

function sanitizeStatus(status: string): string {
  return status
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

export function renderPromptHints(
  theme: Theme,
  keybindings: PromptKeybindings,
  promptState: PromptEditorState,
  width: number,
): string {
  const statuses = promptState
    .getStatuses()
    .map(sanitizeStatus)
    .filter((status) => status.length > 0);
  const interruptHint = keyHint(keybindings, "app.interrupt", "interrupt");
  const statusText = statuses.filter((status) => status !== PLAN_MODE_STATUS).join(" · ");
  const workingText = promptState.isWorking()
    ? [theme.fg("accent", "● working"), interruptHint].filter(Boolean).join("  ")
    : "";
  const hintLeft = [workingText, statusText].filter(Boolean).join(" · ");
  const hintRight = [
    keyHint(keybindings, "app.thinking.cycle", "thinking"),
    keyHint(keybindings, "app.model.select", "models"),
    keyHint(keybindings, "tui.input.tab", "complete"),
  ]
    .filter(Boolean)
    .join("  ");

  return fitColumns(theme.fg("muted", ` ${hintLeft}`), theme.fg("muted", `${hintRight} `), width);
}

export class PromptEditor extends CustomEditor {
  private readonly pi: ExtensionAPI;
  private readonly ctx: ExtensionContext;
  private readonly promptState: PromptEditorState;
  private readonly autocompleteOverlay: AutocompleteOverlay;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    state: PromptEditorState,
  ) {
    super(tui, theme, keybindings, { paddingX: EDITOR_PADDING_X });
    this.pi = pi;
    this.ctx = ctx;
    this.promptState = state;
    this.autocompleteOverlay = new AutocompleteOverlay(tui);
  }

  dispose(): void {
    this.autocompleteOverlay.dispose();
  }

  // Pi copies its default padding after the editor factory returns.
  setPaddingX(_padding: number): void {
    super.setPaddingX(EDITOR_PADDING_X);
  }

  setAutocompleteProvider(provider: AutocompleteProvider): void {
    super.setAutocompleteProvider(createAliasAutocompleteProvider(provider));
  }

  render(width: number): string[] {
    if (width <= DOCK_CHROME_WIDTH) {
      this.autocompleteOverlay.hide();
      return super.render(width);
    }

    const theme = this.ctx.ui.theme;
    const statuses = this.promptState
      .getStatuses()
      .map(sanitizeStatus)
      .filter((status) => status.length > 0);
    const isPlanMode = statuses.includes(PLAN_MODE_STATUS);
    const modeColor = isPlanMode
      ? theme.getThinkingBorderColor("high")
      : (text: string) => theme.fg("accent", text);
    const editorBorder = (text: string) => this.borderColor(text);
    const editorWidth = width - DOCK_CHROME_WIDTH;
    // Pi renders its internal editor border with the thinking color, even in Plan mode.
    const { content, suggestions } = splitEditorLines(super.render(editorWidth), editorBorder);
    const branch = this.promptState.getBranch();
    const modeLabel = isPlanMode ? PLAN_MODE_STATUS : "Build";
    const model = this.ctx.model;
    const thinkingLevel = this.pi.getThinkingLevel();
    const separator = theme.fg("dim", " · ");
    const modelLeft =
      model === undefined
        ? theme.fg("muted", " No model")
        : [
            modeColor(` ${modeLabel}`),
            separator,
            theme.fg("text", model.name),
            " ",
            theme.fg("muted", formatProvider(model.provider)),
            separator,
            theme.getThinkingBorderColor(thinkingLevel)(thinkingLevel),
          ].join("");
    const location = `${formatCwd(this.ctx.cwd)}${branch ? ` (${branch})` : ""}`;
    const modelRight = theme.fg("muted", `${formatContext(this.ctx)} · ${location} `);
    const modelRow = fitColumns(modelLeft, modelRight, editorWidth);
    const inputRail = modeColor(DOCK_RAIL);
    const suggestionsRail = theme.fg("borderMuted", DOCK_RAIL);
    const rightBorder = theme.fg("borderMuted", DOCK_RIGHT_BORDER);
    const backgroundAnsi = theme.getBgAnsi("userMessageBg");
    const dockRows = ["", ...content, "", modelRow].map((line) =>
      paintDockRow(line, width, inputRail, backgroundAnsi, rightBorder),
    );
    const bottomEdge = paintDockBottomEdge(
      width,
      modeColor("▘"),
      theme.fg("borderMuted", "▝"),
      backgroundAnsi,
    );
    const promptLayout = [...dockRows, bottomEdge];

    this.autocompleteOverlay.update(suggestions, width, promptLayout.length, {
      rail: suggestionsRail,
      rightBorder,
      backgroundAnsi,
      selectedBackgroundAnsi: foregroundToBackground(theme.getFgAnsi("accent")),
      selectedForegroundAnsi: backgroundToForeground(backgroundAnsi),
    });
    return promptLayout;
  }
}
