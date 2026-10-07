import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
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
import { AgentMentionCache } from "../../mentions/agent-mentions";
import { PromptEditor, type PromptEditorState } from "../prompt-editor";

const tui = {
  terminal: { rows: 40, columns: 120 },
  requestRender() {},
} as unknown as TUI;
const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const state: PromptEditorState = {
  isWorking: () => false,
  getWorkingMarker: () => "●",
  getBranch: () => null,
  getProfileName: () => undefined,
  getStatuses: () => [],
};

describe("prompt reference colors", () => {
  test("renders existing file references with markdown-link color", async () => {
    setThemeInstance(
      loadThemeFromPath(new URL("../../../themes/zenwritten-dark.json", import.meta.url).pathname),
    );
    const cache = new AgentMentionCache(REPO_ROOT, REPO_ROOT, false);
    const editor = new PromptEditor(
      tui,
      getEditorTheme(),
      getKeybindings() as unknown as KeybindingsManager,
      { getThinkingLevel: () => "xhigh" } as ExtensionAPI,
      {
        cwd: REPO_ROOT,
        isProjectTrusted: () => true,
        getContextUsage: () => undefined,
        ui: { theme },
      } as unknown as ExtensionContext,
      state,
      { rules: new Map(), lengths: new Set() },
      cache,
    );
    editor.setText("check this @.pi/agent/extensions/mentions/project-references/index.ts");

    editor.render(100);
    await cache.refresh();
    expect(editor.render(100).join("\n")).toContain(
      `${theme.getFgAnsi("mdLink")}@.pi/agent/extensions/mentions/project-references/index.ts`,
    );
    editor.dispose();
    cache.dispose();
  });
});
