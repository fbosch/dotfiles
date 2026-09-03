import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import { detectQuickReplies, extractVisibleAssistantProse, type QuickReply } from "./classifier";

export const QUICK_REPLY_SHORTCUTS = ["ctrl+1", "ctrl+2", "ctrl+3"] as const;

const WIDGET_KEY = "quick-replies";
const REPLY_GAP = "   ";

type ShortcutStyle = "full" | "short" | "numeric";

interface ActiveQuickReplies {
  runId: number;
  replies: QuickReply[];
}

interface FinalizedAssistantProse {
  runId: number;
  prose: string;
}

interface ReplyLayout {
  replies: readonly QuickReply[];
  shortcutStyle: ShortcutStyle;
}

export interface RenderedQuickReplies {
  line: string;
  visibleReplyCount: number;
}

export function renderQuickReplyLine(
  replies: readonly QuickReply[],
  width: number,
  theme: Theme,
): RenderedQuickReplies | undefined {
  if (replies.length === 0 || width <= 0) return undefined;

  const primaryReplies = replies.slice(0, Math.min(2, replies.length));
  const layouts: ReplyLayout[] = [
    { replies, shortcutStyle: "full" },
    { replies, shortcutStyle: "short" },
  ];
  if (primaryReplies.length !== replies.length) {
    layouts.push({ replies: primaryReplies, shortcutStyle: "short" });
  }
  layouts.push({ replies: primaryReplies, shortcutStyle: "numeric" });

  for (const layout of layouts) {
    const line = renderLayout(layout, theme);
    if (visibleWidth(line) <= width) {
      return { line, visibleReplyCount: layout.replies.length };
    }
  }

  const firstReply = primaryReplies[0];
  if (firstReply === undefined) return undefined;

  const line = renderLayout({ replies: [firstReply], shortcutStyle: "numeric" }, theme);
  return visibleWidth(line) <= width ? { line, visibleReplyCount: 1 } : undefined;
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

export default function quickRepliesExtension(pi: ExtensionAPI): void {
  let runSequence = 0;
  let currentRunId: number | undefined;
  let latestSettledRunId: number | undefined;
  let finalizedAssistant: FinalizedAssistantProse | undefined;
  let activeReplies: ActiveQuickReplies | undefined;
  let widget: QuickReplyWidget | undefined;
  let widgetMounted = false;
  let uiPromptActive = false;

  function clearWidget(ctx: ExtensionContext): void {
    activeReplies = undefined;
    widget = undefined;
    if (widgetMounted && ctx.mode === "tui") {
      ctx.ui.setWidget(WIDGET_KEY, undefined);
    }
    widgetMounted = false;
  }

  function invalidateSettledState(ctx: ExtensionContext): void {
    finalizedAssistant = undefined;
    latestSettledRunId = undefined;
    clearWidget(ctx);
  }

  function resetSessionState(ctx: ExtensionContext): void {
    currentRunId = undefined;
    uiPromptActive = false;
    invalidateSettledState(ctx);
  }

  function showReplies(ctx: ExtensionContext, runId: number, replies: QuickReply[]): void {
    activeReplies = { runId, replies };
    widgetMounted = true;
    ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => {
      widget = new QuickReplyWidget(
        replies,
        theme,
        () => ctx.ui.getEditorText(),
        () =>
          activeReplies?.runId === runId &&
          latestSettledRunId === runId &&
          uiPromptActive === false &&
          ctx.isIdle(),
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
      ctx.mode !== "tui" ||
      ctx.isIdle() === false ||
      uiPromptActive ||
      ctx.ui.getEditorText().length > 0 ||
      current.runId !== currentRunId ||
      current.runId !== latestSettledRunId ||
      widget === undefined ||
      widget.isReplyVisible(index) === false
    ) {
      return;
    }

    invalidateSettledState(ctx);
    pi.sendUserMessage(reply.message);
  }

  pi.on("session_start", (_event, ctx) => resetSessionState(ctx));
  pi.on("session_shutdown", (_event, ctx) => resetSessionState(ctx));
  pi.on("session_before_switch", (_event, ctx) => resetSessionState(ctx));
  pi.on("session_before_fork", (_event, ctx) => resetSessionState(ctx));
  pi.on("session_before_tree", (_event, ctx) => resetSessionState(ctx));
  pi.on("session_tree", (_event, ctx) => resetSessionState(ctx));

  pi.on("input", (_event, ctx) => invalidateSettledState(ctx));

  pi.on("ui_prompt_start", (_event, ctx) => {
    uiPromptActive = true;
    invalidateSettledState(ctx);
  });

  pi.on("ui_prompt_end", () => {
    uiPromptActive = false;
  });

  pi.on("agent_start", (_event, ctx) => {
    runSequence += 1;
    currentRunId = runSequence;
    invalidateSettledState(ctx);
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
    latestSettledRunId = settledRunId;

    if (
      settledRunId === undefined ||
      ctx.mode !== "tui" ||
      ctx.isIdle() === false ||
      uiPromptActive ||
      ctx.ui.getEditorText().length > 0 ||
      finalizedAssistant?.runId !== settledRunId
    ) {
      clearWidget(ctx);
      return;
    }

    const replies = detectQuickReplies(finalizedAssistant.prose);
    if (replies.length === 0) {
      clearWidget(ctx);
      return;
    }

    showReplies(ctx, settledRunId, replies);
  });

  QUICK_REPLY_SHORTCUTS.forEach((shortcut, index) => {
    pi.registerShortcut(shortcut, {
      description: `Send quick reply ${index + 1}`,
      handler: (ctx) => selectReply(index, ctx),
    });
  });
}

function renderLayout(layout: ReplyLayout, theme: Theme): string {
  return layout.replies
    .map((reply, index) => {
      const shortcut = formatShortcut(QUICK_REPLY_SHORTCUTS[index] ?? "", layout.shortcutStyle);
      const label = index === 0 ? theme.fg("accent", reply.label) : theme.fg("text", reply.label);
      return `${theme.fg("dim", shortcut)} ${label}`;
    })
    .join(REPLY_GAP);
}

function formatShortcut(shortcut: string, style: ShortcutStyle): string {
  const display = shortcut.replace("ctrl", "Ctrl");
  if (style === "full") return `[${display}]`;
  if (style === "short") return display;
  return display.at(-1) ?? "";
}
