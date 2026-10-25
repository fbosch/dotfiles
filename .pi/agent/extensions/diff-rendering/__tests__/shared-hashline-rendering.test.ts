import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ExtensionAPI,
  type ExtensionContext,
  initTheme,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { theme } from "@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { withToolExecution } from "../../__tests__/fixtures/tool-context";
import { registerHashlineRendering } from "../hashline-rendering";
import diffRenderingExtension, {
  loadHashlineDiffTools,
  registerDiffRenderingExtension,
} from "../index";
import { color, lineBackground } from "../presentation";
import { registerHashlineReadRendering } from "../read-rendering";

type Resolver = Parameters<
  Parameters<typeof registerHashlineReadRendering>[0]["registerToolRenderer"]
>[0];
const cleanup: string[] = [];
const shutdowns: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const shutdown of shutdowns.splice(0)) await shutdown();
  for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true });
});
initTheme("dark", false);
async function setup(live = false) {
  const cwd = await mkdtemp(join(tmpdir(), "diffRendering-hashline-render-"));
  cleanup.push(cwd);
  const path = join(cwd, "source.ts");
  const destination = join(cwd, "destination.ts");
  await writeFile(path, 'const name = "æøå";\nconst count = 2;\n');
  await writeFile(destination, "export const target = true;\n");
  const tools = new Map((await loadHashlineDiffTools()).map((tool) => [tool.name, tool]));
  const resolvers: Resolver[] = [];
  const hooks = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void>>();
  const pi = {
    registerToolRenderer: (resolver: Resolver) => resolvers.push(resolver),
    registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
    registerEntryRenderer() {},
    registerCommand() {},
    on: (event: string, hook: (event: unknown, ctx: ExtensionContext) => Promise<void>) =>
      hooks.set(event, hook),
  } as unknown as ExtensionAPI & Parameters<typeof registerHashlineReadRendering>[0];
  if (live) {
    registerHashlineRendering(pi);
    registerDiffRenderingExtension(pi, { config: { editPreviews: true }, columns: () => 180 });
  } else diffRenderingExtension(pi);
  const ctx = withToolExecution({
    cwd,
    sessionManager: { getSessionId: () => cwd },
  } as ExtensionContext);
  if (live) {
    await hooks.get("session_start")?.({}, ctx);
    await hooks.get("before_agent_start")?.({}, ctx);
    shutdowns.push(async () => {
      await hooks.get("session_shutdown")?.({}, ctx);
    });
  }
  const execute = (name: string, args: object) =>
    tools.get(name)!.execute(crypto.randomUUID(), args, undefined, undefined, ctx);
  const anchors = async (file: string) => {
    const result = await execute("read", { path: file });
    return result.content.flatMap((block) =>
      block.type === "text"
        ? [...block.text.matchAll(/^([A-Za-z]+)│/gm)].map((match) => match[1]!)
        : [],
    );
  };
  function render(
    name: string,
    result: Awaited<ReturnType<typeof execute>>,
    expanded = true,
    isError = false,
    isPartial = false,
    ansi = false,
  ) {
    const resolve = (index: number): ReturnType<Resolver> =>
      index < resolvers.length
        ? resolvers[index]!(name, () => resolve(index + 1))
        : tools.get(name);
    const before = JSON.stringify(result);
    const output = resolve(0)!.renderResult!(result, { expanded, isPartial }, theme, {
      args: { path },
      argsComplete: true,
      cwd,
      executionStarted: true,
      expanded,
      invalidate() {},
      isError,
      isPartial,
      durationMs: undefined,
      outputPad: 1,
      lastComponent: undefined,
      showImages: false,
      state: {},
      toolCallId: "render",
    })
      .render(180)
      .join("\n");
    expect(JSON.stringify(result)).toBe(before);
    return ansi ? output : stripTerminalSequences(output);
  }
  return { path, destination, execute, anchors, render, tools };
}

test("live hashline edits use the Shiki split renderer without losing model-facing anchors", async () => {
  const f = await setup(true);
  const [first] = await f.anchors(f.path);
  const result = await f.execute("insert", {
    path: f.path,
    anchor: first,
    direction: "after",
    text: 'const added = "blå";',
  });
  const details = result.details as Record<string, unknown>;
  expect(details.diff).toMatch(/\+[A-Za-z]+│/u);
  expect(details.diffRendering).toMatchObject({ display: "side-by-side" });
  const output = f.render("insert", result);
  expect(output).toContain("╱");
  expect(output).toContain('const added = "blå";');
  expect(output).not.toMatch(/[ +-][A-Za-z]+│/u);
});

