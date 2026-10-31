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
  foregroundAnsi,
  mixColors,
  rgbColor,
  stripTerminalSequences,
  type TUI,
  truncateToWidth,
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
import { cacheIndicator, contextIndicator, freedTokenIndicator } from "./context-health";
import { type ContextSnapshot, readContextSnapshot } from "./context-status";
import {
  backgroundToForeground,
  fitColumns,
  foregroundToBackground,
  paintDockBorderSpace,
  paintDockBottomEdge,
  paintDockRow,
} from "./dock-rendering";
import { colorizeFooterIcon, type FooterCustomization } from "./footer-config";
import { colorizeHex } from "./terminal-color";
import { WORKING_SWEEP_FRAMES, workingGutterStrength } from "./working-gutter";

const WORKING_GLOW_TINT = rgbColor(255, 255, 255);
const EDITOR_PADDING_X = 1;
const PROMPT_RAIL_WIDTH = 1;
const AUTOCOMPLETE_MAX_VISIBLE = 10;
export const FILE_CHANGES_STATUS_KEY = "file-changes";
export const MCP_STATUS_KEY = "mcp";
const MCP_ICON = "";
export function formatFffGitStatus(theme: Pick<Theme, "getFgAnsi">, status: string): string {
  switch (status) {
    case "untracked":
    case "unknown":
      return paintDockBorderSpace(theme.getFgAnsi("success"));
    case "modified":
      return paintDockBorderSpace(theme.getFgAnsi("warning"));
    case "deleted":
    case "staged_deleted":
      return paintDockBorderSpace(theme.getFgAnsi("error"));
    case "renamed":
      return paintDockBorderSpace(theme.getFgAnsi("accent"));
    case "staged_new":
    case "staged_modified":
      return paintDockBorderSpace(theme.getFgAnsi("success"));
    case "ignored":
      return paintDockBorderSpace(theme.getFgAnsi("dim"));
    default:
      return "";
  }
}
export interface PromptEditorState {
  isWorking(): boolean;
  getWorkingPulse(): number;
  getWorkingPosition(): number;
  getInterruptPulse(): number;
  onInterrupt(): void;
  getBranch(): string | null;
  getProfileName(): string | undefined;
  getStatuses(): readonly string[];
}

function formatCwd(cwd: string): string {
  const home = process.env.HOME;
  if (home === undefined) return cwd;
  if (cwd === home) return "~";
  if (cwd.startsWith(`${home}/`)) return `~${cwd.slice(home.length)}`;
  return cwd;
}

function renderContext(theme: Theme, context: ContextSnapshot): string {
  const indicator = contextIndicator(
    context.usage?.tokens,
    context.usage?.percent,
    context.estimated,
  );
  const freed = freedTokenIndicator(context.freedTokens);
  const cache = cacheIndicator(context.cachePercent);
  return (
    theme.fg(indicator.color, indicator.text) +
    (freed ? theme.fg("muted", ` ${freed}`) : "") +
    (cache.text ? theme.fg(cache.color, ` ${cache.text}`) : "")
  );
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
  readonly context: ContextSnapshot;
  readonly profileName: string;
}

