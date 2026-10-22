import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  KeybindingsManager,
  MarkdownTransformer,
  SessionEntry,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { loadThemeFromPath } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import stretchtext from "../index";

const theme = loadThemeFromPath(
  new URL("../../../themes/zenwritten-dark.json", import.meta.url).pathname,
);
const FIRST = "{{First.|First extra.}}";
const SECOND = "{{Second.|Second extra.}}";
const THIRD = "{{Third.|Third extra.}} More.";

function assistant(...texts: string[]): AssistantMessage {
  return {
    role: "assistant",
    content: texts.map((text) => ({ type: "text", text })),
    api: "openai-responses",
    provider: "synthetic",
    model: "synthetic",
    stopReason: "stop",
    timestamp: 0,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

function harness(mode: "tui" | "json" = "tui") {
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  const shortcuts = new Map<string, Parameters<ExtensionAPI["registerShortcut"]>[1]>();
  let transformer: MarkdownTransformer | undefined;
  let branch: SessionEntry[] = [];
  let dialog: Component | undefined;
  const notifications: string[] = [];
  const tui = { invalidate() {}, requestRender() {} } as unknown as TUI;
  // Only the SDK operations exercised by this extension are implemented by the test host.
  const ctx = {
    mode,
    sessionManager: { getBranch: () => branch },
    ui: {
      notify: (text: string) => notifications.push(text),
      setWidget() {},
      custom(
        factory: (tui: TUI, theme: Theme, keys: KeybindingsManager, done: () => void) => Component,
      ) {
        dialog = factory(tui, theme, {} as KeybindingsManager, () => {});
        return Promise.resolve();
      },
    },
  } as unknown as ExtensionContext;
  const api = {
    on(name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) {
      handlers.set(name, handler);
      return () => handlers.delete(name);
    },
    registerShortcut(name: string, options: Parameters<ExtensionAPI["registerShortcut"]>[1]) {
      shortcuts.set(name, options);
    },
    registerMarkdownTransformer(value: MarkdownTransformer) {
      transformer = value;
    },
  } as unknown as ExtensionAPI;
  stretchtext(api);

  const emit = (type: string, event: object = {}) => handlers.get(type)?.({ type, ...event }, ctx);
  const addEntry = (message: AssistantMessage): SessionEntry => ({
    type: "message",
    id: "entry-" + branch.length,
    parentId: branch.at(-1)?.id ?? null,
    timestamp: "2026-01-01T00:00:00.000Z",
    message,
  });
  return {
    async end(message: AssistantMessage) {
      await emit("message_end", { message });
      branch.push(addEntry(message));
    },
    async emitMessage(message: object) {
      await emit("message_end", { message });
    },
    render(
      text: string,
      isStreaming = false,
      messageType: "assistant" | "user" | "assistant-thinking" = "assistant",
    ) {
      if (!transformer) throw Error("Markdown transformer was not registered");
      return stripVTControlCharacters(
        transformer(text, { messageType, isStreaming, availableWidth: 80 }),
      );
    },
    letters() {
      const shortcut = shortcuts.get("alt+o");
      if (!shortcut) throw Error("Open shortcut was not registered");
      shortcut.handler(ctx);
    },
    key(value: string) {
      dialog?.handleInput?.(value);
    },
    sections() {
      const sections: Record<string, string> = {};
      emit("before_agent_start", { systemPromptOptions: { sections } });
      return sections;
    },
    async restore(
      messages: AssistantMessage[],
      type: "session_start" | "session_tree" = "session_start",
    ) {
      branch = [];
      for (const message of messages) branch.push(addEntry(message));
      await emit(type, { reason: "reload" });
    },
    notifications,
  };
}

test("streaming snapshots do not displace the latest three completed replies", async () => {
  const h = harness();
  await h.end(assistant(FIRST));
  h.render(FIRST);
  await h.end(assistant(SECOND));
  h.render(SECOND);
  for (const snapshot of ["{{Third.|Third extra", "{{Third.|Third extra.}}", THIRD]) {
    h.render(snapshot, true);
  }
  await h.end(assistant(THIRD));
  h.letters();
  expect(h.render(FIRST)).toBe("aFirst.");
  expect(h.render(SECOND)).toBe("sSecond.");
  expect(h.render(THIRD)).toBe("dThird. More.");
});

test("completed messages are tracked before their first render", async () => {
  const h = harness();
  await h.end(assistant(FIRST));
  h.letters();
  expect(h.render(FIRST)).toBe("aFirst.");
  h.key("a");
  expect(h.render(FIRST)).toBe("First extra. [« Collapse]");
});

test("one message with multiple visible text blocks occupies one reply slot", async () => {
  const h = harness();
  const other = "{{Other.|Other extra.}}";
  await h.end(assistant("  " + FIRST + "\n", other));
  h.render(FIRST);
  h.render(other);
  await h.end(assistant(SECOND));
  h.render(SECOND);
  await h.end(assistant(THIRD));
  h.render(THIRD);
  h.letters();
  expect(h.render(FIRST)).toBe("aFirst.");
  expect(h.render(other)).toBe("sOther.");
  expect(h.render(SECOND)).toBe("dSecond.");
  expect(h.render(THIRD)).toBe("fThird. More.");
});

test("session startup restores existing replies before any redraw", async () => {
  const h = harness();
  await h.restore([assistant(FIRST), assistant(SECOND)]);
  h.letters();
  expect(h.render(FIRST)).toBe("aFirst.");
  expect(h.render(SECOND)).toBe("sSecond.");
});

test("tree navigation rebuilds the recent-reply window from the active branch", async () => {
  const h = harness();
  await h.end(assistant(FIRST));
  h.render(FIRST);
  await h.restore([assistant(SECOND)], "session_tree");
  h.letters();
  expect(h.render(SECOND)).toBe("aSecond.");
});

test("completed reply tracking also supplies read notes in JSON mode", async () => {
  const h = harness("json");
  await h.end(assistant(FIRST));
  expect(h.sections().stretchtext_read).toContain("no click");
});

test("non-assistant and literal-code messages leave the completed reply window intact", async () => {
  const h = harness();
  await h.end(assistant(FIRST));
  h.render(FIRST);
  for (let i = 0; i < 4; i++) {
    await h.end(assistant("`{{literal|code}}`"));
    await h.emitMessage({ role: "user", content: "{{User.|User text.}}", timestamp: 0 });
    await h.emitMessage({
      role: "toolResult",
      content: [{ type: "text", text: "{{Tool.|Tool text.}}" }],
    });
  }
  h.letters();
  expect(h.render(FIRST)).toBe("aFirst.");
});

test("read notes use the finalized text even when an expansion was never rendered", async () => {
  const h = harness();
  await h.end(assistant(FIRST, SECOND));
  h.letters();
  h.key("a");
  const note = h.sections().stretchtext_read;
  expect(note).toContain('reader opened "First."');
  expect(note).toContain('did not open "Second."');
});
