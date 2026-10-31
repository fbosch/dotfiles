import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import {
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { foregroundAnsi, mixColors, rgbColor, stripTerminalSequences, type TUI } from "@earendil-works/pi-tui";
import {
  getEditorTheme,
  loadThemeFromPath,
  setThemeInstance,
  theme,
} from "../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { AgentMentionCache } from "../../mentions/agent-mentions";
import { paintDockBorderSpace } from "../dock-rendering";
import { PromptEditor, type PromptEditorState } from "../prompt-editor";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const keybindings = {
  getKeys: (action: string) => (action === "app.interrupt" ? ["escape"] : []),
  matches: (data: string, action: string) => data === "\u001b" && action === "app.interrupt",
} as unknown as KeybindingsManager;

function createEditor(working: boolean) {
  let interruptCount = 0;
  let interruptPulse = 0;
  let completionPulse = 0;
  let feedbackCount = 0;
  const tui = {
    terminal: { rows: 40, columns: 120 },
    requestRender() {},
  } as unknown as TUI;
  const state: PromptEditorState = {
    isWorking: () => working,
    getWorkingPulse: () => 0,
    getWorkingPosition: () => 0,
    getInterruptPulse: () => interruptPulse,
    getCompletionPulse: () => completionPulse,
    onInterrupt() {
      feedbackCount += 1;
      interruptPulse = 1;
    },
    getBranch: () => null,
    getProfileName: () => undefined,
    getStatuses: () => [],
  };
  setThemeInstance(
    loadThemeFromPath(new URL("../../../themes/zenwritten-dark.json", import.meta.url).pathname),
  );
  const editor = new PromptEditor(
    tui,
    getEditorTheme(),
    keybindings,
    { getThinkingLevel: () => "xhigh" } as ExtensionAPI,
    {
      cwd: REPO_ROOT,
      isProjectTrusted: () => true,
      getContextUsage: () => undefined,
      sessionManager: SessionManager.inMemory(REPO_ROOT),
      ui: { theme },
    } as unknown as ExtensionContext,
    state,
    { rules: new Map(), lengths: new Set() },
    new AgentMentionCache(REPO_ROOT, REPO_ROOT, false),
  );
  editor.onEscape = () => {
    interruptCount += 1;
  };

  return {
    editor,
    getInterruptCount: () => interruptCount,
    getFeedbackCount: () => feedbackCount,
    setCompletionStrength: (value: number) => { completionPulse = value; },
    setFeedbackStrength: (value: number) => { interruptPulse = value; },
  };
}

test("interrupts on the first press while the agent is working", () => {
  const fixture = createEditor(true);

  fixture.editor.handleInput("\u001b");
  expect(fixture.getInterruptCount()).toBe(1);
  expect(fixture.getFeedbackCount()).toBe(1);
  fixture.editor.dispose();
});

test("keeps a single interrupt press when the agent is idle", () => {
  const fixture = createEditor(false);

  fixture.editor.handleInput("\u001b");
  expect(fixture.getInterruptCount()).toBe(1);
  expect(fixture.getFeedbackCount()).toBe(0);
  fixture.editor.dispose();
});

test("colors the entire gutter red without changing prompt content", () => {
  const fixture = createEditor(true);
  try {
    const before = fixture.editor.render(100);
    fixture.editor.handleInput("\u001b");
    const red = fixture.editor.render(100);
    const rail = paintDockBorderSpace(theme.getFgAnsi("error"));
    for (const line of red.slice(0, -1)) expect(line).toStartWith(rail);
    expect(red.at(-1)).toStartWith(theme.fg("error", "▀"));
    expect(red.map(stripTerminalSequences)).toEqual(before.map(stripTerminalSequences));
  } finally {
    fixture.editor.dispose();
  }
});

test("does not flash when an extension shortcut consumes Escape", () => {
  const fixture = createEditor(true);
  try {
    fixture.editor.onExtensionShortcut = () => true;
    fixture.editor.handleInput("\u001b");
    expect(fixture.getInterruptCount()).toBe(0);
    expect(fixture.getFeedbackCount()).toBe(0);
  } finally {
    fixture.editor.dispose();
  }
});

test("lets Escape dismiss autocomplete without interrupt feedback", async () => {
  const fixture = createEditor(true);
  try {
    fixture.editor.setAutocompleteProvider({
      getSuggestions: async () => ({
        items: [{ value: "test", label: "test" }],
        prefix: "/",
      }),
      applyCompletion: () => ({ lines: ["/test"], cursorLine: 0, cursorCol: 5 }),
    });
    fixture.editor.handleInput("/");
    await Bun.sleep(0);
    expect(fixture.editor.isShowingAutocomplete()).toBe(true);
    fixture.editor.handleInput("\u001b");
    expect(fixture.getInterruptCount()).toBe(0);
    expect(fixture.getFeedbackCount()).toBe(0);
    expect(fixture.editor.isShowingAutocomplete()).toBe(false);
  } finally {
    fixture.editor.dispose();
  }
});

test("restores the interrupt handler even if it throws", () => {
  const fixture = createEditor(true);
  const original = () => { throw new Error("interrupt test"); };
  fixture.editor.onEscape = original;
  try {
    expect(() => fixture.editor.handleInput("\u001b")).toThrow("interrupt test");
    expect(fixture.editor.onEscape).toBe(original);
    expect(fixture.getFeedbackCount()).toBe(1);
  } finally {
    fixture.editor.dispose();
  }
});

test("blends interrupt feedback evenly back toward the normal gutter color", () => {
  const fixture = createEditor(true);
  try {
    fixture.editor.handleInput("\u001b");
    const full = fixture.editor.render(100);
    fixture.setFeedbackStrength(0.5);
    const faded = fixture.editor.render(100);
    const color = foregroundAnsi(
      mixColors(rgbColor(68, 68, 68), theme.colors.error, 0.5, "srgb"),
      theme.getColorMode(),
    );
    for (const line of faded.slice(0, -1)) {
      expect(line).toStartWith(paintDockBorderSpace(color));
    }
    expect(faded.at(-1)).toStartWith(`${color}▀`);
    expect(faded).not.toEqual(full);
    expect(fixture.editor.render(100)).toBe(faded);
  } finally {
    fixture.editor.dispose();
  }
});

test("prioritizes red interruption feedback over completion feedback", () => {
  const fixture = createEditor(true);
  try {
    fixture.setCompletionStrength(1);
    fixture.editor.handleInput("\u001b");
    const red = fixture.editor.render(100);
    const rail = paintDockBorderSpace(theme.getFgAnsi("error"));
    for (const line of red.slice(0, -1)) expect(line).toStartWith(rail);
    expect(red.at(-1)).toStartWith(theme.fg("error", "▀"));
  } finally {
    fixture.editor.dispose();
  }
});
