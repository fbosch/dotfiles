import { afterEach, expect, mock, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import type {
  ExtensionAPI,
  ExtensionContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import {
  getEditorTheme,
  loadThemeFromPath,
  theme,
} from "../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { AgentMentionCache, type AgentMentionCacheFileSystem } from "../../mentions/agent-mentions";
import { PromptEditor, type PromptEditorState, type PromptRenderInput } from "../prompt-editor";

const THEME_PATH = new URL("../../../themes/zenwritten-dark.json", import.meta.url).pathname;

afterEach(() => mock.restore());
class CountingPromptEditor extends PromptEditor {
  readonly operations = { highlight: 0, context: 0, layout: 0 };

  protected override highlightPromptContent(
    content: readonly string[],
    currentTheme: Theme,
  ): string[] {
    this.operations.highlight++;
    return super.highlightPromptContent(content, currentTheme);
  }

  protected override renderContextLine(
    currentTheme: Theme,
    usage: PromptRenderInput["usage"],
  ): string {
    this.operations.context++;
    return super.renderContextLine(currentTheme, usage);
  }

  protected override buildPromptLayout(input: PromptRenderInput) {
    this.operations.layout++;
    return super.buildPromptLayout(input);
  }
}

test("reuses prompt highlighting, layout, and context until render inputs change", () => {
  let currentTheme: Theme = theme;
  let usage: { tokens: number; percent: number; contextWindow: number } | undefined = {
    tokens: 80_000,
    percent: 40,
    contextWindow: 200_000,
  };
  let model = { name: "Test", provider: "openai" };
  let profileName: string | undefined;
  let isWorking = false;
  let filesystemCalls = 0;
  let contextReads = 0;
  const fileSystem: AgentMentionCacheFileSystem = {
    async readDirectory() {
      filesystemCalls++;
      return [];
    },
    async readText() {
      filesystemCalls++;
      return "";
    },
    async isDirectory() {
      filesystemCalls++;
      return false;
    },
    async pathIdentity() {
      filesystemCalls++;
      return undefined;
    },
    async pathIsFile() {
      return false;
    },
    watchDirectory() {
      filesystemCalls++;
      return () => {};
    },
  };
  const cache = new AgentMentionCache("/tmp/project", "/tmp/agents", false, fileSystem);
  const tui = {
    mode: "regular",
    terminal: { rows: 40, columns: 120 },
    requestRender() {},
  } as unknown as TUI;
  const state: PromptEditorState = {
    isWorking: () => isWorking,
    getWorkingMarker: () => "●",
    getBranch: () => null,
    getProfileName: () => profileName,
    getStatuses: () => [],
  };
  const editor = new CountingPromptEditor(
    tui,
    getEditorTheme(),
    {} as KeybindingsManager,
    { getThinkingLevel: () => "low" } as ExtensionAPI,
    {
      cwd: "/tmp/project",
      isProjectTrusted: () => false,
      getContextUsage: () => {
        contextReads++;
        return usage;
      },
      get model() {
        return model;
      },
      ui: {
        get theme() {
          return currentTheme;
        },
      },
    } as unknown as ExtensionContext,
    state,
    { rules: new Map(), lengths: new Set() },
    cache,
  );

  const alternateTheme = loadThemeFromPath(THEME_PATH);
  const syncReads = [
    spyOn(fs, "readFileSync"),
    spyOn(fs, "readdirSync"),
    spyOn(fs, "existsSync"),
    spyOn(fs, "statSync"),
  ];
  editor.render(100);
  editor.render(100);
  expect(editor.operations).toEqual({ highlight: 1, context: 1, layout: 1 });
  for (let frame = 0; frame < 20; frame++) editor.render(100);
  expect(contextReads).toBe(1);
  expect(editor.operations).toEqual({ highlight: 1, context: 1, layout: 1 });
  expect(filesystemCalls).toBe(0);

  editor.render(101);
  currentTheme = alternateTheme;
  editor.render(100);
  usage = { tokens: 20_000, percent: 10, contextWindow: 200_000 };
  editor.invalidateContextUsage();
  editor.render(100);
  model = { name: "Other", provider: "anthropic" };
  editor.render(100);
  profileName = "Work";
  editor.render(100);
  isWorking = true;
  editor.render(100);
  editor.setText("@Explore");
  editor.render(100);

  expect(editor.operations).toEqual({ highlight: 8, context: 8, layout: 8 });
  expect(contextReads).toBe(3);
  for (const read of syncReads) expect(read).not.toHaveBeenCalled();
  editor.dispose();
  cache.dispose();
});
