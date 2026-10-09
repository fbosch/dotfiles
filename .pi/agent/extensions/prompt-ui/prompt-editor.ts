import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type AutocompleteItem,
  type AutocompleteProvider,
  type EditorTheme,
  stripTerminalSequences,
  type TUI,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  type AgentMention,
  type AgentMentionCache,
  agentMentionForegroundAnsi,
  formatAnsiAgentMentions,
} from "../mentions/agent-mentions";
import {
  assertNoAgentMentionCollisions,
  formatAnsiReferenceMentions,
  loadProjectReferences,
  type ProjectReference,
} from "../mentions/project-references";
import type { TypoCorrectionRules } from "../typo-abolish";
import { installTypoCorrection } from "../typo-abolish/editor-adapter";
import {
  AutocompleteOverlay,
  createPromptAutocompleteProvider,
  getSuggestionGitStatus,
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
import { colorizeFooterIcon, type FooterCustomization } from "./footer-config";
import { installClickableSubagentSessions } from "./subagent-session-links";
import { colorizeHex } from "./terminal-color";

const EDITOR_PADDING_X = 1;
const AUTOCOMPLETE_MAX_VISIBLE = 10;
export const FILE_CHANGES_STATUS_KEY = "file-changes";
export const MCP_STATUS_KEY = "mcp";
const MCP_ICON = "";
export function formatFffGitStatus(theme: Pick<Theme, "fg">, status: string): string {
  switch (status) {
    case "untracked":
    case "unknown":
      return theme.fg("success", DOCK_RAIL);
    case "modified":
      return theme.fg("warning", DOCK_RAIL);
    case "deleted":
    case "staged_deleted":
      return theme.fg("error", DOCK_RAIL);
    case "renamed":
      return theme.fg("accent", DOCK_RAIL);
    case "staged_new":
    case "staged_modified":
      return theme.fg("success", DOCK_RAIL);
    case "ignored":
      return theme.fg("dim", DOCK_RAIL);
    default:
      return "";
  }
}
export interface PromptEditorState {
  isWorking(): boolean;
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

type ContextUsage = ReturnType<ExtensionContext["getContextUsage"]>;

function renderContext(theme: Theme, usage: ContextUsage): string {
  const indicator = contextIndicator(usage?.tokens, usage?.percent);
  return theme.fg(indicator.color, indicator.text);
}

function promptThemeKey(theme: Theme): string {
  return [
    theme.getFgAnsi("accent"),
    theme.getFgAnsi("text"),
    theme.getFgAnsi("muted"),
    theme.getFgAnsi("dim"),
    theme.getFgAnsi("warning"),
    theme.getFgAnsi("error"),
    theme.getFgAnsi("success"),
    theme.getFgAnsi("borderMuted"),
    theme.getFgAnsi("mdLink"),
    theme.getBgAnsi("userMessageBg"),
  ].join("\0");
}

type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;

export interface PromptRenderInput {
  readonly width: number;
  readonly editorWidth: number;
  readonly inputLines: readonly string[];
  readonly theme: Theme;
  readonly modelName: string | undefined;
  readonly modelProvider: string | undefined;
  readonly thinkingLevel: ThinkingLevel;
  readonly usage: ContextUsage;
  readonly profileName: string;
  readonly isWorking: boolean;
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

function sanitizeStatus(status: string): string {
  return status
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

export function renderMcpFooterStatus(
  theme: Pick<Theme, "fg">,
  connectedCount: number,
  hasFailure = false,
): string {
  if (connectedCount <= 0 && hasFailure === false) return "";

  const iconColor = hasFailure ? "error" : "success";
  return `${theme.fg(iconColor, MCP_ICON)} ${theme.fg("text", `${connectedCount} MCP`)}`;
}

export function renderFooterStatus(theme: Pick<Theme, "fg">, key: string, status: string): string {
  if (key === FILE_CHANGES_STATUS_KEY) {
    const match = /^(\d+ files?)(?: (\+\d+))?(?: (-\d+))?$/.exec(stripTerminalSequences(status));
    if (match === null) return status;

    const [, files, added, removed] = match;
    if (files === undefined) return status;
    return [
      theme.fg("text", files),
      added === undefined ? undefined : theme.fg("success", added),
      removed === undefined ? undefined : theme.fg("error", removed),
    ]
      .filter((part) => part !== undefined)
      .join(" ");
  }
  if (key === MCP_STATUS_KEY) {
    const match = /^MCP (\d+)\/\d+(!)?$/.exec(stripTerminalSequences(status));
    return match === null
      ? ""
      : renderMcpFooterStatus(theme, Number(match[1]), match[2] !== undefined);
  }
  return status;
}

export function renderPromptHints(
  theme: Pick<Theme, "fg"> & Partial<Pick<Theme, "getColorMode">>,
  keybindings: PromptKeybindings,
  promptState: PromptEditorState,
  cwd: string,
  width: number,
  primaryRightStatus = "",
  secondaryRightStatus = "",
  footerCustomization?: FooterCustomization,
): string {
  const statuses = promptState
    .getStatuses()
    .map((status) => sanitizeStatus(status))
    .filter((status) => status.length > 0);
  const interruptHint = keyHint(keybindings, "app.interrupt", "interrupt");
  const statusText = statuses.join(" · ");
  const workingText = promptState.isWorking()
    ? [theme.fg("accent", `${promptState.getWorkingMarker()} working`), interruptHint]
        .filter(Boolean)
        .join("  ")
    : "";
  const branch = promptState.getBranch();
  const repoIcon =
    footerCustomization === undefined ? "" : colorizeFooterIcon(theme, footerCustomization);
  const locationText = `${formatCwd(cwd)}${branch ? ` (${branch})` : ""}`;
  const location =
    repoIcon.length === 0
      ? theme.fg("muted", locationText)
      : `${repoIcon} ${theme.fg("muted", locationText)}`;
  const hintLeft = [workingText, location, statusText].filter(Boolean).join(" · ");
  const renderedLeft = theme.fg("muted", ` ${hintLeft}`);
  const primaryRight = sanitizeStatus(primaryRightStatus);
  const secondaryRight = sanitizeStatus(secondaryRightStatus);
  const combinedRight = [secondaryRight, primaryRight].filter(Boolean).join(" · ");
  const rightWidth = Math.max(0, width - visibleWidth(renderedLeft) - 1);
  const hintRight =
    primaryRight && secondaryRight && visibleWidth(combinedRight) > rightWidth
      ? `${primaryRight} `
      : combinedRight.length > 0
        ? `${combinedRight} `
        : "";
  return fitColumns(renderedLeft, hintRight, width);
}

interface CachedPromptLayout {
  readonly key: string;
  readonly theme: Theme;
  readonly lines: string[];
  readonly suggestions: string[];
}

export class PromptEditor extends CustomEditor {
  private readonly appKeybindings: KeybindingsManager;
  private readonly requestRender: () => void;
  private readonly pi: ExtensionAPI;
  private readonly ctx: ExtensionContext;
  private readonly promptState: PromptEditorState;
  private readonly autocompleteOverlay: AutocompleteOverlay;
  private readonly disposeSubagentSessionLinks: () => void;
  private readonly typoRules: TypoCorrectionRules;
  private readonly agentMentionCache: AgentMentionCache;
  private readonly unsubscribeAgentMentions: () => void;
  private agentMentions: readonly AgentMention[];
  private readonly projectReferences: readonly ProjectReference[];
  private baseAutocompleteProvider: AutocompleteProvider | undefined;
  private autocompleteProviderRevision = 0;
  private autocompleteItems: readonly AutocompleteItem[] = [];
  private autocompleteTokenPrefixes = new Set(["/", "@", "#"]);
  private layoutCache: CachedPromptLayout | undefined;
  private contextCache: { model: ExtensionContext["model"]; usage: ContextUsage } | undefined;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    state: PromptEditorState,
    typoRules: TypoCorrectionRules,
    agentMentionCache: AgentMentionCache,
  ) {
    super(tui, theme, keybindings, {
      paddingX: EDITOR_PADDING_X,
      autocompleteMaxVisible: AUTOCOMPLETE_MAX_VISIBLE,
    });
    this.appKeybindings = keybindings;
    this.requestRender = () => tui.requestRender();
    this.pi = pi;
    this.ctx = ctx;
    this.promptState = state;
    this.typoRules = typoRules;
    this.agentMentionCache = agentMentionCache;
    this.agentMentions = this.availableAgentMentions();
    this.projectReferences = [];
    try {
      const projectReferences = loadProjectReferences(
        this.ctx.cwd,
        this.ctx.isProjectTrusted?.() ?? false,
      );
      assertNoAgentMentionCollisions(projectReferences, agentMentionCache.getMentions());
      this.projectReferences = projectReferences;
    } catch {
      // The project-references extension reports the same configuration error during startup.
    }
    this.disposeSubagentSessionLinks = installClickableSubagentSessions(tui, ctx);
    this.autocompleteOverlay = new AutocompleteOverlay(tui);
    this.unsubscribeAgentMentions = agentMentionCache.subscribe(() => {
      this.agentMentions = this.availableAgentMentions();
      this.layoutCache = undefined;
      if (this.baseAutocompleteProvider !== undefined) {
        this.installAutocompleteProvider(this.baseAutocompleteProvider);
      }
      this.requestRender();
    });
    installTypoCorrection(
      this,
      this.typoRules,
      (line, column) =>
        !this.isShowingAutocomplete() && !this.hasAutocompleteTokenAtCursor(line, column),
    );
  }
  invalidateContextUsage(): void {
    this.contextCache = undefined;
  }

  private contextUsage(): ContextUsage {
    const model = this.ctx.model;
    if (this.contextCache === undefined || this.contextCache.model !== model) {
      this.contextCache = { model, usage: this.ctx.getContextUsage() };
    }
    return this.contextCache.usage;
  }

  dispose(): void {
    this.unsubscribeAgentMentions();
    this.autocompleteProviderRevision += 1;
    this.disposeSubagentSessionLinks();
    this.autocompleteOverlay.dispose();
  }

  // Pi copies its default padding after the editor factory returns.
  setPaddingX(_padding: number): void {
    super.setPaddingX(EDITOR_PADDING_X);
  }

  setAutocompleteProvider(provider: AutocompleteProvider): void {
    this.baseAutocompleteProvider = provider;
    this.installAutocompleteProvider(provider);
  }

  private installAutocompleteProvider(provider: AutocompleteProvider): void {
    const revision = ++this.autocompleteProviderRevision;
    this.autocompleteItems = [];
    this.autocompleteTokenPrefixes = new Set([
      "/",
      "@",
      "#",
      ...(provider.triggerCharacters ?? []),
    ]);
    const promptProvider = createPromptAutocompleteProvider(
      provider,
      this.agentMentions,
      this.projectReferences,
      (mention, text) =>
        mention.color === undefined
          ? this.ctx.ui.theme.fg("accent", text)
          : colorizeHex(this.ctx.ui.theme, mention.color)(text),
      (text) => this.ctx.ui.theme.bold(text),
      (_reference, text) => this.ctx.ui.theme.fg("mdLink", text),
    );
    super.setAutocompleteProvider({
      ...promptProvider,
      getSuggestions: async (lines, cursorLine, cursorCol, options) => {
        const suggestions = await promptProvider.getSuggestions(
          lines,
          cursorLine,
          cursorCol,
          options,
        );
        if (revision === this.autocompleteProviderRevision) {
          this.autocompleteItems = suggestions?.items ?? [];
        }
        return suggestions;
      },
    });
  }

  private availableAgentMentions(): readonly AgentMention[] {
    return this.agentMentionCache
      .getMentions()
      .filter((mention) => this.agentMentionCache.isPathShadowed(mention.name) === false);
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
    if (
      this.isShowingAutocomplete() &&
      (this.appKeybindings.matches(data, "tui.select.cancel") ||
        this.appKeybindings.matches(data, "tui.select.confirm") ||
        this.appKeybindings.matches(data, "tui.input.tab"))
    ) {
      // Slash-command submission can replace the editor before its next render.
      this.autocompleteOverlay.hide();
    }

    super.handleInput(data);
  }

  render(width: number): string[] {
    if (width <= DOCK_CHROME_WIDTH) {
      this.autocompleteOverlay.hide();
      return super.render(width);
    }

    const theme = this.ctx.ui.theme;
    const editorWidth = width - DOCK_CHROME_WIDTH;
    const inputLines = super.render(editorWidth);
    const model = this.ctx.model;
    const thinkingLevel = this.pi.getThinkingLevel();
    const usage = this.contextUsage();
    const profileName = sanitizeStatus(this.promptState.getProfileName() ?? "");
    const isWorking = this.promptState.isWorking();
    const key = JSON.stringify([
      width,
      inputLines,
      promptThemeKey(theme),
      model?.name,
      model?.provider,
      thinkingLevel,
      theme.getThinkingBorderColor(thinkingLevel)(thinkingLevel),
      usage?.tokens,
      usage?.percent,
      profileName,
      isWorking,
      this.agentMentionCache.version,
    ]);
    let cached = this.layoutCache;
    if (cached === undefined || cached.key !== key || cached.theme !== theme) {
      const result = this.buildPromptLayout({
        width,
        editorWidth,
        inputLines,
        theme,
        modelName: model?.name,
        modelProvider: model?.provider,
        thinkingLevel,
        usage,
        profileName,
        isWorking,
      });
      cached = { key, theme, ...result };
      this.layoutCache = cached;
    }

    const suggestionsRail = theme.fg("borderMuted", DOCK_RAIL);
    const suggestionRails = cached.suggestions.map((line) => {
      const status = getSuggestionGitStatus(line, this.autocompleteItems);
      return (status === undefined ? "" : formatFffGitStatus(theme, status)) || suggestionsRail;
    });
    const backgroundAnsi = theme.getBgAnsi("userMessageBg");
    const rightBorder = theme.fg("borderMuted", DOCK_RIGHT_BORDER);
    this.autocompleteOverlay.update(
      cached.suggestions,
      suggestionRails,
      width,
      cached.lines.length,
      {
        rail: suggestionsRail,
        rightBorder,
        backgroundAnsi,
        selectedBackgroundAnsi: foregroundToBackground(theme.getFgAnsi("accent")),
        selectedForegroundAnsi: backgroundToForeground(backgroundAnsi),
      },
    );
    return cached.lines;
  }

  protected highlightPromptContent(content: readonly string[], theme: Theme): string[] {
    return content.map((line) => {
      const coloredAgents = formatAnsiAgentMentions(
        line,
        this.agentMentions,
        this.ctx.cwd,
        (mention) => agentMentionForegroundAnsi(theme, mention),
        "\u001b[39m",
        (name) => this.agentMentionCache.isPathShadowed(name),
      );
      return formatAnsiReferenceMentions(
        coloredAgents,
        this.projectReferences,
        this.ctx.cwd,
        theme.getFgAnsi("mdLink"),
        "\u001b[39m",
        theme.getFgAnsi("accent"),
        (value) => this.agentMentionCache.referencePathState(value),
      );
    });
  }

  protected renderContextLine(theme: Theme, usage: ContextUsage): string {
    return renderContext(theme, usage);
  }

  protected buildPromptLayout(input: PromptRenderInput): {
    lines: string[];
    suggestions: string[];
  } {
    const editorBorder = (text: string) => this.borderColor(text);
    const { content, suggestions } = splitEditorLines(input.inputLines, editorBorder);
    const coloredContent = this.highlightPromptContent(content, input.theme);
    const separator = input.theme.fg("dim", " · ");
    const modelLeft =
      input.modelName === undefined || input.modelProvider === undefined
        ? input.theme.fg("muted", " No model")
        : [
            input.theme.fg("text", ` ${input.modelName}`),
            " ",
            input.theme.fg("muted", formatProvider(input.modelProvider)),
            separator,
            input.theme.getThinkingBorderColor(input.thinkingLevel)(input.thinkingLevel),
          ].join("");
    const modelRight = [
      this.renderContextLine(input.theme, input.usage),
      input.profileName.length > 0
        ? `${separator}${input.theme.fg("muted", input.profileName)}`
        : "",
      " ",
    ].join("");
    const modelRow = fitColumns(modelLeft, modelRight, input.editorWidth);
    const inputBorderColor = input.isWorking ? "accent" : "borderMuted";
    const inputRail = input.theme.fg(inputBorderColor, DOCK_RAIL);
    const rightBorder = input.theme.fg("borderMuted", DOCK_RIGHT_BORDER);
    const backgroundAnsi = input.theme.getBgAnsi("userMessageBg");
    const dockRows = ["", ...coloredContent, "", modelRow].map((line) =>
      paintDockRow(line, input.width, inputRail, backgroundAnsi, rightBorder),
    );
    const bottomEdge = paintDockBottomEdge(
      input.width,
      input.theme.fg(inputBorderColor, "▘"),
      input.theme.fg("borderMuted", "▝"),
      backgroundAnsi,
    );
    return { lines: [...dockRows, bottomEdge], suggestions };
  }
}
