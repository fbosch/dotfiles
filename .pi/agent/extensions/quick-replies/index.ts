import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import {
  extractVisibleAssistantProse,
  generateQuickReplies,
  isSlashCommand,
  type QuickReply,
  type QuickReplyGenerator,
} from "./generator";
import {
  DEFAULT_QUICK_REPLY_SHORTCUTS,
  loadQuickRepliesSettings,
  type QuickRepliesSettings,
  writeQuickRepliesSetting,
} from "./settings";

export const QUICK_REPLY_SHORTCUTS = DEFAULT_QUICK_REPLY_SHORTCUTS;

const WIDGET_KEY = "quick-replies";
const REPLY_GAP = "  ";
const PANEL_PADDING_X = 2;
const KEYCAP_BACKGROUND = "selectedBg";
const MIN_GENERATED_REPLIES = 1;

type ShortcutStyle = "full" | "short" | "numeric";

interface ActiveQuickReplies {
  runId: number;
  replies: QuickReply[];
}

interface FinalizedAssistantProse {
  runId: number;
  prose: string;
}

interface ActiveGeneration {
  runId: number;
  controller: AbortController;
}

interface ReplyLayout {
  replies: readonly QuickReply[];
  shortcuts: readonly string[];
  shortcutStyle: ShortcutStyle;
  startIndex: number;
}

export interface RenderedQuickReplies {
  lines: string[];
  visibleReplyCount: number;
}

export interface QuickRepliesDependencies {
  generate?: QuickReplyGenerator;
  readSettings?: () => QuickRepliesSettings;
  writeSettings?: (enabled: boolean) => void;
}

export function renderQuickReplyPanel(
  replies: readonly QuickReply[],
  width: number,
  theme: Theme,
  shortcuts: readonly string[] = QUICK_REPLY_SHORTCUTS,
): RenderedQuickReplies | undefined {
  if (replies.length === 0 || width <= 0) return undefined;

  const paddingX = width >= PANEL_PADDING_X * 2 + 1 ? PANEL_PADDING_X : 0;
  const contentWidth = width - paddingX * 2;
  const header =
    replies.length === 1 && isSlashCommand(replies[0]?.message ?? "")
      ? theme.fg("dim", "command · Enter to run")
      : "";
  const styles: readonly ShortcutStyle[] = ["full", "short", "numeric"];
  let content: string[] | undefined;

  for (const shortcutStyle of styles) {
    const repliesLine = renderLayout({ replies, shortcuts, shortcutStyle, startIndex: 0 }, theme);
    const combined = header.length > 0 ? `${header}${REPLY_GAP}${repliesLine}` : repliesLine;
    if (visibleWidth(combined) <= contentWidth) {
      content = [combined];
      break;
    }
  }

  if (content === undefined) {
    for (const shortcutStyle of styles) {
      const repliesLine = renderLayout({ replies, shortcuts, shortcutStyle, startIndex: 0 }, theme);
      if (header.length > 0 && visibleWidth(repliesLine) <= contentWidth) {
        content = [header, repliesLine];
        break;
      }
    }
  }

  if (content === undefined) {
    for (const shortcutStyle of styles) {
      const layouts = packReplyRows(replies, shortcuts, shortcutStyle, contentWidth, theme);
      if (layouts !== undefined) {
        content = [
          ...(header.length > 0 ? [header] : []),
          ...layouts.map((layout) => renderLayout(layout, theme)),
        ];
        break;
      }
    }
  }

  if (content === undefined) return undefined;

  const lines = [...content.map((line) => `${" ".repeat(paddingX)}${line}`), ""];
  return { lines, visibleReplyCount: replies.length };
}

class QuickReplyWidget implements Component {
  private visibleReplyCount: number;

  constructor(
    private readonly replies: readonly QuickReply[],
    private readonly shortcuts: readonly string[],
    private readonly theme: Theme,
    private readonly getEditorText: () => string,
    private readonly shouldShow: () => boolean,
  ) {
    this.visibleReplyCount = 0;
  }

