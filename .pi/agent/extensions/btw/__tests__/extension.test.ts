import { describe, expect, test } from "bun:test";
import {
  type Api,
  type AssistantMessage,
  createAssistantMessageEventStream,
  type Message,
  type Model,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import btwExtension, { type BtwSettings, parseSettings, stripTerminalControls } from "../index";

type EventHandler = (event: never, ctx: ExtensionContext) => unknown | Promise<unknown>;
type CommandHandler = (args: string, ctx: ExtensionContext) => unknown | Promise<unknown>;
const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

const mainModel = {
  provider: "main-provider",
  id: "main-model",
  api: "openai-responses",
  name: "Main",
  reasoning: true,
  contextWindow: 32_000,
  maxTokens: 4_096,
  input: ["text"],
  output: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as unknown as Model<Api>;

const otherModel = { ...mainModel, provider: "other-provider", id: "other-model" } as Model<Api>;

function makeAssistant(): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai-responses",
    provider: "main-provider",
    model: "main-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "pending",
    timestamp: 1,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

interface HarnessOptions {
  settings?: BtwSettings;
  mode?: "tui" | "rpc" | "json" | "print";
  confirm?: () => Promise<boolean>;
  initialMessages?: Message[];
}

function createHarness(options: HarnessOptions = {}) {
  const handlers = new Map<string, EventHandler>();
  const commands = new Map<string, CommandHandler>();
  const notices: string[] = [];
  const stream = createAssistantMessageEventStream();
  const streamCalls: {
    model: Model<Api>;
    messages: Message[];
    signal: AbortSignal | undefined;
    hasTools: boolean;
  }[] = [];
  const statuses = new Map<string, string | undefined>();
  let widget: (Component & { dispose?(): void }) | undefined;
  let unsubscribeCount = 0;
  const tui = { requestRender: () => undefined } as unknown as TUI;
  const ctx = {
    mode: options.mode ?? "tui",
    hasUI: true,
    cwd: "/project",
    model: mainModel,
    modelRegistry: {
      find: (provider: string, id: string) =>
        provider === otherModel.provider && id === otherModel.id ? otherModel : undefined,
      getAvailable: () => [mainModel, otherModel],
      streamSimple: (
        model: Model<Api>,
        context: { messages: Message[]; tools?: readonly unknown[] },
        streamOptions?: { signal?: AbortSignal },
      ) => {
        streamCalls.push({
          model,
          messages: context.messages,
          signal: streamOptions?.signal,
          hasTools: context.tools !== undefined,
        });
        return stream;
      },
    },
    sessionManager: {
      getHeader: () => ({ id: "session-1" }),
      getEntries: () => {
        throw new Error("raw session history must not be read");
      },
    },
    isIdle: () => true,
    isProjectTrusted: () => true,
    signal: undefined,
    abort: () => undefined,
    hasPendingMessages: () => false,
    shutdown: () => undefined,
    getContextUsage: () => undefined,
    compact: () => undefined,
    getSystemPrompt: () => "must not be read as fallback",
    ui: {
      notify: (message: string) => notices.push(message),
      confirm: options.confirm ?? (() => Promise.resolve(true)),
      select: async () => undefined,
      input: async () => undefined,
      onTerminalInput: () => {
        return () => {
          unsubscribeCount += 1;
        };
      },
      setStatus: (key: string, value: string | undefined) => statuses.set(key, value),
      setWidget: (
        _key: string,
        content:
          | string[]
          | ((tui: TUI, theme: Theme) => Component & { dispose?(): void })
          | undefined,
      ) => {
        widget = typeof content === "function" ? content(tui, theme) : undefined;
      },
      getEditorText: () => "",
      setEditorText: () => undefined,
      setWorkingMessage: () => undefined,
      setWorkingVisible: () => undefined,
      setWorkingIndicator: () => undefined,
      setHiddenThinkingLabel: () => undefined,
      pasteToEditor: () => undefined,
      editor: async () => undefined,
      addAutocompleteProvider: () => undefined,
      custom: async () => undefined,
    },
  } as unknown as ExtensionContext;
  const pi = {
    on: (event: string, handler: EventHandler) => handlers.set(event, handler),
    registerCommand: (name: string, definition: { handler: CommandHandler }) =>
      commands.set(name, definition.handler),
  } as unknown as ExtensionAPI;

  btwExtension(pi, options.settings === undefined ? {} : { settings: options.settings });

  async function emit(event: string, payload: object = { type: event }): Promise<void> {
    await handlers.get(event)?.(payload as never, ctx);
  }

  async function capture(
    messages: Message[] = options.initialMessages ?? [
      {
        role: "system",
        content: "outbound system prompt",
        timestamp: 1,
        toolsAdded: [
          {
            name: "shell",
            description: "run commands",
            parameters: { type: "object", properties: {} },
          },
        ],
      },
      { role: "user", content: "observed user request", timestamp: 2 },
    ],
  ): Promise<void> {
    await emit("context_with_system", { type: "context_with_system", messages });
  }

  async function command(name: string, args = "question") {
    await commands.get(name)?.(args, ctx);
  }

  return {
    ctx,
    notices,
    stream,
    streamCalls,
    statuses,
    get widget() {
      return widget;
    },
    get unsubscribeCount() {
      return unsubscribeCount;
    },
    capture,
    command,
    emit,
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe("/btw input and settings boundaries", () => {
  test("rejects malformed persisted settings instead of coercing values", () => {
    expect(() =>
      parseSettings({
        modelStrategy: "custom",
        reasoning: "off",
        maxTokens: 500,
        cacheRetention: "short",
      }),
    ).toThrow();
    expect(() =>
      parseSettings({
        modelStrategy: "same-as-main",
        reasoning: "off",
        maxTokens: 501,
        cacheRetention: "short",
      }),
    ).toThrow();
    expect(
      parseSettings({
        modelStrategy: "same-as-main",
        reasoning: "off",
        maxTokens: 500,
        cacheRetention: "short",
      }),
    ).toEqual({
      modelStrategy: "same-as-main",
      reasoning: "off",
      maxTokens: 500,
      cacheRetention: "short",
    });
  });

  test("removes CSI, OSC 52, C1 controls, and split escape sequences", () => {
    expect(stripTerminalControls("safe\u001b[31mred\u001b[0m\u001b]52;c;secret\u0007done")).toBe(
      "safereddone",
    );
    expect(stripTerminalControls("first\u001b]52;c;private\u001b\\last")).toBe("firstlast");
    expect(stripTerminalControls("a\u009b31mb\u009dcopy\u0007c")).toBe("abc");
  });
});

describe("/btw command lifecycle and provider routing", () => {
  test("replays only the deep-copied observed outbound snapshot, not raw session history", async () => {
    const harness = createHarness();
    const source: Message[] = [
      {
        role: "system",
        content: "filtered system",
        timestamp: 1,
        toolsAdded: [
          { name: "exec", description: "tool", parameters: { type: "object", properties: {} } },
        ],
      },
      { role: "user", content: "outbound-only text", timestamp: 2 },
    ];
    await harness.capture(source);
    source[1] = { role: "user", content: "mutated after capture", timestamp: 3 };
    await harness.command("btw", "what happened?");
    expect(harness.streamCalls).toHaveLength(1);
    const sent = harness.streamCalls[0]?.messages ?? [];
    expect(JSON.stringify(sent)).toContain("outbound-only text");
    expect(JSON.stringify(sent)).not.toContain("mutated after capture");
    expect(JSON.stringify(sent)).not.toContain('"toolsAdded"');
    expect(JSON.stringify(sent)).not.toContain("getEntries");
    expect(harness.streamCalls[0]?.hasTools).toBe(false);
    expect(
      sent.some(
        (message) =>
          message.role === "user" &&
          typeof message.content === "string" &&
          message.content.includes("Question: what happened?"),
      ),
    ).toBe(true);
    expect(sent.at(-1)?.role).toBe("user");
    harness.stream.end();
    await settle();
    harness.widget?.dispose?.();
  });

  test("does not transmit when cross-provider consent is denied", async () => {
    const denied = deferred<boolean>();
    const harness = createHarness({
      settings: {
        modelStrategy: "custom",
        customProvider: otherModel.provider,
        customModelId: otherModel.id,
        reasoning: "off",
        maxTokens: 500,
        cacheRetention: "short",
      },
      confirm: () => denied.promise,
    });
    await harness.capture();
    const pending = harness.command("btw", "explain the output");
    await settle();
    expect(harness.streamCalls).toHaveLength(0);
    denied.resolve(false);
    await pending;
    expect(harness.streamCalls).toHaveLength(0);
    expect(harness.widget?.render(100).join(" ")).toContain("No request was sent");
    harness.widget?.dispose?.();
  });

  test("requires affirmative consent before a cross-provider stream", async () => {
    let confirmationMessage = "";
    const harness = createHarness({
      settings: {
        modelStrategy: "custom",
        customProvider: otherModel.provider,
        customModelId: otherModel.id,
        reasoning: "off",
        maxTokens: 500,
        cacheRetention: "short",
      },
      confirm: (_title?: string, message?: string) => {
        confirmationMessage = message ?? "";
        return Promise.resolve(true);
      },
    });
    await harness.capture();
    await harness.command("btw", "explain");
    expect(confirmationMessage).toContain("system prompt");
    expect(confirmationMessage).toContain("tool outputs");
    expect(harness.streamCalls[0]?.model.provider).toBe(otherModel.provider);
    harness.stream.end();
    await settle();
    harness.widget?.dispose?.();
  });

  test("rejects oversized questions and observed context before streaming", async () => {
    const longQuestion = createHarness();
    await longQuestion.capture();
    await longQuestion.command("btw", "q".repeat(2_100));
    expect(longQuestion.streamCalls).toHaveLength(0);
    expect(longQuestion.notices.join(" ")).toContain("2 KB limit");

    const longContext = createHarness();
    await longContext.capture([{ role: "user", content: "x".repeat(2_000_001), timestamp: 1 }]);
    await longContext.command("btw");
    expect(longContext.streamCalls).toHaveLength(0);
    expect(longContext.notices.join(" ")).toContain("snapshot exceeds");
  });

  test("fails closed for a missing custom model", async () => {
    const harness = createHarness({
      settings: {
        modelStrategy: "custom",
        customProvider: "missing",
        customModelId: "gone",
        reasoning: "off",
        maxTokens: 500,
        cacheRetention: "short",
      },
    });
    await harness.capture();
    await harness.command("btw");
    expect(harness.streamCalls).toHaveLength(0);
    expect(harness.notices.join(" ")).toContain("unavailable");
  });

  test("fits long multiline questions and answers into narrow terminal widths", async () => {
    const harness = createHarness();
    await harness.capture();
    await harness.command("btw", `${"æøå".repeat(100)}\nsecond line`);
    const partial = makeAssistant();
    harness.stream.push({
      type: "text_delta",
      contentIndex: 0,
      delta: "wide answer ".repeat(30),
      partial,
    });
    harness.stream.end();
    await settle();
    for (const width of [1, 5, 20, 80]) {
      for (const line of harness.widget?.render(width) ?? []) {
        expect(line).not.toContain("\n");
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
    harness.widget?.dispose?.();
  });

  test("invalidates snapshots when a new main turn starts", async () => {
    const harness = createHarness();
    await harness.capture();
    await harness.emit("agent_start");
    await harness.command("btw");
    expect(harness.streamCalls).toHaveLength(0);
  });

  test("invalidates captured context and aborts after session tree navigation", async () => {
    const harness = createHarness();
    await harness.capture();
    await harness.command("btw");
    const signal = harness.streamCalls[0]?.signal;
    await harness.emit("session_before_tree");
    expect(signal?.aborted).toBe(true);
    await harness.command("btw");
    expect(harness.streamCalls).toHaveLength(1);
  });

  test("disposes the widget idempotently, aborts, and removes the input listener", async () => {
    const harness = createHarness();
    await harness.capture();
    await harness.command("btw");
    const signal = harness.streamCalls[0]?.signal;
    harness.widget?.dispose?.();
    harness.widget?.dispose?.();
    expect(signal?.aborted).toBe(true);
    expect(harness.unsubscribeCount).toBe(1);
    expect(harness.statuses.get("btw")).toBeUndefined();
  });

  test("cancellation while consent is pending prevents later transmission", async () => {
    const pendingConsent = deferred<boolean>();
    const harness = createHarness({
      settings: {
        modelStrategy: "custom",
        customProvider: otherModel.provider,
        customModelId: otherModel.id,
        reasoning: "off",
        maxTokens: 500,
        cacheRetention: "short",
      },
      confirm: () => pendingConsent.promise,
    });
    await harness.capture();
    const pending = harness.command("btw");
    await settle();
    await harness.emit("session_shutdown");
    pendingConsent.resolve(true);
    await pending;
    expect(harness.streamCalls).toHaveLength(0);
  });

  test("handles structured tool calls by aborting without executing tools", async () => {
    const harness = createHarness();
    await harness.capture();
    await harness.command("btw");
    const partial = makeAssistant();
    harness.stream.push({ type: "toolcall_start", contentIndex: 0, partial });
    await settle();
    expect(harness.streamCalls).toHaveLength(1);
    expect(harness.streamCalls[0]?.signal?.aborted).toBe(true);
    expect(harness.widget?.render(100).join(" ")).toContain("cannot use tools");
    harness.widget?.dispose?.();
  });

  test("renders terminal-control-bearing streamed output only after cumulative sanitization", async () => {
    const harness = createHarness();
    await harness.capture();
    await harness.command("btw");
    const partial = makeAssistant();
    harness.stream.push({
      type: "text_delta",
      contentIndex: 0,
      delta: "safe\u001b]52;c;secret",
      partial,
    });
    harness.stream.push({ type: "text_delta", contentIndex: 0, delta: "\u0007answer", partial });
    harness.stream.end();
    await settle();
    const rendered = harness.widget?.render(100).join(" ") ?? "";
    expect(rendered).toContain("safeanswer");
    expect(rendered).not.toContain("secret");
    harness.widget?.dispose?.();
  });

  test("aborts and displays a fixed message when streamed output exceeds its cap", async () => {
    const harness = createHarness();
    await harness.capture();
    await harness.command("btw");
    await settle();
    const partial = makeAssistant();
    harness.stream.push({
      type: "text_delta",
      contentIndex: 0,
      delta: "a".repeat(33_000),
      partial,
    });
    await settle();
    expect(harness.streamCalls[0]?.signal?.aborted).toBe(true);
    expect(harness.widget?.render(100).join(" ")).toContain("exceeded its output limit");
    harness.widget?.dispose?.();
  });

  test("refuses non-TUI invocation before requesting a stream", async () => {
    const harness = createHarness({ mode: "rpc" });
    await harness.capture();
    await harness.command("btw");
    expect(harness.streamCalls).toHaveLength(0);
  });

  test("provider failures display fixed secret-free summaries", async () => {
    const harness = createHarness();
    await harness.capture();
    await harness.command("btw");
    await settle();
    const partial = makeAssistant();
    harness.stream.push({
      type: "error",
      reason: "error",
      error: { ...partial, errorMessage: "secret=api-key and private request body" },
    });
    harness.stream.end();
    await settle();
    const rendered = harness.widget?.render(100).join(" ") ?? "";
    expect(rendered).toContain("provider request failed");
    expect(rendered).not.toContain("api-key");
    expect(rendered).not.toContain("private request body");
    harness.widget?.dispose?.();
  });
});
