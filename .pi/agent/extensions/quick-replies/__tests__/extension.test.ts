import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import type { QuickReply, QuickReplyGenerator, QuickReplyInput } from "../generator";
import { createQuickRepliesExtension, QUICK_REPLY_SHORTCUTS, renderQuickReplyLine } from "../index";

type ExtensionMode = "tui" | "rpc" | "json" | "print";
type EventHandler = (event: never, context: ExtensionContext) => unknown | Promise<unknown>;
type ShortcutHandler = (context: ExtensionContext) => void | Promise<void>;
type WidgetFactory = (tui: never, theme: Theme) => Component;

interface GenerationCall {
  input: QuickReplyInput;
  signal: AbortSignal;
}

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
} as Theme;

const generatedReplies: QuickReply[] = [
  { label: "Review it", message: "Review the implementation." },
  { label: "Explain it", message: "Explain the implementation." },
  { label: "Run checks", message: "Run the broader checks." },
];

const fiveReplies: QuickReply[] = [
  { label: "One", message: "First response" },
  { label: "Two", message: "Second response" },
  { label: "Three", message: "Third response" },
  { label: "Four", message: "Fourth response" },
  { label: "Five", message: "Fifth response" },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createHarness(
  options: {
    mode?: ExtensionMode;
    editorText?: string;
    idle?: boolean;
    generate?: QuickReplyGenerator;
  } = {},
) {
  const handlers = new Map<string, EventHandler>();
  const shortcuts = new Map<string, ShortcutHandler>();
  const sentMessages: string[] = [];
  const widgetStateAtSend: boolean[] = [];
  const generationCalls: GenerationCall[] = [];
  let editorText = options.editorText ?? "";
  let idle = options.idle ?? true;
  let widget: Component | undefined;
  const generate: QuickReplyGenerator = async (_ctx, input, signal) => {
    generationCalls.push({ input, signal });
    return options.generate?.(_ctx, input, signal) ?? generatedReplies;
  };

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

  createQuickRepliesExtension({ generate })(pi);

  async function emit(event: string, value: object = { type: event }): Promise<void> {
    await handlers.get(event)?.(value as never, ctx);
  }

  return {
    sentMessages,
    widgetStateAtSend,
    generationCalls,
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
    async startRun(prompt = "Improve the extension", expandedPrompt = prompt) {
      idle = false;
      await emit("input", { type: "input", text: prompt, source: "interactive" });
      await emit("before_agent_start", { type: "before_agent_start", prompt: expandedPrompt });
      await emit("agent_start");
    },
    async startRunWithoutPrompt() {
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
      await flushPromises();
    },
    emit,
    flush: flushPromises,
    async press(index: number) {
      const shortcut = QUICK_REPLY_SHORTCUTS[index];
      if (shortcut === undefined) throw new Error(`Missing shortcut at index ${index}`);
      await shortcuts.get(shortcut)?.(ctx);
    },
  };
}

async function showGeneratedReplies(harness: ReturnType<typeof createHarness>): Promise<void> {
  await harness.startRun();
  await harness.finishAssistant("Implemented the requested change and ran the focused tests.");
  await harness.settle();
}

describe("quick replies lifecycle", () => {
  test("generates suggestions for a settled declarative response", async () => {
    const harness = createHarness();

    await harness.startRun("Add generated quick replies");
    await harness.finishAssistant("Implemented the feature. All focused tests pass.");
    expect(harness.widgetActive).toBe(false);

    await harness.settle();

    expect(harness.generationCalls).toHaveLength(1);
    expect(harness.generationCalls[0]?.input).toEqual({
      userText: "Add generated quick replies",
      assistantText: "Implemented the feature. All focused tests pass.",
    });
    expect(harness.widgetActive).toBe(true);
    expect(harness.renderWidget()).toHaveLength(1);
  });

  test("uses raw user input instead of expanded skill content", async () => {
    const harness = createHarness();
    await harness.startRun("@research quick replies", "expanded skill instructions".repeat(3_000));
    await harness.finishAssistant("The research is complete.");
    await harness.settle();

    expect(harness.generationCalls[0]?.input.userText).toBe("@research quick replies");
  });

  test("requires a triggering user prompt and finalized assistant text", async () => {
    const withoutUser = createHarness();
    await withoutUser.startRunWithoutPrompt();
    await withoutUser.finishAssistant("Done.");
    await withoutUser.settle();

    const withoutAssistant = createHarness();
    await withoutAssistant.startRun();
    await withoutAssistant.settle();

    expect(withoutUser.generationCalls).toHaveLength(0);
    expect(withoutAssistant.generationCalls).toHaveLength(0);
  });

  test("clears suggestions and aborts generation when a new run starts", async () => {
    const pending = deferred<QuickReply[]>();
    const harness = createHarness({ generate: () => pending.promise });
    await harness.startRun();
    await harness.finishAssistant("The first response is complete.");
    await harness.settle();
    const signal = harness.generationCalls[0]?.signal;

    await harness.startRun("Start another task");
    pending.resolve(generatedReplies);
    await harness.flush();

    expect(signal?.aborted).toBe(true);
    expect(harness.widgetActive).toBe(false);
  });

  test("does not request suggestions when the editor already contains text", async () => {
    const harness = createHarness({ editorText: "my answer" });

    await harness.startRun();
    await harness.finishAssistant("The change is complete.");
    await harness.settle();

    expect(harness.generationCalls).toHaveLength(0);
    expect(harness.widgetActive).toBe(false);
  });

  test("discards generated suggestions when the user starts typing", async () => {
    const pending = deferred<QuickReply[]>();
    const harness = createHarness({ generate: () => pending.promise });
    await harness.startRun();
    await harness.finishAssistant("The change is complete.");
    await harness.settle();

    harness.setEditorText("custom response");
    pending.resolve(generatedReplies);
    await harness.flush();

    expect(harness.widgetActive).toBe(false);
  });

  test("aborts generation when submitted input arrives", async () => {
    const pending = deferred<QuickReply[]>();
    const harness = createHarness({ generate: () => pending.promise });
    await harness.startRun();
    await harness.finishAssistant("The change is complete.");
    await harness.settle();
    const signal = harness.generationCalls[0]?.signal;

    await harness.emit("input");

    expect(signal?.aborted).toBe(true);
    expect(harness.widgetActive).toBe(false);
  });

  test("aborts generation when a blocking UI prompt opens and never revives it", async () => {
    const pending = deferred<QuickReply[]>();
    const harness = createHarness({ generate: () => pending.promise });
    await harness.startRun();
    await harness.finishAssistant("The change is complete.");
    await harness.settle();
    const signal = harness.generationCalls[0]?.signal;

    await harness.emit("ui_prompt_start");
    pending.resolve(generatedReplies);
    await harness.emit("ui_prompt_end");
    await harness.flush();

    expect(signal?.aborted).toBe(true);
    expect(harness.widgetActive).toBe(false);
  });

  test("silently ignores generation errors and invalid reply counts", async () => {
    const failed = createHarness({ generate: async () => Promise.reject(new Error("failed")) });
    await failed.startRun();
    await failed.finishAssistant("Done.");
    await failed.settle();

    const oneReply = createHarness({ generate: async () => generatedReplies.slice(0, 1) });
    await oneReply.startRun();
    await oneReply.finishAssistant("Done.");
    await oneReply.settle();

    const sixReplies = createHarness({
      generate: async () =>
        Array.from({ length: 6 }, (_, index) => ({
          label: `Choice ${index + 1}`,
          message: `Choose ${index + 1}`,
        })),
    });
    await sixReplies.startRun();
    await sixReplies.finishAssistant("Done.");
    await sixReplies.settle();

    expect(failed.widgetActive).toBe(false);
    expect(oneReply.widgetActive).toBe(false);
    expect(sixReplies.widgetActive).toBe(false);
  });

  test("deduplicates repeated settled events", async () => {
    const harness = createHarness();
    await showGeneratedReplies(harness);

    await harness.emit("agent_settled");
    await harness.flush();

    expect(harness.generationCalls).toHaveLength(1);
  });

  test("uses only the most recent finalized assistant message", async () => {
    const harness = createHarness();
    await harness.startRun();
    await harness.finishAssistant("An intermediate response.");
    await harness.finishAssistant("The final response.");
    await harness.settle();

    expect(harness.generationCalls[0]?.input.assistantText).toBe("The final response.");
  });

  test("does not generate outside interactive idle TUI mode", async () => {
    const rpc = createHarness({ mode: "rpc" });
    await rpc.startRun();
    await rpc.finishAssistant("Done.");
    await rpc.settle();

    const busy = createHarness();
    await busy.startRun();
    await busy.finishAssistant("Done.");
    busy.setIdle(false);
    await busy.emit("agent_settled");
    await busy.flush();

    expect(rpc.generationCalls).toHaveLength(0);
    expect(busy.generationCalls).toHaveLength(0);
  });

  test.each([
    "session_start",
    "session_shutdown",
    "session_before_switch",
    "session_before_fork",
    "session_before_tree",
    "session_tree",
  ])("aborts generation and clears replies on %s", async (event) => {
    const pending = deferred<QuickReply[]>();
    const harness = createHarness({ generate: () => pending.promise });
    await harness.startRun();
    await harness.finishAssistant("Done.");
    await harness.settle();
    const signal = harness.generationCalls[0]?.signal;

    await harness.emit(event);
    pending.resolve(generatedReplies);
    await harness.flush();

    expect(signal?.aborted).toBe(true);
    expect(harness.widgetActive).toBe(false);
  });

  test("clears state before sending exactly one generated reply", async () => {
    const harness = createHarness();
    await showGeneratedReplies(harness);
    harness.renderWidget();

    await harness.press(0);
    await harness.press(0);

    expect(harness.sentMessages).toEqual(["Review the implementation."]);
    expect(harness.widgetStateAtSend).toEqual([false]);
    expect(harness.widgetActive).toBe(false);
  });

  test("submits fourth and fifth replies only when visible", async () => {
    const wide = createHarness({ generate: async () => fiveReplies });
    await showGeneratedReplies(wide);
    wide.renderWidget(120);
    await wide.press(4);

    const narrow = createHarness({ generate: async () => fiveReplies });
    await showGeneratedReplies(narrow);
    narrow.renderWidget(30);
    await narrow.press(4);

    expect(wide.sentMessages).toEqual(["Fifth response"]);
    expect(narrow.sentMessages).toEqual([]);
  });
});

describe("quick reply widget", () => {
  test("registers five alternative-digit shortcuts", () => {
    expect(QUICK_REPLY_SHORTCUTS).toEqual(["alt+1", "alt+2", "alt+3", "alt+4", "alt+5"]);
  });

  test("uses the preferred full layout when five replies fit", () => {
    const rendered = renderQuickReplyLine(fiveReplies, 120, theme);

    expect(stripTerminalSequences(rendered?.line ?? "")).toBe(
      "‹Alt+1› One  ‹Alt+2› Two  ‹Alt+3› Three  ‹Alt+4› Four  ‹Alt+5› Five",
    );
    expect(rendered?.visibleReplyCount).toBe(5);
  });

  test("shortens hints before removing replies", () => {
    const rendered = renderQuickReplyLine(fiveReplies, 50, theme);

    expect(stripTerminalSequences(rendered?.line ?? "")).toBe(
      "‹1› One  ‹2› Two  ‹3› Three  ‹4› Four  ‹5› Five",
    );
    expect(rendered?.visibleReplyCount).toBe(5);
    expect(visibleWidth(rendered?.line ?? "")).toBeLessThanOrEqual(50);
  });

  test("removes trailing replies instead of truncating labels", () => {
    const rendered = renderQuickReplyLine(fiveReplies, 30, theme);
    const plain = stripTerminalSequences(rendered?.line ?? "");

    expect(plain).toBe("‹A1› One  ‹A2› Two  ‹A3› Three");
    expect(rendered?.visibleReplyCount).toBe(3);
    expect(plain).not.toContain("Four");
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

    renderQuickReplyLine(fiveReplies, 120, trackingTheme);

    expect(backgrounds).toEqual([]);
  });

  test("hides instead of truncating a reply message", () => {
    expect(renderQuickReplyLine(fiveReplies, 6, theme)).toBeUndefined();
  });
});