  invalidate(): void {
    // Rendering reads current state and theme on every frame.
  }

  render(width: number): string[] {
    if (this.shouldShow() === false || this.getEditorText().length > 0) {
      this.visibleReplyCount = 0;
      return [];
    }

    const rendered = renderQuickReplyPanel(this.replies, width, this.theme, this.shortcuts);
    if (rendered === undefined) {
      this.visibleReplyCount = 0;
      return [];
    }

    this.visibleReplyCount = rendered.visibleReplyCount;
    return rendered.lines;
  }

  isReplyVisible(index: number): boolean {
    return index >= 0 && index < this.visibleReplyCount;
  }
}

export function createQuickRepliesExtension(dependencies: QuickRepliesDependencies = {}) {
  const generate = dependencies.generate ?? generateQuickReplies;

  return (pi: ExtensionAPI): void => {
    const settings = (dependencies.readSettings ?? loadQuickRepliesSettings)();
    const shortcuts = settings.shortcuts ?? QUICK_REPLY_SHORTCUTS;
    let runSequence = 0;
    let runActive = false;
    let currentRunId: number | undefined;
    let latestSettledRunId: number | undefined;
    let pendingUserText: string | undefined;
    let currentUserText: string | undefined;
    let finalizedAssistant: FinalizedAssistantProse | undefined;
    let activeGeneration: ActiveGeneration | undefined;
    let activeReplies: ActiveQuickReplies | undefined;
    let widget: QuickReplyWidget | undefined;
    let widgetMounted = false;
    let uiPromptActive = false;
    let enabled = settings.enabled;

    function abortGeneration(): void {
      activeGeneration?.controller.abort();
      activeGeneration = undefined;
    }

    function clearWidget(ctx: ExtensionContext): void {
      activeReplies = undefined;
      widget = undefined;
      if (widgetMounted && ctx.mode === "tui") {
        ctx.ui.setWidget(WIDGET_KEY, undefined);
      }
      widgetMounted = false;
    }

    function invalidateSettledState(ctx: ExtensionContext): void {
      abortGeneration();
      finalizedAssistant = undefined;
      latestSettledRunId = undefined;
      clearWidget(ctx);
    }

    function resetSessionState(ctx: ExtensionContext): void {
      runActive = false;
      currentRunId = undefined;
      pendingUserText = undefined;
      currentUserText = undefined;
      uiPromptActive = false;
      invalidateSettledState(ctx);
    }

    function canShowReplies(ctx: ExtensionContext, runId: number): boolean {
      return (
        enabled &&
        ctx.mode === "tui" &&
        ctx.isIdle() &&
        uiPromptActive === false &&
        ctx.ui.getEditorText().length === 0 &&
        currentRunId === runId &&
        latestSettledRunId === runId
      );
    }

    function showReplies(ctx: ExtensionContext, runId: number, replies: QuickReply[]): void {
      activeReplies = { runId, replies };
      widgetMounted = true;
      ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => {
        widget = new QuickReplyWidget(
          replies,
          shortcuts,
          theme,
          () => ctx.ui.getEditorText(),
          () => activeReplies?.runId === runId && canShowReplies(ctx, runId),
        );
        return widget;
      });
    }

    function report(
      ctx: ExtensionContext,
      message: string,
      level: "info" | "warning" | "error" = "info",
    ): void {
      if (ctx.hasUI) {
        ctx.ui.notify(message, level);
        return;
      }
      if (level === "error") {
        console.error(message);
      } else {
        console.log(message);
      }
    }

    function setEnabled(value: boolean, ctx: ExtensionContext): void {
      try {
        (dependencies.writeSettings ?? writeQuickRepliesSetting)(value);
      } catch (error) {
        report(
          ctx,
          `Cannot update global quickReplies.enabled setting: ${
            error instanceof Error ? error.message : String(error)
          }`,
          "error",
        );
        return;
      }

      enabled = value;
      if (value === false) invalidateSettledState(ctx);
      report(ctx, value ? "Quick replies enabled" : "Quick replies disabled");
    }

    function selectReply(index: number, ctx: ExtensionContext): void {
      const current = activeReplies;
      if (current === undefined) return;

      const reply = current.replies[index];
      if (
        reply === undefined ||
        canShowReplies(ctx, current.runId) === false ||
        widget === undefined ||
        widget.isReplyVisible(index) === false
      ) {
        return;
      }

      invalidateSettledState(ctx);
      if (isSlashCommand(reply.message)) {
        // Built-in commands only dispatch through interactive input; Enter remains explicit confirmation.
        ctx.ui.setEditorText(reply.message);
        return;
      }
      pi.sendUserMessage(reply.message, { expandPromptTemplates: false });
    }

    function beginGeneration(
      ctx: ExtensionContext,
      runId: number,
      userText: string,
      assistantText: string,
    ): void {
      const controller = new AbortController();
      const generation: ActiveGeneration = { runId, controller };
      activeGeneration = generation;

      void generate(ctx, { userText, assistantText }, controller.signal)
        .then((replies) => {
          if (activeGeneration !== generation) return;
          activeGeneration = undefined;
          if (
            replies.length < MIN_GENERATED_REPLIES ||
            replies.length > shortcuts.length ||
            canShowReplies(ctx, runId) === false
          ) {
            clearWidget(ctx);
            return;
          }
          showReplies(ctx, runId, replies);
        })
        .catch(() => {
          if (activeGeneration === generation) activeGeneration = undefined;
        });
    }

    pi.registerCommand("quick-replies", {
      description: "Enable or disable quick replies globally",
      getArgumentCompletions: (prefix) => {
        const input = prefix.trimStart();
        if (input.includes(" ")) return null;
        const actions = ["on", "off"];
        const matches = actions.filter((action) => action.startsWith(input));
        return matches.length === 0 ? null : matches.map((value) => ({ value, label: value }));
      },
      handler: async (args, ctx) => {
        const action = args.trim();
        if (action === "") {
          report(ctx, `Quick replies ${enabled ? "enabled" : "disabled"}`);
          return;
        }
        if (action === "on" || action === "off") {
          setEnabled(action === "on", ctx);
          return;
        }
        report(ctx, "Usage: /quick-replies [on|off]", "warning");
      },
    });

    pi.on("session_start", (_event, ctx) => {
      if (settings.warnings.length > 0) {
        report(ctx, `Quick replies settings:\n- ${settings.warnings.join("\n- ")}`, "warning");
      }
      resetSessionState(ctx);
    });
    pi.on("session_shutdown", (_event, ctx) => resetSessionState(ctx));
    pi.on("session_before_switch", (_event, ctx) => resetSessionState(ctx));
    pi.on("session_before_fork", (_event, ctx) => resetSessionState(ctx));
    pi.on("session_before_tree", (_event, ctx) => resetSessionState(ctx));
    pi.on("session_tree", (_event, ctx) => resetSessionState(ctx));

    pi.on("input", (event, ctx) => {
      invalidateSettledState(ctx);
      if (runActive && event.streamingBehavior !== undefined) {
        currentUserText = event.text;
        return;
      }
      pendingUserText = event.text;
    });

    pi.on("ui_prompt_start", (_event, ctx) => {
      uiPromptActive = true;
      invalidateSettledState(ctx);
    });

    pi.on("ui_prompt_end", () => {
      uiPromptActive = false;
    });

    pi.on("before_agent_start", (event) => {
      pendingUserText ??= event.prompt;
    });

    pi.on("agent_start", (_event, ctx) => {
      invalidateSettledState(ctx);
      // Pi emits another low-level start for retry and overflow recovery within one settled run.
      if (runActive) return;

      runActive = true;
      runSequence += 1;
      currentRunId = runSequence;
      currentUserText = pendingUserText;
      pendingUserText = undefined;
    });

    pi.on("message_end", (event) => {
      if (event.message.role !== "assistant" || currentRunId === undefined) return;

      finalizedAssistant = {
        runId: currentRunId,
        prose: extractVisibleAssistantProse(event.message),
      };
    });

    pi.on("agent_settled", (_event, ctx) => {
      runActive = false;
      const settledRunId = currentRunId;
      if (settledRunId !== undefined && latestSettledRunId === settledRunId) return;
      latestSettledRunId = settledRunId;

      const userText = currentUserText;
      if (
        settledRunId === undefined ||
        userText === undefined ||
        finalizedAssistant?.runId !== settledRunId ||
        canShowReplies(ctx, settledRunId) === false
      ) {
        clearWidget(ctx);
        return;
      }

      beginGeneration(ctx, settledRunId, userText, finalizedAssistant.prose);
    });

    shortcuts.forEach((shortcut, index) => {
      pi.registerShortcut(shortcut, {
        description: `Send quick reply ${index + 1}`,
        handler: (ctx) => selectReply(index, ctx),
      });
    });
  };
}

