import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type {
  ExtensionAPI,
  ExtensionContext,
  KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  getKeybindings,
  type OverlayHandle,
  stripTerminalSequences,
  type TUI,
} from "@earendil-works/pi-tui";
import {
  getEditorTheme,
  loadThemeFromPath,
  setThemeInstance,
  theme,
} from "../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
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
    isInterruptPending: () => false,
    setInterruptPending: () => {},
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
    getKeybindings() as unknown as KeybindingsManager,
    { getThinkingLevel: () => "xhigh" } as ExtensionAPI,
    {
      cwd: REPO_ROOT,
      isProjectTrusted: () => false,
      getContextUsage: () => undefined,
      ui: { theme },
    } as unknown as ExtensionContext,
    state,
    { rules: new Map(), lengths: new Set() },
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
  fixture.editor.render(100);

  const overlayLines = fixture.renderOverlay();
  expect(overlayLines).toHaveLength(2);
  expect(stripTerminalSequences(overlayLines[0] ?? "")).toStartWith("▌ ");
  expect(overlayLines[0]).toContain(theme.getFgAnsi("warning"));
  expect(overlayLines[1]).toContain(theme.getFgAnsi("success"));
  fixture.editor.dispose();
});