function formatProvider(provider: string): string {
  if (provider === "openai" || provider === "openai-codex") return "OpenAI";
  return provider
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
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
  const statusText = statuses.join(" · ");
  const branch = promptState.getBranch();
  const repoIcon =
    footerCustomization === undefined ? "" : colorizeFooterIcon(theme, footerCustomization);
  const locationText = `${formatCwd(cwd)}${branch ? ` (${branch})` : ""}`;
  const location =
    repoIcon.length === 0
      ? theme.fg("muted", locationText)
      : `${repoIcon} ${theme.fg("muted", locationText)}`;
  const hintLeft = [location, statusText].filter(Boolean).join(" · ");
  const renderedLeft = theme.fg("muted", ` ${hintLeft}`);
  const primaryRight = sanitizeStatus(primaryRightStatus);
  const secondaryRight = sanitizeStatus(secondaryRightStatus);
  const combinedRight = [secondaryRight, primaryRight].filter(Boolean).join(" · ");
  const requiredRight = primaryRight || secondaryRight;
  // Keep the most important right status visible by letting the left side absorb truncation.
  const leftWidth =
    requiredRight.length === 0 ? width : Math.max(0, width - visibleWidth(requiredRight) - 2);
  const fittedLeft = truncateToWidth(renderedLeft, leftWidth, "");
  const rightWidth = Math.max(0, width - visibleWidth(fittedLeft) - 1);
  const hintRight =
    primaryRight && secondaryRight && visibleWidth(combinedRight) > rightWidth
      ? `${primaryRight} `
      : combinedRight.length > 0
        ? `${combinedRight} `
        : "";
  return fitColumns(fittedLeft, hintRight, width);
}

interface CachedPromptLayout {
  readonly key: string;
  readonly theme: Theme;
  readonly lines: string[];
  readonly suggestions: string[];
  readonly workingFrames: Map<string, string[]>;
}

export class PromptEditor extends CustomEditor {
  private readonly appKeybindings: KeybindingsManager;
  private readonly requestRender: () => void;
  private readonly pi: ExtensionAPI;
  private readonly ctx: ExtensionContext;
  private readonly promptState: PromptEditorState;
  private readonly autocompleteOverlay: AutocompleteOverlay;
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
  private contextCache:
    | {
        model: ExtensionContext["model"];
        leafId: string | null;
        snapshot: ContextSnapshot;
      }
    | undefined;

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

  private contextSnapshot(): ContextSnapshot {
    const model = this.ctx.model;
    const leafId = this.ctx.sessionManager.getLeafId();
    if (
      this.contextCache === undefined ||
      this.contextCache.model !== model ||
      this.contextCache.leafId !== leafId
    ) {
      this.contextCache = { model, leafId, snapshot: readContextSnapshot(this.ctx) };
    }
    return this.contextCache.snapshot;
  }

  dispose(): void {
    this.unsubscribeAgentMentions();
    this.autocompleteProviderRevision += 1;
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

    const onEscape = this.onEscape;
    if (
      onEscape === undefined ||
      !this.promptState.isWorking() ||
      !this.appKeybindings.matches(data, "app.interrupt")
    ) {
      super.handleInput(data);
      return;
    }

    // Let native shortcut/autocomplete routing decide whether an interrupt actually runs.
    const interrupt = () => {
      this.promptState.onInterrupt();
      onEscape();
    };
    this.onEscape = interrupt;
    try {
      super.handleInput(data);
    } finally {
      if (this.onEscape === interrupt) this.onEscape = onEscape;
    }
  }

  render(width: number): string[] {
    if (width <= PROMPT_RAIL_WIDTH) {
      this.autocompleteOverlay.hide();
      return super.render(width);
    }

    const theme = this.ctx.ui.theme;
    const editorWidth = width - PROMPT_RAIL_WIDTH;
    const inputLines = super.render(editorWidth);
    const model = this.ctx.model;
    const thinkingLevel = this.pi.getThinkingLevel();
    const context = this.contextSnapshot();
    const profileName = sanitizeStatus(this.promptState.getProfileName() ?? "");
    const key = JSON.stringify([
      width,
      inputLines,
      promptThemeKey(theme),
      // Terminal color detection can change resolved defaults without changing ANSI tokens.
      theme.colors.borderMuted,
      theme.colors.accent,
      theme.colors.error,
      theme.getColorMode(),
      model?.name,
      model?.provider,
      thinkingLevel,
      theme.getThinkingBorderColor(thinkingLevel)(thinkingLevel),
      context.usage?.tokens,
      context.usage?.percent,
      context.estimated,
      context.freedTokens,
      context.cachePercent,
      profileName,
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
        context,
        profileName,
      });
      cached = { key, theme, ...result, workingFrames: new Map() };
      this.layoutCache = cached;
    }

