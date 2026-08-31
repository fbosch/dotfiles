import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
  Component,
  EditorTheme,
  OverlayHandle,
  OverlayOptions,
  TUI,
} from "@earendil-works/pi-tui";
import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { PLAN_MODE_STATUS } from "./plan-mode";

type Color = (text: string) => string;

const EDITOR_PADDING_X = 1;
const DOCK_RAIL = "▌";
const DOCK_RIGHT_BORDER = "▐";
const DOCK_CHROME_WIDTH = visibleWidth(DOCK_RAIL) + visibleWidth(DOCK_RIGHT_BORDER);

export function fitColumns(left: string, right: string, width: number): string {
  if (width <= 0) return "";

  const leftText = truncateToWidth(left, width, "");
  const separatorWidth = leftText.length > 0 && right.length > 0 ? 1 : 0;
  const rightWidth = Math.max(0, width - visibleWidth(leftText) - separatorWidth);
  const rightText = truncateToWidth(right, rightWidth, "");
  const gapWidth = Math.max(0, width - visibleWidth(leftText) - visibleWidth(rightText));

  return `${leftText}${" ".repeat(gapWidth)}${rightText}`;
}

export function paintDockRow(
  content: string,
  width: number,
  rail: string,
  backgroundAnsi: string,
  rightBorder = "",
): string {
  if (width <= 0) return "";

  const fittedRail = truncateToWidth(rail, width, "");
  const fittedRightBorder = truncateToWidth(
    rightBorder,
    Math.max(0, width - visibleWidth(fittedRail)),
    "",
  );
  const contentWidth = Math.max(
    0,
    width - visibleWidth(fittedRail) - visibleWidth(fittedRightBorder),
  );
  const fittedContent = fitColumns(content, "", contentWidth);
  const backgroundContent = fittedContent
    .replaceAll("\u001b[0m", `\u001b[0m${backgroundAnsi}`)
    .replaceAll("\u001b[49m", `\u001b[49m${backgroundAnsi}`);

  return `${fittedRail}${backgroundAnsi}${backgroundContent}\u001b[49m${fittedRightBorder}`;
}

function backgroundToForeground(backgroundAnsi: string): string {
  return backgroundAnsi.replace("\u001b[48;", "\u001b[38;");
}

function foregroundToBackground(foregroundAnsi: string): string {
  return foregroundAnsi.replace("\u001b[38;", "\u001b[48;");
}

export function styleSelectedSuggestion(
  line: string,
  width: number,
  selectedBackgroundAnsi: string,
  selectedForegroundAnsi: string,
): string {
  const match = /^(\s*)→\s(.*)$/.exec(stripTerminalSequences(line));
  if (match === null) return line;

  const content = fitColumns(`${match[1]}  ${match[2]}`, "", width);
  return `${selectedBackgroundAnsi}${selectedForegroundAnsi}${content}\u001b[39m\u001b[49m`;
}

