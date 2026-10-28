import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  getEditorTheme,
  loadThemeFromPath,
  setThemeInstance,
  theme,
} from "@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { getKeybindings, stripTerminalSequences, type TUI } from "@earendil-works/pi-tui";
import promptUi from "../index";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const PROMPT_UI_EXTENSION_PATH = new URL("../index.ts", import.meta.url).pathname;

const initialNonoCapFile = process.env.NONO_CAP_FILE;
afterEach(() => {
  if (initialNonoCapFile === undefined) delete process.env.NONO_CAP_FILE;
  else process.env.NONO_CAP_FILE = initialNonoCapFile;
});
test("headless startup does not load prompt UI rules", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "pi-prompt-ui-headless-"));
  try {
    const child = Bun.spawn(
      [
        process.execPath,
        "--no-install",
        "-e",
        `
const { default: extension } = await import(process.argv[1]);
let sessionStart;
extension({ events: { on() {} }, on(event, handler) { if (event === "session_start") sessionStart = handler; } });
await sessionStart({ type: "session_start", reason: "startup" }, { hasUI: false });
console.log("headless");
`,
        PROMPT_UI_EXTENSION_PATH,
      ],
      {
        env: { ...process.env, XDG_CONFIG_HOME: configHome },
        stderr: "pipe",
        stdout: "pipe",
      },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ exitCode, stderr, stdout }).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "headless\n",
    });
  } finally {
    await rm(configHome, { force: true, recursive: true });
  }
});

test("keeps the prompt editor and typo modules out of the entrypoint's static graph", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "pi-prompt-ui-lazy-"));
  try {
    const build = await Bun.build({
      entrypoints: [PROMPT_UI_EXTENSION_PATH],
      outdir: outputDirectory,
      splitting: true,
      target: "bun",
    });
    if (!build.success) throw new Error(build.logs.map((log) => log.message).join("\n"));

    const staticFiles = new Set(["index.js"]);
    const visited = new Set<string>();
    while (staticFiles.size > visited.size) {
      const fileName = [...staticFiles].find((candidate) => !visited.has(candidate));
      if (fileName === undefined) break;
      visited.add(fileName);
      const source = await Bun.file(join(outputDirectory, fileName)).text();
      for (const line of source.split("\n")) {
        const match = /^\s*(?:import(?!\s*\()|export).*?["'](\.\/[^"']+)["']/.exec(line);
        const specifier = match?.[1];
        if (specifier !== undefined) staticFiles.add(specifier.slice(2));
      }
    }

    const staticGraph = await Promise.all(
      [...visited].map((fileName) => Bun.file(join(outputDirectory, fileName)).text()),
    );
    const outputSources = await Promise.all(
      (await readdir(outputDirectory))
        .filter((fileName) => fileName.endsWith(".js"))
        .map((fileName) => Bun.file(join(outputDirectory, fileName)).text()),
    );
    expect(staticGraph.join("\n")).not.toContain("prompt-ui/prompt-editor.ts");
    expect(staticGraph.join("\n")).not.toContain("typo-abolish/index.ts");
    expect(outputSources.some((source) => source.includes("prompt-ui/prompt-editor.ts"))).toBe(
      true,
    );
    expect(outputSources.some((source) => source.includes("typo-abolish/index.ts"))).toBe(true);
  } finally {
    await rm(outputDirectory, { force: true, recursive: true });
  }
});
type FooterFactory = Exclude<Parameters<ExtensionContext["ui"]["setFooter"]>[0], undefined>;
type EditorFactory = Exclude<
  Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0],
  undefined
>;

test("uses MCP extension status in the footer and refreshes the editor after compaction", async () => {
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  let renderRequests = 0;
  let workingVisible = true;
  let editor: { render(width: number): string[] } | undefined;
  let footer: ReturnType<FooterFactory> | undefined;
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
  const extensionStatuses = new Map<string, string>();
  const footerData = {
    getGitBranch: () => null,
    getExtensionStatuses: () => extensionStatuses,
    getAvailableProviderCount: () => 0,
    onBranchChange: () => () => {},
  };
  let usage: ReturnType<ExtensionContext["getContextUsage"]> = {
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
    setWorkingVisible(visible: boolean) {
      workingVisible = visible;
    },
    setWidget() {},
    setFooter(factory: FooterFactory | undefined) {
      if (factory !== undefined) footer = factory(tui, theme, footerData);
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
    modelRegistry: { find: () => undefined },
    sessionManager: SessionManager.inMemory(REPO_ROOT),
    getContextUsage: () => usage,
    ui,
    model: { name: "Test", provider: "openai" },
  } as unknown as ExtensionContext;

  promptUi(pi as unknown as ExtensionAPI);
  await handlers.get("session_start")?.({}, ctx);
  expect(editor).toBeDefined();
  expect(footer).toBeDefined();
  expect(editor?.render(100).join("\n")).not.toMatch(/\b(?:Plan|Build)\b/);
  expect(workingVisible).toBe(false);
  try {
    for (let run = 0; run < 2; run++) {
      await handlers.get("agent_start")?.({}, ctx);
      const workingFooter = stripTerminalSequences(footer?.render(120).join("\n") ?? "");
      expect(workingFooter).toContain("working");
      await handlers.get("agent_settled")?.({}, ctx);
      const idleFooter = stripTerminalSequences(footer?.render(120).join("\n") ?? "");
      expect(idleFooter).not.toContain("working");
    }
  } finally {
    await handlers.get("agent_settled")?.({}, ctx);
  }
  extensionStatuses.set("mcp", "MCP 2/6!");
  for (const [capFile, icon] of [
    ["/native/nono/capabilities.json", ""],
    [undefined, ""],
    ["", ""],
  ] as const) {
    if (capFile === undefined) delete process.env.NONO_CAP_FILE;
    else process.env.NONO_CAP_FILE = capFile;
    const footerText = stripTerminalSequences(footer?.render(120).join("\n") ?? "");
    expect(footerText.endsWith(` 2 MCP · ${icon} `)).toBe(true);
    extensionStatuses.delete("mcp");
    const withoutMcp = stripTerminalSequences(footer?.render(120).join("\n") ?? "");
    expect(withoutMcp.endsWith(`${icon} `)).toBe(true);
    expect(withoutMcp).not.toContain("MCP");
    extensionStatuses.set("mcp", "MCP 2/6!");
  }
  extensionStatuses.set("pi-lens-lsp", "LSP Inactive");
  expect(editor?.render(100).join("\n")).not.toContain("LSP Inactive");
  extensionStatuses.set("startup-time", "Startup: 1.18s (startup)");
  expect(editor?.render(100).join("\n")).not.toContain("Startup:");

  const before = editor?.render(100).join("\n") ?? "";
  expect(before).toContain("80K (40%)");
  const requestsBeforeCompaction = renderRequests;

  ctx.sessionManager.appendCompaction("s".repeat(80_000), null, 80_000);
  usage = { tokens: null, percent: null, contextWindow: 200_000 };
  handlers.get("session_compact")?.({}, ctx);

  expect(renderRequests).toBe(requestsBeforeCompaction + 1);
  expect(editor?.render(100).join("\n")).toContain("~20K (10%)");

  usage = { tokens: 5_000, percent: 2.5, contextWindow: 200_000 };
  const requestsBeforeSettled = renderRequests;
  await handlers.get("agent_settled")?.({}, ctx);
  expect(renderRequests).toBe(requestsBeforeSettled + 1);
  expect(editor?.render(100).join("\n")).toContain("~5K (3%)");
  await handlers.get("session_shutdown")?.({}, ctx);
});
