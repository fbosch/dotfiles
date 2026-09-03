import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type {
  ExtensionAPI,
  ExtensionContext,
  KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import {
  getEditorTheme,
  loadThemeFromPath,
  setThemeInstance,
  theme,
} from "../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { PromptEditor, type PromptEditorState } from "../prompt-editor";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const keybindings = {
  getKeys: (action: string) => (action === "app.interrupt" ? ["escape"] : []),
  matches: (data: string, action: string) => data === "\u001b" && action === "app.interrupt",
} as unknown as KeybindingsManager;

function createEditor(working: boolean, confirmationWindowMs = 1_500) {
  let interruptPending = false;
  let interruptCount = 0;
  let renderCount = 0;
  const tui = {
    terminal: { rows: 40, columns: 120 },
    requestRender() {
      renderCount += 1;
    },
  } as unknown as TUI;
  const state: PromptEditorState = {
    isWorking: () => working,
    isInterruptPending: () => interruptPending,
    setInterruptPending: (pending) => {
      if (interruptPending === pending) return;
      interruptPending = pending;
      renderCount += 1;
    },
    getWorkingMarker: () => "●",
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
      ui: { theme },
    } as unknown as ExtensionContext,
    state,
    { rules: new Map(), lengths: new Set() },
    confirmationWindowMs,
  );
  editor.onEscape = () => {
    interruptCount += 1;
  };

  return {
    editor,
    isInterruptPending: () => interruptPending,
    getInterruptCount: () => interruptCount,
    getRenderCount: () => renderCount,
  };
}

test("requires a second interrupt press while the agent is working", () => {
  const fixture = createEditor(true);

  fixture.editor.handleInput("\u001b");
  expect(fixture.getInterruptCount()).toBe(0);
  expect(fixture.isInterruptPending()).toBe(true);
  expect(fixture.getRenderCount()).toBeGreaterThan(0);

  fixture.editor.handleInput("\u001b");
  expect(fixture.getInterruptCount()).toBe(1);
  expect(fixture.isInterruptPending()).toBe(false);
  fixture.editor.dispose();
});

test("expires the interrupt confirmation window", async () => {
  const fixture = createEditor(true, 10);

  fixture.editor.handleInput("\u001b");
  await Bun.sleep(20);
  expect(fixture.isInterruptPending()).toBe(false);

  fixture.editor.handleInput("\u001b");
  expect(fixture.getInterruptCount()).toBe(0);
  expect(fixture.isInterruptPending()).toBe(true);
  fixture.editor.dispose();
});

test("disarms interrupt confirmation when other input arrives", () => {
  const fixture = createEditor(true);

  fixture.editor.handleInput("\u001b");
  fixture.editor.handleInput("a");

  expect(fixture.isInterruptPending()).toBe(false);
  expect(fixture.getInterruptCount()).toBe(0);
  fixture.editor.dispose();
});

test("keeps a single interrupt press when the agent is idle", () => {
  const fixture = createEditor(false);

  fixture.editor.handleInput("\u001b");
  expect(fixture.getInterruptCount()).toBe(1);
  expect(fixture.isInterruptPending()).toBe(false);
  fixture.editor.dispose();
});