export function paintDockBottomEdge(
  width: number,
  leftBorder: string,
  rightBorder: string,
  backgroundAnsi: string,
): string {
  if (width <= 0) return "";

  const fittedLeftBorder = truncateToWidth(leftBorder, width, "");
  const fittedRightBorder = truncateToWidth(
    rightBorder,
    Math.max(0, width - visibleWidth(fittedLeftBorder)),
    "",
  );
  const edgeWidth = Math.max(
    0,
    width - visibleWidth(fittedLeftBorder) - visibleWidth(fittedRightBorder),
  );
  const backgroundForegroundAnsi = backgroundToForeground(backgroundAnsi);

  return `${fittedLeftBorder}${backgroundForegroundAnsi}${"▀".repeat(edgeWidth)}\u001b[39m${fittedRightBorder}`;
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
  keybindings: KeybindingsManager,
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

function scrollIndicator(line: string): string | undefined {
  const match = /^─── ([↑↓]) (\d+) more(?: ─*)?$/.exec(stripTerminalSequences(line));
  if (match === null) return undefined;
  return `${match[1]} ${match[2]} more`;
}

export function splitEditorLines(
  lines: readonly string[],
  border: Color,
): { content: string[]; suggestions: string[] } {
  if (lines.length < 2) return { content: [...lines], suggestions: [] };

  const bottomBorder = findBottomBorder(lines, border);
  const editorLines = lines.slice(0, bottomBorder + 1);
  const suggestions = lines.slice(bottomBorder + 1);
  const content = editorLines.slice(1, -1);
  const topIndicator = editorLines[0] === undefined ? undefined : scrollIndicator(editorLines[0]);
  const bottomLine = editorLines[editorLines.length - 1];
  const bottomIndicator = bottomLine === undefined ? undefined : scrollIndicator(bottomLine);

  if (topIndicator !== undefined) content.unshift(topIndicator);
  if (bottomIndicator !== undefined) content.push(bottomIndicator);

  return { content, suggestions };
}

export function suggestionOverlayOffset(dockRowCount: number): number {
  return -(Math.max(0, dockRowCount) + 1);
}

export function findBottomBorder(lines: readonly string[], border: Color): number {
  for (let index = lines.length - 1; index > 0; index -= 1) {
    const line = lines[index];
    if (line === undefined) continue;

    const plain = stripTerminalSequences(line);
    const isBorder = /^─+$/.test(plain) || /^─── [↑↓] \d+ more ─*$/.test(plain);
    const styledCells = [...plain].map(border).join("");
    if (isBorder && (line === border(plain) || line === styledCells)) return index;
  }

  return lines.length - 1;
}

export default function promptUi(pi: ExtensionAPI) {
  let isWorking = false;
  let activeTui: TUI | undefined;
  let disposePromptEditor = () => {};
  let getBranch = (): string | null => null;
  let getStatuses = (): readonly string[] => [];

  pi.on("agent_start", () => {
    isWorking = true;
    activeTui?.requestRender();
  });

  pi.on("agent_settled", () => {
    isWorking = false;
    activeTui?.requestRender();
  });

  pi.on("session_shutdown", () => {
    disposePromptEditor();
    disposePromptEditor = () => {};
    activeTui = undefined;
  });

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    ctx.ui.setWorkingVisible(false);
    ctx.ui.setFooter((tui, _theme, footerData) => {
      getBranch = () => footerData.getGitBranch();
      getStatuses = () => [...footerData.getExtensionStatuses().values()];
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

      return {
        render: () => [],
        invalidate: () => tui.requestRender(),
        dispose: () => {
          unsubscribe();
          getBranch = () => null;
          getStatuses = () => [];
        },
      };
    });

    class PromptEditor extends CustomEditor {
      private readonly bindings: KeybindingsManager;
      private readonly suggestionsOverlay: Component & {
        lines: string[];
        rail: string;
        rightBorder: string;
        backgroundAnsi: string;
        selectedBackgroundAnsi: string;
        selectedForegroundAnsi: string;
      };
      private readonly suggestionsOverlayOptions: OverlayOptions = {
        anchor: "bottom-left",
        col: 0,
        nonCapturing: true,
      };
      private suggestionsOverlayHandle: OverlayHandle | undefined;

      constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
        super(tui, theme, keybindings, { paddingX: EDITOR_PADDING_X });
        this.bindings = keybindings;
        this.suggestionsOverlay = {
          lines: [],
          rail: "",
          rightBorder: "",
          backgroundAnsi: "",
          selectedBackgroundAnsi: "",
          selectedForegroundAnsi: "",
          render(width) {
            const contentWidth = Math.max(
              0,
              width - visibleWidth(this.rail) - visibleWidth(this.rightBorder),
            );
            return this.lines.map((line) => {
              const styledLine = styleSelectedSuggestion(
                line,
                contentWidth,
                this.selectedBackgroundAnsi,
                this.selectedForegroundAnsi,
              );
              return paintDockRow(
                styledLine,
                width,
                this.rail,
                this.backgroundAnsi,
                this.rightBorder,
              );
            });
          },
          invalidate() {},
        };
        disposePromptEditor = () => this.dispose();
        activeTui = tui;
      }

      dispose(): void {
        this.suggestionsOverlayHandle?.hide();
        this.suggestionsOverlayHandle = undefined;
      }

      // Pi copies its default padding after the editor factory returns.
      setPaddingX(_padding: number): void {
        super.setPaddingX(EDITOR_PADDING_X);
      }

      private updateSuggestionsOverlay(
        suggestions: readonly string[],
        width: number,
        dockRowCount: number,
      ): void {
        this.suggestionsOverlay.lines = [...suggestions];
        if (suggestions.length === 0) {
          this.suggestionsOverlayHandle?.setHidden(true);
          return;
        }

        this.suggestionsOverlayOptions.width = width;
        this.suggestionsOverlayOptions.offsetY = suggestionOverlayOffset(dockRowCount);
        if (this.suggestionsOverlayHandle === undefined) {
          this.suggestionsOverlayHandle = this.tui.showOverlay(
            this.suggestionsOverlay,
            this.suggestionsOverlayOptions,
          );
          return;
        }

        this.suggestionsOverlayHandle.setHidden(false);
      }

      render(width: number): string[] {
        if (width <= DOCK_CHROME_WIDTH) {
          this.updateSuggestionsOverlay([], width, 0);
          return super.render(width);
        }

        const theme = ctx.ui.theme;
        const statuses = getStatuses()
          .map(sanitizeStatus)
          .filter((status) => status.length > 0);
        const isPlanMode = statuses.includes(PLAN_MODE_STATUS);
        const modeColor = isPlanMode
          ? theme.getThinkingBorderColor("high")
          : (text: string) => theme.fg("accent", text);
        const border = isPlanMode ? modeColor : (text: string) => this.borderColor(text);
        const editorBorder = (text: string) => this.borderColor(text);
        const editorWidth = width - DOCK_CHROME_WIDTH;
        // Pi renders its internal editor border with the thinking color, even in Plan mode.
        const { content, suggestions } = splitEditorLines(super.render(editorWidth), editorBorder);
        const branch = getBranch();
        const modeLabel = isPlanMode ? PLAN_MODE_STATUS : "Build";
        const model = ctx.model;
        const thinkingLevel = pi.getThinkingLevel();
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
        const location = `${formatCwd(ctx.cwd)}${branch ? ` (${branch})` : ""}`;
        const modelRight = theme.fg("muted", `${formatContext(ctx)} · ${location} `);
        const modelRow = fitColumns(modelLeft, modelRight, editorWidth);
        const inputRail = border(DOCK_RAIL);
        const suggestionsRail = theme.fg("borderMuted", DOCK_RAIL);
        const rightBorder = theme.fg("borderMuted", DOCK_RIGHT_BORDER);
        const backgroundAnsi = theme.getBgAnsi("userMessageBg");
        const dockRows = ["", ...content, "", modelRow].map((line) =>
          paintDockRow(line, width, inputRail, backgroundAnsi, rightBorder),
        );
        const bottomEdge = paintDockBottomEdge(
          width,
          border("▘"),
          theme.fg("borderMuted", "▝"),
          backgroundAnsi,
        );
        const interruptHint = keyHint(this.bindings, "app.interrupt", "interrupt");
        const statusText = statuses.filter((status) => status !== PLAN_MODE_STATUS).join(" · ");
        const workingText = isWorking
          ? [theme.fg("accent", "● working"), interruptHint].filter(Boolean).join("  ")
          : "";
        const hintLeft = [workingText, statusText].filter(Boolean).join(" · ");
        const hintRight = [
          keyHint(this.bindings, "app.thinking.cycle", "thinking"),
          keyHint(this.bindings, "app.model.select", "models"),
          keyHint(this.bindings, "tui.input.tab", "complete"),
        ]
          .filter(Boolean)
          .join("  ");
        const hints = fitColumns(
          theme.fg("muted", ` ${hintLeft}`),
          theme.fg("muted", `${hintRight} `),
          width,
        );
        const promptLayout = [...dockRows, bottomEdge, hints];

        this.suggestionsOverlay.rail = suggestionsRail;
        this.suggestionsOverlay.rightBorder = rightBorder;
        this.suggestionsOverlay.backgroundAnsi = backgroundAnsi;
        this.suggestionsOverlay.selectedBackgroundAnsi = foregroundToBackground(
          theme.getFgAnsi("accent"),
        );
        this.suggestionsOverlay.selectedForegroundAnsi = backgroundToForeground(backgroundAnsi);

        // Pi appends autocomplete to the editor render. Move only that tail into
        // a non-capturing overlay so it grows upward without moving the dock.
        this.updateSuggestionsOverlay(suggestions, width, promptLayout.length);
        return promptLayout;
      }
    }

    ctx.ui.setEditorComponent(
      (tui, theme, keybindings) => new PromptEditor(tui, theme, keybindings),
    );
  });
}
