import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type AutocompleteProvider,
  type EditorTheme,
  stripTerminalSequences,
  type TUI,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  type AgentMention,
  agentMentionForegroundAnsi,
  formatAnsiAgentMentions,
  loadAgentMentions,
  pathShadowsAgentMention,
} from "../mentions/agent-mentions";
import {
  assertNoAgentMentionCollisions,
  formatAnsiReferenceMentions,
  loadProjectReferences,
  type ProjectReference,
} from "../mentions/project-references";
import { getModeColor, PLAN_MODE_STATUS } from "../plan-mode";
import { correctedPromptForInput, type TypoCorrectionRules } from "../typo-abolish";
import { YOLO_STATUS_KEY, YOLO_STATUS_TEXT } from "../yolo";
import {
  AutocompleteOverlay,
  createPromptAutocompleteProvider,
  splitEditorLines,
} from "./autocomplete";
import { contextIndicator } from "./context-health";
import {
  backgroundToForeground,
  DOCK_CHROME_WIDTH,
  DOCK_RAIL,
  DOCK_RIGHT_BORDER,
  fitColumns,
  foregroundToBackground,
  paintDockBottomEdge,
  paintDockRow,
} from "./dock-rendering";
import { installClickableSubagentSessions } from "./subagent-session-links";
import { colorizeHex } from "./terminal-color";

const EDITOR_PADDING_X = 1;
const AUTOCOMPLETE_MAX_VISIBLE = 10;
const INTERRUPT_CONFIRMATION_WINDOW_MS = 1_500;
export const FILE_CHANGES_STATUS_KEY = "file-changes";
export const MCP_STATUS_KEY = "mcp";

export interface PromptEditorState {
  isWorking(): boolean;
  isInterruptPending(): boolean;
  setInterruptPending(pending: boolean): void;
  getWorkingMarker(): string;
  getBranch(): string | null;
  getProfileName(): string | undefined;
  getStatuses(): readonly string[];
}

interface PromptKeybindings {
  getKeys(action: "app.interrupt"): string[];
}

function formatCwd(cwd: string): string {
  const home = process.env.HOME;
  if (home === undefined) return cwd;
  if (cwd === home) return "~";
  if (cwd.startsWith(`${home}/`)) return `~${cwd.slice(home.length)}`;
  return cwd;
}

function renderContext(theme: Theme, ctx: ExtensionContext): string {
  const usage = ctx.getContextUsage();
  const indicator = contextIndicator(usage?.tokens, usage?.percent);
  return theme.fg(indicator.color, indicator.text);
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
  action: "app.interrupt",
  description: string,
): string {
  const key = keybindings.getKeys(action)[0];
  return key === undefined ? "" : `${formatKey(key)} ${description}`;
}

function sanitizeStatus(status: string, preserveTrailingSpace = false): string {
  const sanitized = status.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ");
  const hasTrailingSpace = sanitized.endsWith(" ");
  const trimmed = sanitized.trim();
  return preserveTrailingSpace && hasTrailingSpace ? `${trimmed} ` : trimmed;
}

function isYoloStatus(status: string): boolean {
  return stripTerminalSequences(status) === YOLO_STATUS_TEXT;
}

export function renderMcpFooterStatus(
  theme: Pick<Theme, "fg">,
  connectedCount: number,
  hasFailure = false,
): string {
  if (connectedCount <= 0) return "";

  const iconColor = hasFailure ? "error" : "success";
  return `${theme.fg(iconColor, "⊙")} ${theme.fg("text", `${connectedCount} MCP`)}`;
}

export function renderFooterStatus(theme: Pick<Theme, "fg">, key: string, status: string): string {
  if (key === YOLO_STATUS_KEY) return theme.fg("error", YOLO_STATUS_TEXT);
  if (key === FILE_CHANGES_STATUS_KEY) {
    const match = /^(\d+ files?)(?: (\+\d+))?(?: (-\d+))?$/.exec(stripTerminalSequences(status));
    if (match === null) return status;

    const [, files, added, removed] = match;
    if (files === undefined) return status;
    return `${[
      theme.fg("text", files),
      added === undefined ? undefined : theme.fg("success", added),
      removed === undefined ? undefined : theme.fg("error", removed),
    ]
      .filter((part) => part !== undefined)
      .join(" ")} `;
  }
  if (key !== MCP_STATUS_KEY) return status;

  const compactStatus = /^MCP (\d+)\/\d+$/.exec(stripTerminalSequences(status));
  return compactStatus === null ? "" : renderMcpFooterStatus(theme, Number(compactStatus[1]));
}

