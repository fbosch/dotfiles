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

function createEditor(working: boolean) {
  let interruptCount = 0;
  const tui = {
    terminal: { rows: 40, columns: 120 },
    requestRender() {},
  } as unknown as TUI;
  const state: PromptEditorState = {
    isWorking: () => working,
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
  );
  editor.onEscape = () => {
    interruptCount += 1;
  };

  return {
    editor,
    getInterruptCount: () => interruptCount,
  };
}

test("interrupts on the first press while the agent is working", () => {
  const fixture = createEditor(true);

  fixture.editor.handleInput("\u001b");
  expect(fixture.getInterruptCount()).toBe(1);
  fixture.editor.dispose();
});

test("keeps a single interrupt press when the agent is idle", () => {
  const fixture = createEditor(false);

  fixture.editor.handleInput("\u001b");
  expect(fixture.getInterruptCount()).toBe(1);
  fixture.editor.dispose();
});