for (const name of ["insert", "replace", "replace_match", "copy", "move", "undo_last_change"]) {
  test(`${name}: real results render without anchor metadata, including collapsed output`, async () => {
    const f = await setup();
    const [first, second] = await f.anchors(f.path);
    const args =
      name === "insert" || name === "undo_last_change"
        ? { path: f.path, anchor: first, direction: "after", text: "const added = 3;" }
        : name === "replace"
          ? { path: f.path, remove_from: first, remove_to: first, text: 'const name = "changed";' }
          : name === "replace_match"
            ? {
                path: f.path,
                replace_from: first,
                replace_to: first,
                match: "æøå",
                replacement: "changed",
              }
            : {
                path: f.path,
                source_from: first,
                source_to: first,
                anchor: second,
                direction: "after",
              };
    let result = await f.execute(name === "undo_last_change" ? "insert" : name, args);
    if (name === "undo_last_change") result = await f.execute(name, { path: f.path });
    expect(result.details).toHaveProperty("diff");
    for (const expanded of [false, true]) {
      const output = f.render(name, result, expanded);
      expect(output).toContain("const");
      expect(output).toContain("▌");
      expect(output).toContain("─".repeat(20));
      expect(output).not.toMatch(/[ +-][A-Za-z]+│/);
    }
    const ansi = f.render(name, result, true, false, false, true);
    expect(
      (["+", "-"] as const).some((kind) => ansi.includes(color(lineBackground(kind), true))),
    ).toBe(true);
  });
}

test("hashline ellipses use the full code background before and after source rows", async () => {
  const f = await setup();
  const result = {
    content: [{ type: "text" as const, text: "Edited" }],
    details: {
      diff: "...\n abcde│const name = 1;\n...",
      diffLineNumbers: [undefined, 5, undefined],
    },
  };
  const output = f.render("replace", result, true, false, false, true);
  const ellipses = output
    .split("\n")
    .filter((line) => stripTerminalSequences(line).trim() === "...");
  expect(ellipses).toHaveLength(2);
  for (const line of ellipses) {
    expect(line).toContain(color(lineBackground(" "), true));
    expect(stripTerminalSequences(line).length).toBeGreaterThan(3);
  }
});

test("collapsed hashline footers follow the trailing ellipsis and precede metadata", async () => {
  const f = await setup();
  const result = {
    content: [{ type: "text" as const, text: "Warnings:\nKeep warning" }],
    details: {
      diff:
        Array.from({ length: 40 }, (_, index) => `+abcde│const value${index} = 1;`).join("\n") +
        "\n...\n[Diff truncated]",
      diffLineNumbers: Array.from({ length: 40 }, (_, index) => index + 1),
    },
  };
  const collapsed = f.render("insert", result, false);
  const ellipsis = collapsed.indexOf("...");
  const footer = collapsed.indexOf("more lines");
  expect(ellipsis).toBeGreaterThan(collapsed.indexOf("const value"));
  expect(footer).toBeGreaterThan(ellipsis);
  expect(collapsed.indexOf("[Diff truncated]")).toBeGreaterThan(footer);
  expect(collapsed).toContain("Keep warning");
  const expanded = f.render("insert", result, true);
  expect(expanded.indexOf("...")).toBeGreaterThan(expanded.indexOf("const value39"));
});
test("cross-file move renders both captured file diffs without reading current disk content", async () => {
  const f = await setup();
  const [source] = await f.anchors(f.path);
  const [target] = await f.anchors(f.destination);
  const result = await f.execute("move", {
    path: f.path,
    source_from: source,
    source_to: source,
    anchor: target,
    direction: "after",
  });
  await writeFile(f.path, "changed after the tool completed\n");
  const output = f.render("move", result);
  expect(output).toContain("source.ts");
  expect(output).toContain("destination.ts");
  expect(output).toContain('const name = "æøå";');
  expect(output).not.toMatch(/[ +-][A-Za-z]+│/);
});

test("real grep results preserve file headings, line numbers and match/context markers", async () => {
  const f = await setup();
  const result = await f.execute("grep", { path: f.path, pattern: "name", context: 1 });
  for (const expanded of [false, true]) {
    const output = f.render("grep", result, expanded);
    expect(output).toContain("source.ts");
    expect(output).toMatch(/1:│\s*const name/);
    expect(output).toMatch(/2-│\s*const count/);
    expect(output).not.toMatch(/[A-Za-z]+│/);
  }
});

