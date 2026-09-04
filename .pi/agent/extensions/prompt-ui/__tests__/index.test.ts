import { expect, test } from "bun:test";
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
import promptUi from "../index";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
type FooterFactory = Exclude<Parameters<ExtensionContext["ui"]["setFooter"]>[0], undefined>;
type EditorFactory = Exclude<
  Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0],
  undefined
>;

test("refreshes the custom editor after compaction completes", () => {
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  let renderRequests = 0;
  let editor: { render(width: number): string[] } | undefined;
  const tui = {
    mode: "regular",
    terminal: { rows: 40, columns: 120 },
    requestRender: () => {
      renderRequests++;
    },
  } as unknown as TUI;
  setThemeInstance(
    loadThemeFromPath(new URL("../../../themes/zenwritten-dark.json", import.meta.url).pathname),
  );
  const footerData = {
    getGitBranch: () => null,
    getExtensionStatuses: () => new Map<string, string>(),
    getAvailableProviderCount: () => 0,
    onBranchChange: () => () => {},
  };
  let usage: { tokens: number; percent: number; contextWindow: number } | undefined = {
    tokens: 80_000,
    percent: 40,
    contextWindow: 200_000,
  };
  const ui = {
    theme,
    custom: async () => undefined,
    select: async () => undefined,
    confirm: async () => false,
    input: async () => undefined,
    setWorkingVisible() {},
    setWidget() {},
    setFooter(factory: FooterFactory | undefined) {
      if (factory !== undefined) factory(tui, theme, footerData);
    },
    setEditorComponent(factory: EditorFactory | undefined) {
      if (factory !== undefined) {
        editor = factory(tui, getEditorTheme(), getKeybindings() as unknown as KeybindingsManager);
      }
    },
  };
  const pi = {
    on(event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) {
      handlers.set(event, handler);
    },
    events: { on: () => () => {} },
    getThinkingLevel: () => "low",
  };
  const ctx = {
    cwd: REPO_ROOT,
    hasUI: true,
    mode: "tui",
    isProjectTrusted: () => false,
    sessionManager: { getSessionId: () => "test-session" },
    getContextUsage: () => usage,
    ui,
    model: { name: "Test", provider: "openai" },
  } as unknown as ExtensionContext;

  promptUi(pi as unknown as ExtensionAPI);
  handlers.get("session_start")?.({}, ctx);
  expect(editor).toBeDefined();

  const before = editor?.render(100).join("\n") ?? "";
  expect(before).toContain("80K (40%)");
  const requestsBeforeCompaction = renderRequests;

  usage = { tokens: 20_000, percent: 10, contextWindow: 200_000 };
  handlers.get("session_compact")?.({}, ctx);

  expect(renderRequests).toBe(requestsBeforeCompaction + 1);
  expect(editor?.render(100).join("\n")).toContain("20K (10%)");
});
