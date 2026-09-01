import { describe, expect, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import { getKeybindings, type TUI } from "@earendil-works/pi-tui";
import {
  getEditorTheme,
  loadThemeFromPath,
  setThemeInstance,
  theme,
} from "../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { PromptEditor, type PromptEditorState } from "../prompt-editor";

const tui = {
  terminal: { rows: 40, columns: 120 },
  requestRender() {},
} as unknown as TUI;
const state: PromptEditorState = {
  isWorking: () => false,
  getWorkingMarker: () => "●",
  getBranch: () => null,
  getProfileName: () => undefined,
  getStatuses: () => [],
};

describe("prompt reference colors", () => {
  test("renders existing file references with warning orange", () => {
    setThemeInstance(
      loadThemeFromPath(new URL("../../../themes/zenwritten-dark.json", import.meta.url).pathname),
    );
    const editor = new PromptEditor(
      tui,
      getEditorTheme(),
      getKeybindings() as unknown as KeybindingsManager,
      { getThinkingLevel: () => "xhigh" } as ExtensionAPI,
      {
        cwd: "/home/fbb/dotfiles",
        isProjectTrusted: () => true,
        getContextUsage: () => undefined,
        ui: { theme },
      } as unknown as ExtensionContext,
      state,
      { rules: new Map(), lengths: new Set() },
    );
    editor.setText("check this @.pi/agent/extensions/mentions/project-references.ts");

    expect(editor.render(100).join("\n")).toContain(
      `${theme.getFgAnsi("warning")}@.pi/agent/extensions/mentions/project-references.ts`,
    );
    editor.dispose();
  });
});