test("collapsed reads show highlighted source rather than anchors", async () => {
  const f = await setup();
  const result = await f.execute("read", { path: f.path });
  const output = f.render("read", result, false);
  expect(output).toContain('1 │ const name = "æøå";');
  expect(output).not.toMatch(/[A-Za-z]+│/);
});

test("captured Diff details render even when the current tool has only its native renderer", async () => {
  const f = await setup();
  const result = {
    content: [
      { type: "text" as const, text: "Warnings:\nKeep this warning\n\nHints:\nKeep this hint" },
    ],
    details: {
      diff: "+abcde│const value = 1;",
      diffRendering: {
        display: "inline",
        noChanges: false,
        output: "CAPTURED DELTA",
        scope: "edit",
        width: 80,
      },
    },
  };
  const output = f.render("insert", result);
  expect(output).toContain("CAPTURED DELTA");
  expect(output).toContain("Keep this warning");
  expect(output).toContain("Keep this hint");
});

test.each([1, 5, 12])(
  "collapsed previews preserve source and notices with %i-character anchors",
  async (width) => {
    const f = await setup();
    const anchor = "a".repeat(width);
    const source = Array.from(
      { length: 40 },
      (_, index) => `+${anchor}│const value${index} = "fghij│literal";`,
    ).join("\n");
    const result = {
      content: [{ type: "text" as const, text: "Warnings:\nKeep warning\n\nHints:\nKeep hint" }],
      details: {
        diff: source + "\n[Diff truncated]",
        diffLineNumbers: Array.from({ length: 40 }, (_, index) => index + 1),
      },
    };
    const collapsed = f.render("insert", result, false);
    expect(collapsed).toContain("more lines");
    expect(collapsed).toContain("[Diff truncated]");
    expect(collapsed).toContain("Keep warning");
    expect(collapsed).toContain("Keep hint");
    expect(collapsed).toContain('▌ 1+ │ const value0 = "fghij│literal";');
    expect(f.render("insert", result)).toContain("value39");
    const read = {
      content: [
        {
          type: "text" as const,
          text: source.replaceAll(`+${anchor}│`, `${anchor}│`) + "\n[Showing lines 1–40 of 80]",
        },
      ],
      details: { offset: 1 },
    };
    const readOutput = f.render("read", read, false);
    expect(readOutput).toContain('1 │ const value0 = "fghij│literal";');
    expect(readOutput).toContain("[Showing lines 1–40 of 80]");
    const grep = {
      content: [
        {
          type: "text" as const,
          text:
            "=== source.ts ===\n" +
            source.replaceAll(`+${anchor}│`, `1:│ ${anchor}│`) +
            "\n[grep: match limit reached]",
        },
      ],
      details: undefined,
    };
    const grepOutput = f.render("grep", grep, false);
    expect(grepOutput).toContain('1:│ const value0 = "fghij│literal";');
    expect(grepOutput).toContain("[grep: match limit reached]");
  },
);

test.each([1, 5, 12])(
  "edit previews retain deletion rows with %i-character blank gutters",
  async (width) => {
    const f = await setup();
    const result = {
      content: [{ type: "text" as const, text: "Edited" }],
      details: {
        diff: `+${"a".repeat(width)}│const value = 1;\n-${" ".repeat(width)}│removed│literal`,
        diffLineNumbers: [7, 8],
      },
    };
    const output = f.render("replace", result);
    expect(output).toContain("▌ 7+ │ const value = 1;");
    expect(output).toContain("▌ 8- │ removed│literal");
  },
);

test("errors, partial results, no-ops and malformed metadata retain native behavior", async () => {
  const f = await setup();
  const error = await f.execute("insert", {
    path: f.path,
    anchor: "zzzzz",
    direction: "after",
    text: "x",
  });
  expect(f.render("insert", error, true, true)).toContain("E_");
  const partial = {
    content: [{ type: "text" as const, text: "pending" }],
    details: { diff: "+abcde│value" },
  };
  expect(f.render("insert", partial, true, false, true)).toContain("Editing");
  const noop = {
    content: [{ type: "text" as const, text: "No changes made" }],
    details: { diff: "", metrics: { classification: "noop" } },
  };
  expect(f.render("insert", noop)).toContain("No changes made");
  const malformed = {
    content: [{ type: "text" as const, text: "Plain output" }],
    details: { diff: 42, diffRendering: { output: 1 } },
  };
  expect(f.render("insert", malformed)).toContain("Plain output");
});