    const suggestionsRail = paintDockBorderSpace(theme.getFgAnsi("borderMuted"));
    const suggestionRails = cached.suggestions.map((line) => {
      const status = getSuggestionGitStatus(line, this.autocompleteItems);
      return (status === undefined ? "" : formatFffGitStatus(theme, status)) || suggestionsRail;
    });
    const backgroundAnsi = theme.getBgAnsi("userMessageBg");
    this.autocompleteOverlay.update(
      cached.suggestions,
      suggestionRails,
      width,
      cached.lines.length,
      {
        rail: suggestionsRail,
        rightBorder: "",
        backgroundAnsi,
        selectedBackgroundAnsi: foregroundToBackground(theme.getFgAnsi("accent")),
        selectedForegroundAnsi: backgroundToForeground(backgroundAnsi),
      },
    );
    const workingPulse = this.promptState.getWorkingPulse();
    const interruptPulse = this.promptState.getInterruptPulse();
    if (workingPulse === 0 && interruptPulse === 0) return cached.lines;

    // Reuse exact frames across sweeps; the layout owns invalidation for text, width, and theme.
    const position = this.promptState.getWorkingPosition();
    const frameKey = interruptPulse === 1 ? "interrupt" : `${position}:${workingPulse}:${interruptPulse}`;
    const previousFrame = cached.workingFrames.get(frameKey);
    if (previousFrame !== undefined) return previousFrame;

    const baseColor = "borderMuted";
    const baseRail = paintDockBorderSpace(theme.getFgAnsi(baseColor));
    const lastRow = cached.lines.length - 1;
    const glowAccent = mixColors(theme.colors.accent, WORKING_GLOW_TINT, 0.3, "srgb");
    const frame = cached.lines.map((line, index) => {
      const strength = workingPulse * workingGutterStrength(index, lastRow, position);
      const workingColor = mixColors(theme.colors.borderMuted, glowAccent, strength, "srgb");
      const color =
        interruptPulse === 0
          ? workingColor
          : mixColors(workingColor, theme.colors.error, interruptPulse, "srgb");
      const glowAnsi = foregroundAnsi(color, theme.getColorMode());
      return index === lastRow
        ? `${glowAnsi}▀\u001b[39m${line.slice(theme.fg(baseColor, "▀").length)}`
        : paintDockBorderSpace(glowAnsi) + line.slice(baseRail.length);
    });
    if (cached.workingFrames.size === WORKING_SWEEP_FRAMES) {
      const oldest = cached.workingFrames.keys().next().value;
      if (oldest !== undefined) cached.workingFrames.delete(oldest);
    }
    cached.workingFrames.set(frameKey, frame);
    return frame;
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

  protected renderContextLine(theme: Theme, context: ContextSnapshot): string {
    return renderContext(theme, context);
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
      this.renderContextLine(input.theme, input.context),
      input.profileName.length > 0
        ? `${separator}${input.theme.fg("muted", input.profileName)}`
        : "",
      " ",
    ].join("");
    const modelRow = fitColumns(modelLeft, modelRight, input.editorWidth);
    const inputBorderColor = "borderMuted";
    // Use the same styled spaces as suggestions so both borders align without copyable glyphs.
    const inputRail = paintDockBorderSpace(input.theme.getFgAnsi(inputBorderColor));
    const backgroundAnsi = input.theme.getBgAnsi("userMessageBg");
    const dockRows = ["", ...coloredContent, "", modelRow].map((line) =>
      paintDockRow(line, input.width, inputRail, backgroundAnsi),
    );
    // The full-width half-block joins the full-cell left rail without narrowing its bottom corner.
    const bottomEdge = paintDockBottomEdge(
      input.width,
      input.theme.fg(inputBorderColor, "▀"),
      "",
      backgroundAnsi,
    );
    return { lines: [...dockRows, bottomEdge], suggestions };
  }
}