export default createQuickRepliesExtension();

function packReplyRows(
  replies: readonly QuickReply[],
  shortcuts: readonly string[],
  shortcutStyle: ShortcutStyle,
  width: number,
  theme: Theme,
): ReplyLayout[] | undefined {
  const layouts: ReplyLayout[] = [];
  let startIndex = 0;

  while (startIndex < replies.length) {
    let endIndex = startIndex + 1;
    while (
      endIndex <= replies.length &&
      visibleWidth(
        renderLayout(
          {
            replies: replies.slice(startIndex, endIndex),
            shortcuts,
            shortcutStyle,
            startIndex,
          },
          theme,
        ),
      ) <= width
    ) {
      endIndex += 1;
    }

    const fittingEndIndex = endIndex - 1;
    if (fittingEndIndex === startIndex) return undefined;
    layouts.push({
      replies: replies.slice(startIndex, fittingEndIndex),
      shortcuts,
      shortcutStyle,
      startIndex,
    });
    startIndex = fittingEndIndex;
  }

  return layouts;
}

function renderLayout(layout: ReplyLayout, theme: Theme): string {
  return layout.replies
    .map((reply, index) => {
      const globalIndex = layout.startIndex + index;
      const shortcut = renderShortcut(
        layout.shortcuts[globalIndex] ?? "",
        layout.shortcutStyle,
        theme,
      );
      const labelColor = globalIndex === 0 ? "accent" : "text";
      return `${shortcut} ${theme.fg(labelColor, reply.label)}`;
    })
    .join(REPLY_GAP);
}

