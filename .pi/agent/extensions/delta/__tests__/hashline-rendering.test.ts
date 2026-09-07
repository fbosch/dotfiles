import { describe, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { type DeltaDetails, loadHashlineDeltaTools, registerDeltaExtension } from "../index";

type TextContent = { type: "text"; text: string };
type ResultEvent = {
  toolName: string;
  isError: boolean;
  content: TextContent[];
  details: unknown;
};
type ResultPatch = { content?: TextContent[]; details?: unknown };
type ResultHook = (
  event: ResultEvent,
  context: ExtensionContext,
) => Promise<ResultPatch | undefined> | ResultPatch | undefined;

const delta: DeltaDetails = {
  display: "inline",
  noChanges: false,
  output:
    "\u001b[91m19 local fast_interval_ms = 82\u001b[0m\n\u001b[92m19 local fast_interval_ms = 83\u001b[0m",
  scope: "edit changes",
  width: 80,
};
const theme = {
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
  getBgAnsi: () => "\u001b[48;2;34;34;34m",
  getFgAnsi: () => "\u001b[39m",
} as unknown as Theme;

async function setup() {
  const tools = new Map<string, ToolDefinition>();
  const resultHooks: ResultHook[] = [];
  let runtime = false;
  const pi = {
    registerTool: (tool: ToolDefinition) => {
      if (!runtime && tools.has(tool.name))
        throw new Error(`Tool ${tool.name} conflicts at startup`);
      tools.set(tool.name, tool);
    },
    registerCommand: () => {},
    registerEntryRenderer: () => {},
    on: (event: string, hook: ResultHook) => {
      if (event === "tool_result") resultHooks.push(hook);
    },
  } as unknown as ExtensionAPI;
  // Exercise the installed package's auto-read middleware, not just execute() output.
  const hashline = (await import(
    new URL("../../../npm/node_modules/pi-hashline-edit-pro/index.ts", import.meta.url).href
  )) as { default: (api: ExtensionAPI) => void };
  hashline.default(pi);
  const loadedHashlineTools = await loadHashlineDeltaTools();
  expect(loadedHashlineTools.map((tool) => tool.name)).toEqual([
    "replace",
    "insert",
    "undo_last_change",
  ]);
  const hashlineTools = loadedHashlineTools.map(({ name }) => {
    const tool = tools.get(name);
    if (tool === undefined) throw new Error(`${name} was not registered`);
    return tool;
  });
  type SessionStart = (event: unknown, context: ExtensionContext) => Promise<void> | void;
  let sessionStart: SessionStart | undefined;
  registerDeltaExtension(
    {
      ...pi,
      on: (event: string, handler: ResultHook | SessionStart) => {
        if (event === "session_start") sessionStart = handler as SessionStart;
        if (event === "tool_result") resultHooks.push(handler as ResultHook);
      },
    } as unknown as ExtensionAPI,
    { config: { editPreviews: true }, hashlineTools },
  );
  for (const tool of hashlineTools) expect(tools.get(tool.name)).toBe(tool);
  if (sessionStart === undefined) throw new Error("Delta session_start handler missing");
  runtime = true;
  await sessionStart({ type: "session_start" }, { cwd: "/repo" } as ExtensionContext);
  for (const tool of hashlineTools) expect(tools.get(tool.name)).not.toBe(tool);
  return { tools, resultHooks, hashlineTools };
}

function renderContext(expanded: boolean, isError = false) {
  return {
    args: { path: "sample.lua" },
    argsComplete: true,
    cwd: "/repo",
    executionStarted: true,
    expanded,
    invalidate: () => {},
    isError,
    isPartial: false,
    lastComponent: undefined,
    showImages: false,
    state: {},
    toolCallId: "hashline-render-test",
  };
}

function editResult(warnings: boolean) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Successfully replaced in sample.lua.${warnings ? "\n\nWarnings:\nNon-UTF-8 bytes were shown as U+FFFD; this edit rewrote the file as UTF-8." : ""}`,
      },
    ],
    details: {
      diff: " ...\n Ohcl│local launch_timeout_ms = 10000\n-vygo│local fast_interval_ms = 82\n+IPal│local fast_interval_ms = 83\n dfdy│local slow_interval_ms = 1000\n ...",
      diffLineNumbers: [undefined, 18, 19, 19, 20, undefined],
      metrics: { classification: "applied", added_lines: 1, removed_lines: 1 },
      delta,
    },
  };
}

for (const toolName of ["replace", "insert", "undo_last_change"]) {
  describe(`${toolName} Delta result`, () => {
    test("preserves errors, partial updates and the non-Delta fallback", async () => {
      const { tools, hashlineTools } = await setup();
      const renderResult = tools.get(toolName)?.renderResult;
      const originalRenderResult = hashlineTools.find(
        (tool) => tool.name === toolName,
      )?.renderResult;
      if (!renderResult || !originalRenderResult) throw new Error("hashline renderer missing");
      const applied = editResult(false);
      const cases = [
        {
          result: {
            ...applied,
            content: [{ type: "text" as const, text: "[E_STALE_ANCHOR] Anchor does not match." }],
          },
          isError: true,
          isPartial: false,
          expectedText: "[E_STALE_ANCHOR] Anchor does not match.",
        },
        {
          result: applied,
          isError: false,
          isPartial: true,
          expectedText: "Editing...",
        },
        {
          result: { ...applied, details: { ...applied.details, delta: undefined } },
          isError: false,
          isPartial: false,
          expectedText: "local fast_interval_ms = 83",
        },
      ];
      for (const { result, isError, isPartial, expectedText } of cases) {
        const options = { expanded: true, isPartial };
        const context = { ...renderContext(true, isError), isPartial };
        const rendered = renderResult(result, options, theme, context).render(80);
        const original = originalRenderResult(result, options, theme, {
          ...context,
          state: {},
        }).render(80);
        expect(rendered).toEqual(original);
        expect(stripVTControlCharacters(rendered.join("\n"))).toContain(expectedText);
      }
    });

    for (const expanded of [false, true]) {
      test.each([false, true])(
        `renders the auto-read diff only once when expanded=${expanded}, Delta hook first=%s`,
        async (deltaFirst) => {
          const { tools, resultHooks } = await setup();
          const tool = tools.get(toolName);
          if (!tool?.renderCall || !tool.renderResult) throw new Error("hashline renderer missing");
          const hooks = deltaFirst ? [...resultHooks].reverse() : resultHooks;
          for (const warnings of [false, true]) {
            let result: ResultEvent = { ...editResult(warnings), toolName, isError: false };
            for (const hook of hooks) {
              result = { ...result, ...(await hook(result, { cwd: "/repo" } as ExtensionContext)) };
            }
            expect(result.content[0]?.text).toContain("+IPal│local fast_interval_ms = 83");
            const original = structuredClone(result);
            const context = renderContext(expanded);
            const call = tool.renderCall(context.args, theme, context).render(80).join("\n").trim();
            const rendered = tool
              .renderResult(result, { expanded, isPartial: false }, theme, context)
              .render(80)
              .join("\n");
            expect(call).toBe(`${toolName} sample.lua`);
            expect(rendered.match(/local fast_interval_ms = 82/g)).toHaveLength(1);
            expect(rendered.match(/local fast_interval_ms = 83/g)).toHaveLength(1);
            expect(rendered).not.toContain("local launch_timeout_ms");
            expect(rendered).not.toContain("IPal│");
            expect(rendered).not.toContain("...");
            expect(rendered).toContain("19 local fast_interval_ms");
            const plainRendered = stripVTControlCharacters(rendered).replace(/\s+/gu, " ");
            const warningText =
              "Non-UTF-8 bytes were shown as U+FFFD; this edit rewrote the file as UTF-8.";
            if (warnings) expect(plainRendered).toContain(warningText);
            else expect(plainRendered).not.toContain(warningText);
            expect(result).toEqual(original);
          }
        },
      );
    }
  });
}
