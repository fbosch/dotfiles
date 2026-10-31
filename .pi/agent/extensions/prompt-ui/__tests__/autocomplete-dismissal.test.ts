import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import {
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  foregroundAnsi,
  rgbColor,
  getKeybindings,
  type OverlayHandle,
  stripTerminalSequences,
  type TUI,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  getEditorTheme,
  loadThemeFromPath,
  setThemeInstance,
  theme,
} from "../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { AgentMentionCache } from "../../mentions/agent-mentions";
import { foregroundToBackground } from "../dock-rendering";
import { PromptEditor, type PromptEditorState } from "../prompt-editor";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

function createEditor() {
  let overlayHidden = false;
  let overlayComponent: Component | undefined;
  const overlayHandle: OverlayHandle = {
    hide: () => {
      overlayHidden = true;
    },
    setHidden: (hidden) => {
      overlayHidden = hidden;
    },
    isHidden: () => overlayHidden,
    focus: () => {},
    unfocus: () => {},
    isFocused: () => false,
    getBounds: () => undefined,
  };
  const tui = {
    mode: "regular",
    terminal: { rows: 40, columns: 120 },
    requestRender: () => {},
    showOverlay: (component: Component) => {
      overlayComponent = component;
      return overlayHandle;
    },
  } as unknown as TUI;
  const state: PromptEditorState = {
    isWorking: () => false,
    getWorkingPulse: () => 0,
    getWorkingPosition: () => 0,
    getInterruptPulse: () => 0,
    getCompletionPulse: () => 0,
    onInterrupt() {},
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
    getKeybindings() as unknown as KeybindingsManager,
    { getThinkingLevel: () => "xhigh" } as ExtensionAPI,
    {
      cwd: REPO_ROOT,
      isProjectTrusted: () => false,
      getContextUsage: () => undefined,
      sessionManager: SessionManager.inMemory(REPO_ROOT),
      ui: { theme },
    } as unknown as ExtensionContext,
    state,
    { rules: new Map(), lengths: new Set() },
    new AgentMentionCache(REPO_ROOT, REPO_ROOT, false),
  );
  editor.setAutocompleteProvider({
    getSuggestions: async () => ({
      items: [{ value: "reset-credit", label: "reset-credit" }],
      prefix: "/",
    }),
    applyCompletion: () => ({ lines: ["/reset-credit"], cursorLine: 0, cursorCol: 13 }),
  });

  return {
    editor,
    isOverlayHidden: () => overlayHidden,
    renderOverlay: () => overlayComponent?.render(100) ?? [],
  };
}

test("hides slash suggestions before the selected command is submitted", async () => {
  const fixture = createEditor();
  let overlayHiddenAtSubmit = false;
  fixture.editor.onSubmit = () => {
    overlayHiddenAtSubmit = fixture.isOverlayHidden();
  };

  fixture.editor.handleInput("/");
  await Bun.sleep(0);
  fixture.editor.render(100);
  expect(fixture.isOverlayHidden()).toBeFalse();

  fixture.editor.handleInput("\r");

  expect(overlayHiddenAtSubmit).toBeTrue();
  fixture.editor.dispose();
});

test("aligns copy-safe suggestion rails with the unchanged prompt border color", async () => {
  const fixture = createEditor();
  try {
    fixture.editor.handleInput("/");
    await Bun.sleep(0);
    const promptLines = fixture.editor.render(100);
    const overlayLines = fixture.renderOverlay();
    const rail = `${foregroundToBackground(foregroundAnsi(rgbColor(68, 68, 68), theme.getColorMode()))} \u001b[0m`;

    expect(overlayLines).toHaveLength(1);
    for (const line of [...promptLines.slice(0, -1), ...overlayLines]) {
      expect(line).toStartWith(rail);
      expect(line).toEndWith("\u001b[49m");
      expect(visibleWidth(line)).toBe(100);
    }
    expect(promptLines[0]).toBe(
      `${rail}${theme.getBgAnsi("userMessageBg")}${" ".repeat(99)}\u001b[49m`,
    );
    const bottomEdge = promptLines[promptLines.length - 1] ?? "";
    expect(stripTerminalSequences(bottomEdge)).toBe("▀".repeat(100));
    expect(bottomEdge).toStartWith(`${foregroundAnsi(rgbColor(68, 68, 68), theme.getColorMode())}▀`);
    expect(bottomEdge).toEndWith(`${"▀".repeat(99)}\u001b[39m`);
  } finally {
    fixture.editor.dispose();
  }
});

test("renders modified FFF files with a warning-colored side rail", async () => {
  const fixture = createEditor();
  fixture.editor.setAutocompleteProvider({
    getSuggestions: async () => ({
      items: [
        {
          value: "@.pi/agent/extensions/prompt-ui/autocomplete.ts",
          label: "autocomplete.ts",
          description: ".pi/agent/extensions/prompt-ui/autocomplete.ts",
          gitStatus: "modified",
        },
        {
          value: "@.pi/agent/extensions/prompt-ui/prompt-editor.ts",
          label: "prompt-editor.ts",
          description: ".pi/agent/extensions/prompt-ui/prompt-editor.ts",
          gitStatus: "untracked",
        },
      ],
      prefix: "@.pi/",
    }),
    applyCompletion: () => ({ lines: ["@.pi/"], cursorLine: 0, cursorCol: 5 }),
  });

  for (const character of "@.pi/") fixture.editor.handleInput(character);
  await Bun.sleep(30);
  const promptLines = fixture.editor.render(100);
  const overlayLines = fixture.renderOverlay();

  expect(overlayLines).toHaveLength(2);
  expect(stripTerminalSequences(overlayLines[0] ?? "")).toStartWith("  ");
  expect(overlayLines[0]).toStartWith(
    `${foregroundToBackground(theme.getFgAnsi("warning"))} \u001b[0m`,
  );
  expect(overlayLines[1]).toStartWith(
    `${foregroundToBackground(theme.getFgAnsi("success"))} \u001b[0m`,
  );
  for (const line of [...promptLines.slice(0, -1), ...overlayLines]) {
    expect(visibleWidth(line)).toBe(100);
    expect(line).toEndWith("\u001b[49m");
  }
  fixture.editor.dispose();
});