export function renderPromptHints(
  theme: Pick<Theme, "fg">,
  keybindings: PromptKeybindings,
  promptState: PromptEditorState,
  cwd: string,
  width: number,
  primaryRightStatus = "",
  secondaryRightStatus = "",
): string {
  const statuses = promptState
    .getStatuses()
    .map((status) => sanitizeStatus(status))
    .filter((status) => status.length > 0);
  const interruptPending = promptState.isInterruptPending();
  const interruptHintText = keyHint(
    keybindings,
    "app.interrupt",
    interruptPending ? "again to interrupt" : "interrupt",
  );
  const interruptHint = interruptPending
    ? theme.fg("warning", interruptHintText)
    : interruptHintText;
  const statusText = statuses
    .filter((status) => status !== PLAN_MODE_STATUS && !isYoloStatus(status))
    .join(" · ");
  const workingText = promptState.isWorking()
    ? [theme.fg("accent", `${promptState.getWorkingMarker()} working`), interruptHint]
        .filter(Boolean)
        .join("  ")
    : "";
  const branch = promptState.getBranch();
  const location = theme.fg("muted", `${formatCwd(cwd)}${branch ? ` (${branch})` : ""}`);
  const hintLeft = [workingText, location, statusText].filter(Boolean).join(" · ");
  const renderedLeft = theme.fg("muted", ` ${hintLeft}`);
  const primaryRight = sanitizeStatus(primaryRightStatus, true);
  const secondaryRight = sanitizeStatus(secondaryRightStatus, true);
  const combinedRight = [secondaryRight, primaryRight].filter(Boolean).join(" · ");
  const rightWidth = Math.max(0, width - visibleWidth(renderedLeft) - 1);
  const hintRight =
    primaryRight && secondaryRight && visibleWidth(combinedRight) > rightWidth
      ? primaryRight
      : combinedRight;
  return fitColumns(renderedLeft, hintRight, width);
}

