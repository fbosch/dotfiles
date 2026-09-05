import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type {
  ExtensionAPI,
  ExtensionContext,
  KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import { getKeybindings, type OverlayHandle, type TUI } from "@earendil-works/pi-tui";
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
  };
  const tui = {
    mode: "regular",
    terminal: { rows: 40, columns: 120 },
    requestRender: () => {},
    showOverlay: () => overlayHandle,
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

  return { editor, isOverlayHidden: () => overlayHidden };
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