function renderShortcut(shortcut: string, style: ShortcutStyle, theme: Theme): string {
  const parts = shortcut.split("+");
  const key = parts.pop() ?? "";
  const hideDefaultModifier =
    style === "numeric" && parts.length === 1 && parts[0]?.toLowerCase() === "alt";
  const modifier = hideDefaultModifier
    ? ""
    : parts.map((part) => formatModifier(part, style)).join(style === "full" ? "+" : "");
  const chord = [
    modifier.length > 0 ? theme.fg("muted", modifier) : "",
    modifier.length > 0 && style === "full" ? theme.fg("dim", "+") : "",
    theme.fg("accent", formatShortcutKey(key)),
  ].join("");
  return theme.bg(KEYCAP_BACKGROUND, ` ${theme.bold(chord)} `);
}

function formatModifier(modifier: string, style: ShortcutStyle): string {
  const normalized = modifier.toLowerCase();
  if (style !== "full") {
    return { alt: "A", ctrl: "C", shift: "S", super: "M" }[normalized] ?? modifier.at(0) ?? "";
  }
  return { alt: "Alt", ctrl: "Ctrl", shift: "Shift", super: "Super" }[normalized] ?? modifier;
}

function formatShortcutKey(key: string): string {
  const normalized = key.toLowerCase();
  return (
    {
      pageup: "PgUp",
      pagedown: "PgDn",
      escape: "Esc",
      return: "Enter",
    }[normalized] ?? (key.length === 1 ? key.toUpperCase() : key)
  );
}
