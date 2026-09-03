import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import type { QuickReply } from "../classifier";
import quickRepliesExtension, { QUICK_REPLY_SHORTCUTS, renderQuickReplyLine } from "../index";

type ExtensionMode = "tui" | "rpc" | "json" | "print";
type EventHandler = (event: never, context: ExtensionContext) => unknown | Promise<unknown>;
type ShortcutHandler = (context: ExtensionContext) => void | Promise<void>;
type WidgetFactory = (tui: never, theme: Theme) => Component;

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
} as Theme;

function createHarness(
  options: { mode?: ExtensionMode; editorText?: string; idle?: boolean } = {},
) {
  const handlers = new Map<string, EventHandler>();
  const shortcuts = new Map<string, ShortcutHandler>();
  const sentMessages: string[] = [];
  const widgetStateAtSend: boolean[] = [];
  let editorText = options.editorText ?? "";
  let idle = options.idle ?? true;
  let widget: Component | undefined;

  const pi = {
    on: (event: string, handler: EventHandler) => handlers.set(event, handler),
    registerShortcut: (shortcut: string, definition: { handler: ShortcutHandler }) => {
      shortcuts.set(shortcut, definition.handler);
    },
    sendUserMessage: (message: string) => {
      widgetStateAtSend.push(widget !== undefined);
      sentMessages.push(message);
    },
  } as unknown as ExtensionAPI;

  const ctx = {
    mode: options.mode ?? "tui",
    isIdle: () => idle,
    ui: {
      getEditorText: () => editorText,
      setWidget: (_key: string, content: unknown) => {
        widget =
          typeof content === "function"
            ? (content as WidgetFactory)(undefined as never, theme)
            : undefined;
      },
    },
  } as unknown as ExtensionContext;

  quickRepliesExtension(pi);

  async function emit(event: string, value: object = { type: event }): Promise<void> {
    await handlers.get(event)?.(value as never, ctx);
  }

  return {
    sentMessages,
    widgetStateAtSend,
    get widgetActive() {
      return widget !== undefined;
    },
    renderWidget(width = 100) {
      return widget?.render(width) ?? [];
    },
    setEditorText(value: string) {
      editorText = value;
    },
    setIdle(value: boolean) {
      idle = value;
    },
    async startRun() {
      idle = false;
      await emit("agent_start");
    },
    async finishAssistant(text: string) {
      await emit("message_end", {
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text }] },
      });
    },
    async settle() {
      idle = true;
      await emit("agent_settled");
    },
    emit,
    async press(index: number) {
      const shortcut = QUICK_REPLY_SHORTCUTS[index];
      if (shortcut === undefined) throw new Error(`Missing shortcut at index ${index}`);
      await shortcuts.get(shortcut)?.(ctx);
    },
  };
}

async function showPermissionReplies(harness: ReturnType<typeof createHarness>): Promise<void> {
  await harness.startRun();
  await harness.finishAssistant("Should I apply this change?");
  await harness.settle();
}

