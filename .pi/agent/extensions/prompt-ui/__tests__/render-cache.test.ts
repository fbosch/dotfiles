import { afterEach, expect, mock, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import type {
  ExtensionAPI,
  ExtensionContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  getEditorTheme,
  loadThemeFromPath,
  setThemeInstance,
  theme,
} from "@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import {
  foregroundAnsi,
  mixColors,
  rgbColor,
  stripTerminalSequences,
  type TUI,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { sessionWith } from "../../context-masking/__tests__/fixtures";
import { MARKER } from "../../context-masking/policy";
import { AgentMentionCache, type AgentMentionCacheFileSystem } from "../../mentions/agent-mentions";
import { PromptEditor, type PromptEditorState, type PromptRenderInput } from "../prompt-editor";
import { paintDockBorderSpace } from "../dock-rendering";
import { WORKING_SWEEP_FRAMES } from "../working-gutter";

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
    context: PromptRenderInput["context"],
  ): string {
    this.operations.context++;
    return super.renderContextLine(currentTheme, context);
  }

  protected override buildPromptLayout(input: PromptRenderInput) {
    this.operations.layout++;
    return super.buildPromptLayout(input);
  }
}

test("reuses prompt highlighting, layout, and context until render inputs change", () => {
  setThemeInstance(loadThemeFromPath(THEME_PATH));
  let currentTheme: Theme = theme;
  let usage: { tokens: number; percent: number; contextWindow: number } | undefined = {
    tokens: 80_000,
    percent: 40,
    contextWindow: 200_000,
  };
  let model = { name: "Test", provider: "openai" };
  let profileName: string | undefined;
  let isWorking = false;
  let workingPulse = 0;
  let completionPulse = 0;
  let workingPosition = 0.2;
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
    getWorkingPulse: () => workingPulse,
    getWorkingPosition: () => workingPosition,
    getInterruptPulse: () => 0,
    getCompletionPulse: () => completionPulse,
    onInterrupt() {},
    getBranch: () => null,
    getProfileName: () => profileName,
    getStatuses: () => [],
  };
  const { manager: sessionManager, resultIds } = sessionWith([{ resultChars: 2_000 }]);
  const editor = new CountingPromptEditor(
    tui,
    getEditorTheme(),
    {} as KeybindingsManager,
    { getThinkingLevel: () => "low" } as ExtensionAPI,
    {
      cwd: "/tmp/project",
      sessionManager,
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
  const idle = editor.render(100);
  isWorking = true;
  workingPulse = 1;
  workingPosition = 0;
  const pause = editor.render(100);
  const activeTint = foregroundAnsi(
    mixColors(rgbColor(68, 68, 68), currentTheme.colors.accent, 0.2, "srgb"),
    currentTheme.getColorMode(),
  );
  expect(pause.at(-1)).toStartWith(`${activeTint}▀`);
  workingPulse = 0.5;
  const fadingTint = foregroundAnsi(
    mixColors(rgbColor(68, 68, 68), currentTheme.colors.accent, 0.1, "srgb"),
    currentTheme.getColorMode(),
  );
  expect(editor.render(100).at(-1)).toStartWith(`${fadingTint}▀`);
  workingPulse = 0;
  isWorking = false;
  expect(editor.render(100)).toBe(idle);
  expect(pause.map(stripTerminalSequences)).toEqual(idle.map(stripTerminalSequences));
  completionPulse = 1;
  const completed = editor.render(100);
  const completionColor = mixColors(rgbColor(68, 68, 68), currentTheme.colors.success, 0.4, "srgb");
  const completionAnsi = foregroundAnsi(completionColor, currentTheme.getColorMode());
  for (const line of completed.slice(0, -1)) expect(line).toStartWith(
    paintDockBorderSpace(completionAnsi),
  );
  expect(completed.at(-1)).toStartWith(`${completionAnsi}▀`);
  expect(editor.render(100)).toBe(completed);
  completionPulse = 0.5;
  const fadedCompletionAnsi = foregroundAnsi(
    mixColors(rgbColor(68, 68, 68), completionColor, 0.5, "srgb"),
    currentTheme.getColorMode(),
  );
  expect(editor.render(100).at(-1)).toStartWith(`${fadedCompletionAnsi}▀`);
  completionPulse = 0;
  expect(editor.render(100)).toBe(idle);
  isWorking = true;
  workingPulse = 1;
  workingPosition = 0.2;
  const bright = editor.render(100);
  workingPosition = 0.65;
  const bottom = editor.render(100);
  expect(bottom[0]).not.toBe(bright[0]);
  expect(bottom.at(-1)).not.toBe(bright.at(-1));
  expect(bottom.map(stripTerminalSequences)).toEqual(bright.map(stripTerminalSequences));
  workingPosition = 0.2;
  expect(editor.render(100)).toBe(bright);
  workingPulse = 0.3;
  const dimmed = editor.render(100);
  expect(dimmed[0]).not.toBe(bright[0]);
  expect(dimmed.map(stripTerminalSequences)).toEqual(bright.map(stripTerminalSequences));
  expect(editor.operations).toEqual({ highlight: 6, context: 6, layout: 6 });
  expect(contextReads).toBe(3);
  workingPulse = 1;
  for (let frame = 0; frame <= WORKING_SWEEP_FRAMES; frame++) {
    workingPosition = frame / (WORKING_SWEEP_FRAMES * 2);
    editor.render(100);
  }
  workingPosition = 0.2;
  const regenerated = editor.render(100);
  expect(regenerated).not.toBe(bright);
  expect(regenerated).toEqual(bright);
  workingPulse = 0.3;
  editor.setText("@Explore");
  const updated = editor.render(100);
  expect(updated).not.toEqual(dimmed);
  expect(editor.render(100)).toBe(updated);

  expect(editor.operations).toEqual({ highlight: 7, context: 7, layout: 7 });
  const resized = editor.render(101);
  expect(resized).not.toBe(updated);
  expect(editor.render(101)).toBe(resized);
  currentTheme = theme;
  expect(editor.render(101)).not.toBe(resized);
  expect(contextReads).toBe(3);
  for (const read of syncReads) expect(read).not.toHaveBeenCalled();

  const recordCacheUsage = (cacheRead: number) =>
    sessionManager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Done." }],
      api: "openai-responses",
      provider: "openai",
      model: "test",
      timestamp: 0,
      stopReason: "stop",
      usage: {
        input: 100 - cacheRead,
        output: 10,
        cacheRead,
        cacheWrite: 0,
        totalTokens: 110,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    });
  recordCacheUsage(80);
  const id = resultIds[0];
  const originalLeaf = sessionManager.getLeafId();
  if (!id || !originalLeaf) throw new Error("Missing test session");
  const maskText = `${MARKER} saved output: /saved/${id}.txt`;
  const freedTokens = 500 - Math.ceil(maskText.length / 4);
  sessionManager.appendContextEdit(id, {
    content: [{ type: "text", text: maskText }],
  });
  sessionManager.appendCustomEntry("context-masking", {
    items: [{ entryId: id, path: `/saved/${id}.txt`, toolName: "read" }],
  });
  const maskedLeaf = sessionManager.getLeafId();
  if (!maskedLeaf) throw new Error("Missing masked leaf");
  usage = { tokens: 10_000, percent: 5, contextWindow: 200_000 };
  expect(stripTerminalSequences(editor.render(100).join("\n"))).toContain(
    `~10K (5%) 󰈉 ~${freedTokens} 󰆼 80%`,
  );
  expect(editor.render(100).join("\n")).toContain(currentTheme.fg("warning", " 󰆼 80%"));
  expect(contextReads).toBe(4);
  for (let frame = 0; frame < 20; frame++) editor.render(100);
  expect(contextReads).toBe(4);
  for (const width of [20, 40, 80]) {
    for (const line of editor.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
  }

  recordCacheUsage(10);
  expect(stripTerminalSequences(editor.render(100).join("\n"))).toContain(
    `󰈉 ~${freedTokens} 󰆼 45%`,
  );
  expect(editor.render(100).join("\n")).toContain(currentTheme.fg("error", " 󰆼 45%"));
  recordCacheUsage(40.4);
  expect(stripTerminalSequences(editor.render(100).join("\n"))).toContain(
    `󰈉 ~${freedTokens} 󰆼 43%`,
  );
  expect(contextReads).toBe(6);
  sessionManager.branch(originalLeaf);
  expect(stripTerminalSequences(editor.render(100).join("\n"))).not.toContain("󰈉");
  expect(contextReads).toBe(7);
  sessionManager.branch(maskedLeaf);
  expect(stripTerminalSequences(editor.render(100).join("\n"))).toContain(
    `󰈉 ~${freedTokens} 󰆼 80%`,
  );
  expect(contextReads).toBe(8);
  recordCacheUsage(100);
  expect(editor.render(100).join("\n")).toContain(currentTheme.fg("muted", " 󰆼 90%"));
  expect(contextReads).toBe(9);
  for (const read of syncReads) expect(read).not.toHaveBeenCalled();
  editor.dispose();
  cache.dispose();
});