export class PromptEditor extends CustomEditor {
  private readonly appKeybindings: KeybindingsManager;
  private readonly pi: ExtensionAPI;
  private readonly ctx: ExtensionContext;
  private readonly promptState: PromptEditorState;
  private readonly autocompleteOverlay: AutocompleteOverlay;
  private readonly disposeSubagentSessionLinks: () => void;
  private readonly typoRules: TypoCorrectionRules;
  private readonly agentMentions: readonly AgentMention[];
  private readonly projectReferences: readonly ProjectReference[];
  private autocompleteTokenPrefixes = new Set(["/", "@", "#"]);
  private interruptConfirmationTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    state: PromptEditorState,
    typoRules: TypoCorrectionRules,
    private readonly interruptConfirmationWindowMs = INTERRUPT_CONFIRMATION_WINDOW_MS,
  ) {
    super(tui, theme, keybindings, {
      paddingX: EDITOR_PADDING_X,
      autocompleteMaxVisible: AUTOCOMPLETE_MAX_VISIBLE,
    });
    this.appKeybindings = keybindings;
    this.pi = pi;
    this.ctx = ctx;
    this.promptState = state;
    this.typoRules = typoRules;
    const knownAgentMentions = loadAgentMentions(this.ctx.cwd);
    this.agentMentions = knownAgentMentions.filter(
      (mention) => pathShadowsAgentMention(mention.name, this.ctx.cwd) === false,
    );
    this.projectReferences = [];
    if (typeof this.ctx.isProjectTrusted === "function" && this.ctx.isProjectTrusted()) {
      try {
        const projectReferences = loadProjectReferences(this.ctx.cwd, true);
        assertNoAgentMentionCollisions(projectReferences, knownAgentMentions);
        this.projectReferences = projectReferences;
      } catch {
        // The project-references extension reports the same configuration error during startup.
      }
    }
    this.disposeSubagentSessionLinks = installClickableSubagentSessions(tui, ctx);
    this.autocompleteOverlay = new AutocompleteOverlay(tui);
  }

  dispose(): void {
    this.resetInterruptConfirmation();
    this.disposeSubagentSessionLinks();
    this.autocompleteOverlay.dispose();
  }

  // Pi copies its default padding after the editor factory returns.
  setPaddingX(_padding: number): void {
    super.setPaddingX(EDITOR_PADDING_X);
  }

  setAutocompleteProvider(provider: AutocompleteProvider): void {
    this.autocompleteTokenPrefixes = new Set([
      "/",
      "@",
      "#",
      ...(provider.triggerCharacters ?? []),
    ]);
    super.setAutocompleteProvider(
      createPromptAutocompleteProvider(
        provider,
        this.agentMentions,
        this.projectReferences,
        (mention, text) =>
          mention.color === undefined
            ? this.ctx.ui.theme.fg("accent", text)
            : colorizeHex(this.ctx.ui.theme, mention.color)(text),
        (text) => this.ctx.ui.theme.bold(text),
      ),
    );
  }

  private armInterruptConfirmation(): void {
    this.resetInterruptConfirmation();
    this.promptState.setInterruptPending(true);
    this.interruptConfirmationTimer = setTimeout(() => {
      this.interruptConfirmationTimer = undefined;
      if (this.promptState.isInterruptPending()) {
        this.promptState.setInterruptPending(false);
      }
    }, this.interruptConfirmationWindowMs);
  }

  private resetInterruptConfirmation(): void {
    if (this.interruptConfirmationTimer !== undefined) {
      clearTimeout(this.interruptConfirmationTimer);
      this.interruptConfirmationTimer = undefined;
    }
    if (this.promptState.isInterruptPending()) {
      this.promptState.setInterruptPending(false);
    }
  }

  private hasAutocompleteTokenAtCursor(line: string, cursorCol: number): boolean {
    let tokenStart = cursorCol;
    while (tokenStart > 0) {
      const character = line[tokenStart - 1];
      if (character === " " || character === "\t") break;
      tokenStart -= 1;
    }

    const prefix = line[tokenStart];
    return prefix !== undefined && this.autocompleteTokenPrefixes.has(prefix);
  }

  handleInput(data: string): void {
    const isInterrupt = this.appKeybindings.matches(data, "app.interrupt");
    if (isInterrupt && this.promptState.isWorking() && !this.isShowingAutocomplete()) {
      if (this.promptState.isInterruptPending()) {
        this.resetInterruptConfirmation();
        super.handleInput(data);
      } else {
        this.armInterruptConfirmation();
      }
      return;
    }
    this.resetInterruptConfirmation();

    const lines = this.getLines();
    const cursor = this.getCursor();
    const lastLine = lines.at(-1) ?? "";
    const cursorIsAtEnd = cursor.line === lines.length - 1 && cursor.col === lastLine.length;

    if (
      cursorIsAtEnd &&
      this.isShowingAutocomplete() === false &&
      this.hasAutocompleteTokenAtCursor(lastLine, cursor.col) === false
    ) {
      const current = this.getText();
      const corrected = correctedPromptForInput(current, data, this.typoRules);
      // setText clears Pi's backing content for collapsed large-paste markers.
      const hasExpandedPaste = corrected !== undefined && this.getExpandedText() !== current;
      if (corrected !== undefined && hasExpandedPaste === false) {
        this.setText(corrected);
        return;
      }
    }

    super.handleInput(data);
  }

  render(width: number): string[] {
    if (width <= DOCK_CHROME_WIDTH) {
      this.autocompleteOverlay.hide();
      return super.render(width);
    }

    const theme = this.ctx.ui.theme;
    const statuses = this.promptState
      .getStatuses()
      .map((status) => sanitizeStatus(status))
      .filter((status) => status.length > 0);
    const isPlanMode = statuses.includes(PLAN_MODE_STATUS);
    const isYoloMode = statuses.some(isYoloStatus);
    const modeColor = colorizeHex(theme, getModeColor(isPlanMode ? "plan" : "build"));
    const editorBorder = (text: string) => this.borderColor(text);
    const editorWidth = width - DOCK_CHROME_WIDTH;
    // Pi renders its internal editor border with the thinking color, even in Plan mode.
    const { content, suggestions } = splitEditorLines(super.render(editorWidth), editorBorder);
    const coloredContent = content.map((line) => {
      const coloredAgents = formatAnsiAgentMentions(
        line,
        this.agentMentions,
        this.ctx.cwd,
        (mention) => agentMentionForegroundAnsi(theme, mention),
      );
      return formatAnsiReferenceMentions(
        coloredAgents,
        this.projectReferences,
        this.ctx.cwd,
        theme.getFgAnsi("warning"),
      );
    });
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
            isYoloMode ? `${separator}${theme.fg("error", YOLO_STATUS_TEXT)}` : "",
          ].join("");
    const profileName = sanitizeStatus(this.promptState.getProfileName() ?? "");
    const modelRight = [
      renderContext(theme, this.ctx),
      profileName.length > 0 ? `${separator}${theme.fg("muted", profileName)}` : "",
      " ",
    ].join("");
    const modelRow = fitColumns(modelLeft, modelRight, editorWidth);
    const inputRail = modeColor(DOCK_RAIL);
    const suggestionsRail = theme.fg("borderMuted", DOCK_RAIL);
    const rightBorder = theme.fg("borderMuted", DOCK_RIGHT_BORDER);
    const backgroundAnsi = theme.getBgAnsi("userMessageBg");
    const dockRows = ["", ...coloredContent, "", modelRow].map((line) =>
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
