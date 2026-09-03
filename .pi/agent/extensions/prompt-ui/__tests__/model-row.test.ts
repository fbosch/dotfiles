import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type {
  ExtensionAPI,
  ExtensionContext,
  KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import { getKeybindings, stripTerminalSequences, type TUI } from "@earendil-works/pi-tui";
import {
  getEditorTheme,
  loadThemeFromPath,
  setThemeInstance,
  theme,
} from "../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { YOLO_STATUS_TEXT } from "../../yolo";
import { PromptEditor, type PromptEditorState } from "../prompt-editor";

const tui = {
  terminal: { rows: 40, columns: 120 },
  requestRender() {},
} as unknown as TUI;
const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

test("renders YOLO beside the execution mode in the model row", () => {
  setThemeInstance(
    loadThemeFromPath(new URL("../../../themes/zenwritten-dark.json", import.meta.url).pathname),
  );
  const state: PromptEditorState = {
    isWorking: () => false,
    isInterruptPending: () => false,
    setInterruptPending() {},
    getWorkingMarker: () => "●",
    getBranch: () => null,
    getProfileName: () => undefined,
    getStatuses: () => [theme.fg("error", YOLO_STATUS_TEXT)],
  };
  const editor = new PromptEditor(
    tui,
    getEditorTheme(),
    getKeybindings() as unknown as KeybindingsManager,
    { getThinkingLevel: () => "xhigh" } as ExtensionAPI,
    {
      cwd: REPO_ROOT,
      isProjectTrusted: () => true,
      getContextUsage: () => undefined,
      model: { name: "Test", provider: "openai" },
      ui: { theme },
    } as unknown as ExtensionContext,
    state,
    { rules: new Map(), lengths: new Set() },
  );

  const rendered = editor.render(100).join("\n");
  expect(stripTerminalSequences(rendered)).toContain(
    `Build · ${YOLO_STATUS_TEXT} · Test OpenAI · xhigh`,
  );
  expect(rendered).toContain(`${theme.getFgAnsi("error")}${YOLO_STATUS_TEXT}`);
  editor.dispose();
});