describe("quick replies lifecycle", () => {
  test("shows suggestions only after the matching run settles", async () => {
    const harness = createHarness();

    await harness.startRun();
    await harness.finishAssistant("Should I apply this change?");
    expect(harness.widgetActive).toBe(false);

    await harness.settle();
    expect(harness.widgetActive).toBe(true);
    expect(harness.renderWidget()).toHaveLength(1);
  });

  test("clears suggestions when a new agent run starts", async () => {
    const harness = createHarness();
    await showPermissionReplies(harness);

    await harness.startRun();

    expect(harness.widgetActive).toBe(false);
  });

  test("does not show suggestions when the editor already contains text", async () => {
    const harness = createHarness({ editorText: "my answer" });

    await harness.startRun();
    await harness.finishAssistant("Should I apply this change?");
    await harness.settle();

    expect(harness.widgetActive).toBe(false);
  });

  test("normal editor text hides the widget and disables shortcuts without modifying text", async () => {
    const harness = createHarness();
    await showPermissionReplies(harness);
    expect(harness.renderWidget()).toHaveLength(1);

    harness.setEditorText("custom response");

    expect(harness.renderWidget()).toEqual([]);
    await harness.press(0);
    expect(harness.sentMessages).toEqual([]);
  });

  test("clears suggestions when a blocking UI prompt opens", async () => {
    const harness = createHarness();
    await showPermissionReplies(harness);

    await harness.emit("ui_prompt_start", {
      type: "ui_prompt_start",
      reason: "ui_prompt",
      kind: "confirm",
    });

    expect(harness.widgetActive).toBe(false);
    await harness.press(0);
    expect(harness.sentMessages).toEqual([]);
  });

  test("does not revive a candidate after a prompt closes", async () => {
    const harness = createHarness();
    await harness.startRun();
    await harness.finishAssistant("Should I apply this change?");
    await harness.emit("ui_prompt_start");
    await harness.settle();
    await harness.emit("ui_prompt_end");

    expect(harness.widgetActive).toBe(false);
  });

  test("inactive shortcuts do not send messages", async () => {
    const harness = createHarness();

    await harness.press(0);
    await harness.press(1);
    await harness.press(2);

    expect(harness.sentMessages).toEqual([]);
  });

  test("shortcuts stay inactive until the widget has rendered their reply", async () => {
    const harness = createHarness();
    await showPermissionReplies(harness);

    await harness.press(0);

    expect(harness.sentMessages).toEqual([]);
  });

  test("a reply removed by the narrow layout cannot be submitted", async () => {
    const harness = createHarness();
    await showPermissionReplies(harness);
    harness.renderWidget(40);

    await harness.press(2);

    expect(harness.sentMessages).toEqual([]);
  });

  test("selecting a valid suggestion clears state before sending exactly one message", async () => {
    const harness = createHarness();
    await showPermissionReplies(harness);
    harness.renderWidget();

    await harness.press(0);
    await harness.press(0);

    expect(harness.sentMessages).toEqual(["Go ahead"]);
    expect(harness.widgetStateAtSend).toEqual([false]);
    expect(harness.widgetActive).toBe(false);
  });

  test("a stale shortcut cannot submit a reply from an earlier run", async () => {
    const harness = createHarness();
    await showPermissionReplies(harness);

    await harness.startRun();
    await harness.press(0);

    expect(harness.sentMessages).toEqual([]);
  });

  test("does not reuse an assistant message from an earlier run", async () => {
    const harness = createHarness();
    await harness.startRun();
    await harness.finishAssistant("Should I apply this change?");

    await harness.startRun();
    await harness.settle();

    expect(harness.widgetActive).toBe(false);
  });

  test("uses only the most recent finalized assistant message", async () => {
    const harness = createHarness();
    await harness.startRun();
    await harness.finishAssistant("Should I apply this change?");
    await harness.finishAssistant("The change is already complete.");
    await harness.settle();

    expect(harness.widgetActive).toBe(false);
  });

  test("does not render outside interactive TUI mode", async () => {
    const harness = createHarness({ mode: "rpc" });

    await showPermissionReplies(harness);

    expect(harness.widgetActive).toBe(false);
  });

  test("does not render while the agent is busy", async () => {
    const harness = createHarness();
    await harness.startRun();
    await harness.finishAssistant("Should I apply this change?");
    harness.setIdle(false);
    await harness.emit("agent_settled");

    expect(harness.widgetActive).toBe(false);
  });

  test.each([
    "input",
    "session_start",
    "session_shutdown",
    "session_before_switch",
    "session_before_fork",
    "session_before_tree",
    "session_tree",
  ])("clears transient suggestions on %s", async (event) => {
    const harness = createHarness();
    await showPermissionReplies(harness);

    await harness.emit(event);

    expect(harness.widgetActive).toBe(false);
    await harness.press(0);
    expect(harness.sentMessages).toEqual([]);
  });
});

describe("quick reply widget", () => {
  const permissionReplies: QuickReply[] = [
    { label: "Go ahead", message: "Go ahead" },
    { label: "Not now", message: "Not now" },
    { label: "Explain first", message: "Explain first" },
  ];

  test("uses unbound alternative-digit shortcuts", () => {
    expect(QUICK_REPLY_SHORTCUTS).toEqual(["alt+1", "alt+2", "alt+3"]);
  });

  test("uses the preferred full layout when it fits", () => {
    const rendered = renderQuickReplyLine(permissionReplies, 100, theme);

    expect(stripTerminalSequences(rendered?.line ?? "")).toBe(
      "‹Alt+1› Go ahead  ‹Alt+2› Not now  ‹Alt+3› Explain first",
    );
    expect(rendered?.visibleReplyCount).toBe(3);
  });

  test("removes the third reply and shortens hints at narrower widths", () => {
    const rendered = renderQuickReplyLine(permissionReplies, 40, theme);

    expect(stripTerminalSequences(rendered?.line ?? "")).toBe("‹A1› Go ahead  ‹A2› Not now");
    expect(rendered?.visibleReplyCount).toBe(2);
  });

  test("falls back to numeric hints without wrapping", () => {
    const rendered = renderQuickReplyLine(permissionReplies, 25, theme);

    expect(stripTerminalSequences(rendered?.line ?? "")).toBe("‹1› Go ahead  ‹2› Not now");
    expect(visibleWidth(rendered?.line ?? "")).toBeLessThanOrEqual(25);
  });

  test("avoids full-cell backgrounds around outlined keycaps", () => {
    const backgrounds: string[] = [];
    const trackingTheme = {
      ...theme,
      bg: (color: string, text: string) => {
        backgrounds.push(color);
        return text;
      },
    } as Theme;

    renderQuickReplyLine(permissionReplies, 100, trackingTheme);

    expect(backgrounds).toEqual([]);
  });

  test("hides instead of truncating a reply message", () => {
    expect(renderQuickReplyLine(permissionReplies, 9, theme)).toBeUndefined();
  });
});
