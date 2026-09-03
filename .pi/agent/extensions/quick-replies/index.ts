import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import {
  extractVisibleAssistantProse,
  generateQuickReplies,
  isSlashCommand,
  type QuickReply,
  type QuickReplyGenerator,
} from "./generator";

export const QUICK_REPLY_SHORTCUTS = ["alt+1", "alt+2", "alt+3", "alt+4", "alt+5"] as const;

const WIDGET_KEY = "quick-replies";
const REPLY_GAP = "  ";
const MIN_GENERATED_REPLIES = 1;
const MAX_GENERATED_REPLIES = QUICK_REPLY_SHORTCUTS.length;

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
  shortcutStyle: ShortcutStyle;
}

export interface RenderedQuickReplies {
  line: string;
  visibleReplyCount: number;
}

export interface QuickRepliesDependencies {
  generate?: QuickReplyGenerator;
}

export function renderQuickReplyLine(
  replies: readonly QuickReply[],
  width: number,
  theme: Theme,
): RenderedQuickReplies | undefined {
  if (replies.length === 0 || width <= 0) return undefined;

  for (const layout of replyLayouts(replies)) {
    const line = renderLayout(layout, theme);
    if (visibleWidth(line) <= width) {
      return { line, visibleReplyCount: layout.replies.length };
    }
  }

  return undefined;
}

class QuickReplyWidget implements Component {
  private visibleReplyCount: number;

  constructor(
    private readonly replies: readonly QuickReply[],
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

    const rendered = renderQuickReplyLine(this.replies, width, this.theme);
    if (rendered === undefined) {
      this.visibleReplyCount = 0;
      return [];
    }

    this.visibleReplyCount = rendered.visibleReplyCount;
    return [rendered.line];
  }

  isReplyVisible(index: number): boolean {
    return index >= 0 && index < this.visibleReplyCount;
  }
}

export function createQuickRepliesExtension(dependencies: QuickRepliesDependencies = {}) {
  const generate = dependencies.generate ?? generateQuickReplies;

  return (pi: ExtensionAPI): void => {
    let runSequence = 0;
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
      currentRunId = undefined;
      pendingUserText = undefined;
      currentUserText = undefined;
      uiPromptActive = false;
      invalidateSettledState(ctx);
    }

    function canShowReplies(ctx: ExtensionContext, runId: number): boolean {
      return (
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
          theme,
          () => ctx.ui.getEditorText(),
          () => activeReplies?.runId === runId && canShowReplies(ctx, runId),
        );
        return widget;
      });
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
            replies.length > MAX_GENERATED_REPLIES ||
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

    pi.on("session_start", (_event, ctx) => resetSessionState(ctx));
    pi.on("session_shutdown", (_event, ctx) => resetSessionState(ctx));
    pi.on("session_before_switch", (_event, ctx) => resetSessionState(ctx));
    pi.on("session_before_fork", (_event, ctx) => resetSessionState(ctx));
    pi.on("session_before_tree", (_event, ctx) => resetSessionState(ctx));
    pi.on("session_tree", (_event, ctx) => resetSessionState(ctx));

    pi.on("input", (event, ctx) => {
      invalidateSettledState(ctx);
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

    QUICK_REPLY_SHORTCUTS.forEach((shortcut, index) => {
      pi.registerShortcut(shortcut, {
        description: `Send quick reply ${index + 1}`,
        handler: (ctx) => selectReply(index, ctx),
      });
    });
  };
}

export default createQuickRepliesExtension();

function replyLayouts(replies: readonly QuickReply[]): ReplyLayout[] {
  const layouts: ReplyLayout[] = [
    { replies, shortcutStyle: "full" },
    { replies, shortcutStyle: "short" },
    { replies, shortcutStyle: "numeric" },
  ];

  for (let count = replies.length - 1; count >= 2; count -= 1) {
    const visibleReplies = replies.slice(0, count);
    layouts.push({ replies: visibleReplies, shortcutStyle: "short" });
    layouts.push({ replies: visibleReplies, shortcutStyle: "numeric" });
  }
  layouts.push({ replies: replies.slice(0, 1), shortcutStyle: "numeric" });
  return layouts;
}

function renderLayout(layout: ReplyLayout, theme: Theme): string {
  return layout.replies
    .map((reply, index) => {
      const shortcut = formatShortcut(QUICK_REPLY_SHORTCUTS[index] ?? "", layout.shortcutStyle);
      const shortcutColor = index === 0 ? "accent" : "muted";
      const labelColor = index === 0 ? "accent" : "text";
      const keycap = theme.fg(shortcutColor, `‹${shortcut}›`);
      return `${keycap} ${theme.fg(labelColor, reply.label)}`;
    })
    .join(REPLY_GAP);
}

function formatShortcut(shortcut: string, style: ShortcutStyle): string {
  const display = shortcut.charAt(0).toUpperCase() + shortcut.slice(1);
  if (style === "full") return display;
  const digit = display.at(-1) ?? "";
  return style === "short" ? `A${digit}` : digit;
}
