import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import type { QuickReply, QuickReplyGenerator, QuickReplyInput } from "../generator";
import {
  createQuickRepliesExtension,
  QUICK_REPLY_SHORTCUTS,
  renderQuickReplyPanel,
} from "../index";
import type { QuickRepliesSettings } from "../settings";

type ExtensionMode = "tui" | "rpc" | "json" | "print";
type EventHandler = (event: never, context: ExtensionContext) => unknown | Promise<unknown>;
type ShortcutHandler = (context: ExtensionContext) => void | Promise<void>;
type CommandHandler = (args: string, context: ExtensionContext) => void | Promise<void>;
type ArgumentCompletions = (prefix: string) => unknown[] | null;
type WidgetFactory = (tui: never, theme: Theme) => Component;

interface GenerationCall {
  input: QuickReplyInput;
  signal: AbortSignal;
}

const PANEL_BACKGROUND = "\u001b[48;5;236m";

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  getBgAnsi: () => PANEL_BACKGROUND,
} as unknown as Theme;

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
    enabled?: boolean;
    shortcuts?: QuickRepliesSettings["shortcuts"];
    generate?: QuickReplyGenerator;
  } = {},
) {
  const handlers = new Map<string, EventHandler>();
  const shortcuts = new Map<string, ShortcutHandler>();
  const sentMessages: string[] = [];
  const sendOptions: unknown[] = [];
  const widgetStateAtSend: boolean[] = [];
  const generationCalls: GenerationCall[] = [];
  let editorText = options.editorText ?? "";
  let idle = options.idle ?? true;
  let configuredEnabled = options.enabled ?? true;
  let widget: Component | undefined;
  let command: CommandHandler | undefined;
  let getArgumentCompletions: ArgumentCompletions | undefined;
  const notifications: string[] = [];
  const generate: QuickReplyGenerator = async (_ctx, input, signal) => {
    generationCalls.push({ input, signal });
    return options.generate?.(_ctx, input, signal) ?? generatedReplies;
  };

  const pi = {
    on: (event: string, handler: EventHandler) => handlers.set(event, handler),
    registerShortcut: (shortcut: string, definition: { handler: ShortcutHandler }) => {
      shortcuts.set(shortcut, definition.handler);
    },
    registerCommand: (
      name: string,
      definition: { handler: CommandHandler; getArgumentCompletions?: ArgumentCompletions },
    ) => {
      if (name !== "quick-replies") return;
      command = definition.handler;
      getArgumentCompletions = definition.getArgumentCompletions;
    },
    sendUserMessage: (message: string, sendUserOptions: { expandPromptTemplates?: boolean }) => {
      widgetStateAtSend.push(widget !== undefined);
      sentMessages.push(message);
      sendOptions.push(sendUserOptions);
    },
  } as unknown as ExtensionAPI;

  const ctx = {
    mode: options.mode ?? "tui",
    hasUI: true,
    isIdle: () => idle,
    ui: {
      getEditorText: () => editorText,
      notify: (message: string) => {
        notifications.push(message);
      },
      setEditorText: (value: string) => {
        editorText = value;
      },
      setWidget: (_key: string, content: unknown) => {
        widget =
          typeof content === "function"
            ? (content as WidgetFactory)(undefined as never, theme)
            : undefined;
      },
    },
  } as unknown as ExtensionContext;

  createQuickRepliesExtension({
    generate,
    readSettings: (): QuickRepliesSettings => ({
      enabled: configuredEnabled,
      ...(options.shortcuts === undefined ? {} : { shortcuts: options.shortcuts }),
      warnings: [],
    }),
    writeSettings: (value) => {
      configuredEnabled = value;
    },
  })(pi);

  async function emit(event: string, value: object = { type: event }): Promise<void> {
    await handlers.get(event)?.(value as never, ctx);
  }

  return {
    sentMessages,
    sendOptions,
    widgetStateAtSend,
    generationCalls,
    notifications,
    get editorText() {
      return editorText;
    },
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
    get configuredEnabled() {
      return configuredEnabled;
    },
    get registeredShortcuts() {
      return [...shortcuts.keys()];
    },
    async runCommand(args: string) {
      if (command === undefined) throw new Error("quick-replies command was not registered");
      await command(args, ctx);
    },
    argumentCompletions(prefix: string) {
      if (getArgumentCompletions === undefined) {
        throw new Error("quick-replies completions were not registered");
      }
      return getArgumentCompletions(prefix);
    },
    async press(index: number) {
      const shortcut = [...shortcuts.keys()][index];
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
    expect(harness.renderWidget()).toHaveLength(2);
  });

  test("honors the disabled global setting without generating replies", async () => {
    const harness = createHarness({ enabled: false });
    await harness.emit("session_start");
    await harness.startRun();
    await harness.finishAssistant("The change is complete.");
    await harness.settle();

    expect(harness.generationCalls).toHaveLength(0);
    expect(harness.widgetActive).toBe(false);
  });

  test("disables and persists quick replies immediately", async () => {
    const pending = deferred<QuickReply[]>();
    const harness = createHarness({ generate: () => pending.promise });
    await showGeneratedReplies(harness);
    const signal = harness.generationCalls[0]?.signal;

    await harness.runCommand("off");
    pending.resolve(generatedReplies);
    await harness.flush();
    await harness.press(0);

    expect(harness.configuredEnabled).toBe(false);
    expect(signal?.aborted).toBe(true);
    expect(harness.widgetActive).toBe(false);
    expect(harness.sentMessages).toEqual([]);
    expect(harness.notifications.at(-1)).toBe("Quick replies disabled");
  });

  test("re-enables generation for a later response", async () => {
    const harness = createHarness({ enabled: false });
    await harness.emit("session_start");

    await harness.runCommand("on");
    await showGeneratedReplies(harness);

    expect(harness.configuredEnabled).toBe(true);
    expect(harness.generationCalls).toHaveLength(1);
    expect(harness.widgetActive).toBe(true);
  });

  test("reports status and validates quick-replies command arguments", async () => {
    const harness = createHarness();

    await harness.runCommand("");
    await harness.runCommand("toggle");

    expect(harness.notifications).toEqual([
      "Quick replies enabled",
      "Usage: /quick-replies [on|off]",
    ]);
  });

  test("completes quick-replies command actions", () => {
    const harness = createHarness();

    expect(harness.argumentCompletions("")).toEqual([
      { value: "on", label: "on" },
      { value: "off", label: "off" },
    ]);
    expect(harness.argumentCompletions("o")).toEqual([
      { value: "on", label: "on" },
      { value: "off", label: "off" },
    ]);
    expect(harness.argumentCompletions("on ")).toBeNull();
  });

  test("uses raw user input instead of expanded skill content", async () => {
    const harness = createHarness();
    await harness.startRun("@research quick replies", "expanded skill instructions".repeat(3_000));
    await harness.finishAssistant("The research is complete.");
    await harness.settle();

    expect(harness.generationCalls[0]?.input.userText).toBe("@research quick replies");
  });

  test.each(["steer", "followUp"] as const)(
    "uses the latest raw %s input with the final assistant response",
    async (streamingBehavior) => {
      const harness = createHarness();
      await harness.startRun("Start with the first request");
      await harness.finishAssistant("The first response.");
      await harness.emit("input", {
        type: "input",
        text: "focus on the lifecycle fix",
        source: "interactive",
        streamingBehavior,
      });
      await harness.finishAssistant("The lifecycle fix is complete.");
      await harness.settle();

      expect(harness.generationCalls[0]?.input).toEqual({
        userText: "focus on the lifecycle fix",
        assistantText: "The lifecycle fix is complete.",
      });
    },
  );

  test("preserves the user prompt across low-level retry runs", async () => {
    const harness = createHarness();
    await harness.startRun("Fix the retry behavior");
    await harness.finishAssistant("The request failed and will retry.");

    await harness.emit("agent_start");
    await harness.finishAssistant("The retry behavior is fixed.");
    await harness.settle();

    expect(harness.generationCalls[0]?.input).toEqual({
      userText: "Fix the retry behavior",
      assistantText: "The retry behavior is fixed.",
    });
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

  test("silently ignores generation errors and excessive reply counts", async () => {
    const failed = createHarness({ generate: async () => Promise.reject(new Error("failed")) });
    await failed.startRun();
    await failed.finishAssistant("Done.");
    await failed.settle();

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
    expect(sixReplies.widgetActive).toBe(false);
  });

  test.each([
    { label: "/model", message: "/model" },
    { label: "/skill:research", message: "/skill:research quick replies" },
  ])("prefills slash command $message for confirmation in the editor", async (reply) => {
    const harness = createHarness({ generate: async () => [reply] });
    await harness.startRun();
    await harness.finishAssistant(`Run \`${reply.message}\`.`);
    await harness.settle();
    harness.renderWidget(50);

    await harness.press(0);

    expect(harness.sentMessages).toEqual([]);
    expect(harness.sendOptions).toEqual([]);
    expect(harness.editorText).toBe(reply.message);
    expect(harness.widgetActive).toBe(false);
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
    expect(harness.sendOptions).toEqual([{ expandPromptTemplates: false }]);
    expect(harness.widgetStateAtSend).toEqual([false]);
    expect(harness.widgetActive).toBe(false);
  });

  test("keeps wrapped replies selectable and rejects replies when the panel cannot render", async () => {
    const narrow = createHarness({ generate: async () => fiveReplies });
    await showGeneratedReplies(narrow);
    narrow.renderWidget(30);
    await narrow.press(4);

    const hidden = createHarness({ generate: async () => fiveReplies });
    await showGeneratedReplies(hidden);
    hidden.renderWidget(6);
    await hidden.press(4);

    expect(narrow.sentMessages).toEqual(["Fifth response"]);
    expect(hidden.sentMessages).toEqual([]);
  });
});

describe("quick reply widget", () => {
  test("registers five alternative-digit shortcuts", () => {
    expect(QUICK_REPLY_SHORTCUTS).toEqual(["alt+1", "alt+2", "alt+3", "alt+4", "alt+5"]);
  });

  test("registers, renders, and handles configured shortcuts", async () => {
    const shortcuts = ["ctrl+1", "ctrl+2", "ctrl+3", "ctrl+4", "ctrl+5"] as const;
    const harness = createHarness({ shortcuts });

    expect(harness.registeredShortcuts).toEqual([...shortcuts]);
    await showGeneratedReplies(harness);
    expect(stripTerminalSequences(harness.renderWidget(120)[0] ?? "")).toContain(
      "Ctrl+1  Review it",
    );

    await harness.press(0);
    expect(harness.sentMessages).toEqual(["Review the implementation."]);
  });

  test("renders compact suggestions with vertical spacing", () => {
    const rendered = renderQuickReplyPanel(fiveReplies, 120, theme);
    const firstLine = stripTerminalSequences(rendered?.lines[0] ?? "").trimEnd();

    expect(firstLine).toBe("   Alt+1  One   Alt+2  Two   Alt+3  Three   Alt+4  Four   Alt+5  Five");
    expect(rendered?.visibleReplyCount).toBe(5);
    expect(rendered?.lines).toHaveLength(2);
    expect(rendered?.lines.at(-1)).toBe("");
  });

  test("shortens key hints before adding rows", () => {
    const rendered = renderQuickReplyPanel(fiveReplies, 60, theme);

    expect(stripTerminalSequences(rendered?.lines[0] ?? "").trimEnd()).toBe(
      "   A1  One   A2  Two   A3  Three   A4  Four   A5  Five",
    );
    expect(rendered?.lines).toHaveLength(2);
  });

  test("wraps full keycaps on narrow terminals", () => {
    const rendered = renderQuickReplyPanel(fiveReplies, 50, theme);
    const plain = rendered?.lines.map((line) => stripTerminalSequences(line).trimEnd());

    expect(plain?.slice(0, -1)).toEqual([
      "   Alt+1  One   Alt+2  Two   Alt+3  Three",
      "   Alt+4  Four   Alt+5  Five",
    ]);
    expect(rendered?.visibleReplyCount).toBe(5);
    expect(rendered?.lines.slice(1, -1).every((line) => visibleWidth(line) <= 50)).toBe(true);
  });

  test("explains command confirmation without changing the command label", () => {
    const rendered = renderQuickReplyPanel([{ label: "/hotkeys", message: "/hotkeys" }], 60, theme);

    expect(stripTerminalSequences(rendered?.lines[0] ?? "").trimEnd()).toBe(
      "  command · Enter to run   Alt+1  /hotkeys",
    );
  });

  test("colorizes shortcut modifiers, separators, and digits independently", () => {
    const colorTheme = {
      ...theme,
      fg: (color: string, text: string) => `[${color}:${text}]`,
    } as unknown as Theme;

    const rendered = renderQuickReplyPanel(fiveReplies.slice(0, 1), 200, colorTheme);
    const line = rendered?.lines[0] ?? "";

    expect(line).toContain("[muted:Alt][dim:+][accent:1]");
  });

  test("keeps the container transparent while raising individual keycaps", () => {
    const backgrounds: string[] = [];
    const trackingTheme = {
      ...theme,
      bg: (color: string, text: string) => {
        backgrounds.push(color);
        return text;
      },
    } as unknown as Theme;

    const rendered = renderQuickReplyPanel(fiveReplies, 120, trackingTheme);

    expect(rendered?.lines[0]).not.toContain(PANEL_BACKGROUND);
    expect(backgrounds).toEqual([
      "selectedBg",
      "selectedBg",
      "selectedBg",
      "selectedBg",
      "selectedBg",
    ]);
  });

  test("hides instead of truncating a reply label", () => {
    expect(renderQuickReplyPanel(fiveReplies, 6, theme)).toBeUndefined();
  });
});
