import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type Color = (text: string) => string;

function fitBorder(
  left: string,
  right: string,
  width: number,
  border: Color,
  fill: Color = border,
): string {
  if (width <= 0) return "";
  if (width === 1) return border("─");

  const contentWidth = width - 2;
  const leftText = truncateToWidth(left, contentWidth, "");
  const rightWidth = Math.max(0, contentWidth - visibleWidth(leftText) - 1);
  const rightText = truncateToWidth(right, rightWidth, "");
  const gapWidth = Math.max(0, contentWidth - visibleWidth(leftText) - visibleWidth(rightText));

  return `${border("─")}${leftText}${fill("─".repeat(gapWidth))}${rightText}${border("─")}`;
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

function formatModel(ctx: ExtensionContext, pi: ExtensionAPI): string {
  if (ctx.model === undefined) return "no model";
  return `${ctx.model.provider}/${ctx.model.id} · ${pi.getThinkingLevel()}`;
}

export function findBottomBorder(lines: readonly string[], border: Color): number {
  for (let index = lines.length - 1; index > 0; index -= 1) {
    const line = lines[index];
    if (line === undefined) continue;

    const plain = stripTerminalSequences(line);
    const isBorder = /^─+$/.test(plain) || /^─── [↑↓] \d+ more ─*$/.test(plain);
    if (isBorder && line === border(plain)) return index;
  }

  return lines.length - 1;
}

export default function promptUi(pi: ExtensionAPI) {
  let isWorking = false;
  let activeTui: TUI | undefined;
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
      constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
        super(tui, theme, keybindings);
        activeTui = tui;
      }

      render(width: number): string[] {
        const lines = super.render(width);
        if (lines.length < 2) return lines;

        const theme = ctx.ui.theme;
        const border = (text: string) => this.borderColor(text);
        const bottomBorder = findBottomBorder(lines, border);
        const editorLines = lines.slice(0, bottomBorder + 1);
        const suggestions = lines.slice(bottomBorder + 1);
        const branch = getBranch();
        const statuses = getStatuses().filter((status) => status.length > 0);
        const topLeft = isWorking ? theme.fg("accent", " ● working ") : "";
        const topRight = statuses.length > 0 ? theme.fg("muted", ` ${statuses.join(" · ")} `) : "";
        const bottomLeft = theme.fg("muted", ` ${formatModel(ctx, pi)} `);
        const location = `${formatCwd(ctx.cwd)}${branch ? ` (${branch})` : ""}`;
        const bottomRight = theme.fg("muted", ` ${formatContext(ctx)} · ${location} `);

        editorLines[0] = fitBorder(topLeft, topRight, width, border);
        editorLines[editorLines.length - 1] = fitBorder(bottomLeft, bottomRight, width, border);

        // Pi has no autocomplete-placement option and appends suggestions after
        // the editor. Move only that rendered tail so the bottom dock stays fixed.
        return [...suggestions, ...editorLines];
      }
    }

    ctx.ui.setEditorComponent(
      (tui, theme, keybindings) => new PromptEditor(tui, theme, keybindings),
    );
  });
}
