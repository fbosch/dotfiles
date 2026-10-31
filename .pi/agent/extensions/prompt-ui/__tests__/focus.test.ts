import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { KeybindingsManager } from "@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import {
  getEditorTheme,
  loadThemeFromPath,
  setThemeInstance,
  theme,
} from "@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import type { TUI } from "@earendil-works/pi-tui";
import { paintDockBorderSpace } from "../dock-rendering";
import promptUi from "../index";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
type TerminalInput = Parameters<ExtensionContext["ui"]["onTerminalInput"]>[0];
type EditorFactory = Exclude<Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0], undefined>;

async function createFixture() {
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  const listeners = new Set<TerminalInput>();
  let renderRequests = 0;
  let removedListeners = 0;
  let editor: CustomEditor | undefined;
  const tui = {
    mode: "regular",
    terminal: { rows: 40, columns: 120 },
    requestRender: () => { renderRequests += 1; },
  } as unknown as TUI;
  setThemeInstance(loadThemeFromPath(new URL("../../../themes/zenwritten-dark.json", import.meta.url).pathname));
  const ctx = {
    cwd: REPO_ROOT,
    hasUI: true,
    mode: "tui",
    isProjectTrusted: () => false,
    sessionManager: SessionManager.inMemory(REPO_ROOT),
    getContextUsage: () => undefined,
    model: { name: "Test", provider: "openai" },
    ui: {
      theme,
      custom: async () => undefined,
      select: async () => undefined,
      confirm: async () => false,
      input: async () => undefined,
      setWidget() {},
      setWorkingVisible() {},
      setFooter() {},
      onTerminalInput(listener: TerminalInput) {
        listeners.add(listener);
        return () => {
          if (listeners.delete(listener)) removedListeners += 1;
        };
      },
      setEditorComponent(factory: EditorFactory | undefined) {
        if (factory === undefined) return;
        const component = factory(tui, getEditorTheme(), new KeybindingsManager());
        if (!(component instanceof CustomEditor)) throw new Error("Expected native editor");
        editor = component;
        editor.onEscape = () => {};
      },
    },
  } as unknown as ExtensionContext;
  promptUi({
    on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => {
      handlers.set(event, handler);
    },
    events: { on: () => () => {} },
    getThinkingLevel: () => "low",
  } as unknown as ExtensionAPI);
  const fire = async (event: string) => { await handlers.get(event)?.({}, ctx); };
  await fire("session_start");
  return {
    fire,
    input: (data: string) => [...listeners].map((listener) => listener(data)),
    editor: () => {
      if (editor === undefined) throw new Error("Editor was not installed");
      return editor;
    },
    requests: () => renderRequests,
    listenerCount: () => listeners.size,
    removedListeners: () => removedListeners,
  };
}

test("pauses animation redraws on blur and resumes at the frozen position", async () => {
  const fixture = await createFixture();
  try {
    await fixture.fire("agent_start");
    await Bun.sleep(500);
    const beforeBlur = fixture.editor().render(100);
    expect(fixture.input("\u001b[O")).toEqual([undefined]);
    const pausedRequests = fixture.requests();
    await Bun.sleep(125);
    expect(fixture.requests()).toBe(pausedRequests);
    expect(fixture.editor().render(100)).toEqual(beforeBlur);
    expect(fixture.input("\u001b[I")).toEqual([undefined]);
    expect(fixture.requests()).toBe(pausedRequests + 1);
    expect(fixture.editor().render(100)).toEqual(beforeBlur);
    expect(fixture.input("\u001b[I")).toEqual([undefined]);
    expect(fixture.input("ordinary input")).toEqual([undefined]);
    expect(fixture.requests()).toBe(pausedRequests + 1);
    await Bun.sleep(100);
    expect(fixture.requests()).toBeGreaterThan(pausedRequests + 1);
    expect(fixture.editor().render(100)).not.toEqual(beforeBlur);
  } finally {
    await fixture.fire("session_shutdown");
  }
});

test("starts no animation timer when work begins in an unfocused terminal", async () => {
  const fixture = await createFixture();
  try {
    fixture.input("\u001b[O");
    const pausedRequests = fixture.requests();
    await fixture.fire("agent_start");
    await Bun.sleep(100);
    expect(fixture.requests()).toBe(pausedRequests);
    fixture.input("\u001b[I");
    expect(fixture.requests()).toBe(pausedRequests + 1);
    await Bun.sleep(75);
    expect(fixture.requests()).toBeGreaterThan(pausedRequests + 1);
  } finally {
    await fixture.fire("session_shutdown");
  }
});

test("expires a settled fade while unfocused without restarting its timer on focus", async () => {
  const fixture = await createFixture();
  try {
    await fixture.fire("agent_start");
    await Bun.sleep(450);
    fixture.input("\u001b[O");
    const pausedRequests = fixture.requests();
    await fixture.fire("agent_settled");
    await Bun.sleep(500);
    expect(fixture.requests()).toBe(pausedRequests);
    fixture.input("\u001b[I");
    expect(fixture.editor().render(100)[0]).toStartWith(
      paintDockBorderSpace(theme.getFgAnsi("borderMuted")),
    );
    const resumedRequests = fixture.requests();
    await Bun.sleep(100);
    expect(fixture.requests()).toBe(resumedRequests);
  } finally {
    await fixture.fire("session_shutdown");
  }
});

test("does not replay expired red interrupt feedback after regaining focus", async () => {
  const fixture = await createFixture();
  try {
    await fixture.fire("agent_start");
    fixture.editor().handleInput("\u001b");
    expect(fixture.editor().render(100)[0]).toStartWith(
      paintDockBorderSpace(theme.getFgAnsi("error")),
    );
    fixture.input("\u001b[O");
    const pausedRequests = fixture.requests();
    await fixture.fire("agent_settled");
    await Bun.sleep(1100);
    expect(fixture.requests()).toBe(pausedRequests);
    fixture.input("\u001b[I");
    expect(fixture.editor().render(100)[0]).toStartWith(
      paintDockBorderSpace(theme.getFgAnsi("borderMuted")),
    );
    const resumedRequests = fixture.requests();
    await Bun.sleep(100);
    expect(fixture.requests()).toBe(resumedRequests);
  } finally {
    await fixture.fire("session_shutdown");
  }
});

test("replaces focus listeners on session changes and removes them at shutdown", async () => {
  const fixture = await createFixture();
  try {
    expect(fixture.listenerCount()).toBe(1);
    fixture.input("\u001b[O");
    await fixture.fire("session_start");
    expect(fixture.listenerCount()).toBe(1);
    expect(fixture.removedListeners()).toBe(1);
    const pausedRequests = fixture.requests();
    await fixture.fire("agent_start");
    await Bun.sleep(75);
    expect(fixture.requests()).toBe(pausedRequests);
  } finally {
    await fixture.fire("session_shutdown");
  }
  expect(fixture.listenerCount()).toBe(0);
  expect(fixture.removedListeners()).toBe(2);
  const stoppedRequests = fixture.requests();
  expect(fixture.input("\u001b[I")).toEqual([]);
  await Bun.sleep(75);
  expect(fixture.requests()).toBe(stoppedRequests);
});
