import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTheme, type ExtensionAPI, type ExtensionContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { theme } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import deltaExtension, { loadHashlineDeltaTools } from "../index";
import { registerHashlineReadRendering } from "../read-rendering";
import { withToolExecution } from "../../__tests__/fixtures/tool-context";

type Resolver = Parameters<Parameters<typeof registerHashlineReadRendering>[0]["registerToolRenderer"]>[0];
const cleanup: string[] = [];
afterEach(async () => { for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true }); });
initTheme("dark", false);
async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), "delta-hashline-render-"));
  cleanup.push(cwd);
  const path = join(cwd, "source.ts");
  const destination = join(cwd, "destination.ts");
  await writeFile(path, 'const name = "æøå";\nconst count = 2;\n');
  await writeFile(destination, 'export const target = true;\n');
  const tools = new Map((await loadHashlineDeltaTools()).map((tool) => [tool.name, tool]));
  const resolvers: Resolver[] = [];
  deltaExtension({ registerToolRenderer: (resolver: Resolver) => resolvers.push(resolver),
    registerTool() {}, registerEntryRenderer() {}, registerCommand() {}, on() {},
  } as unknown as ExtensionAPI & Parameters<typeof registerHashlineReadRendering>[0]);
  const ctx = withToolExecution({ cwd, sessionManager: { getSessionId: () => cwd } } as ExtensionContext);
  const execute = (name: string, args: object) => tools.get(name)!.execute(crypto.randomUUID(), args, undefined, undefined, ctx);
  const anchors = async (file: string) => {
    const result = await execute("read", { path: file });
    return result.content.flatMap((block) => block.type === "text" ? [...block.text.matchAll(/^([A-Za-z]{4})│/gm)].map((match) => match[1]!) : []);
  };
  function render(name: string, result: Awaited<ReturnType<typeof execute>>, expanded = true, isError = false, isPartial = false) {
    const resolve = (index: number): ReturnType<Resolver> => index < resolvers.length
      ? resolvers[index]!(name, () => resolve(index + 1)) : tools.get(name);
    const before = JSON.stringify(result);
    const output = resolve(0)!.renderResult!(result, { expanded, isPartial }, theme, {
      args: { path }, argsComplete: true, cwd, executionStarted: true, expanded, invalidate() {},
      isError, isPartial, lastComponent: undefined, showImages: false, state: {}, toolCallId: "render",
    }).render(180).join("\n");
    expect(JSON.stringify(result)).toBe(before);
    return stripTerminalSequences(output);
  }
  return { path, destination, execute, anchors, render, tools };
}

for (const name of ["insert", "replace", "replace_match", "copy", "move", "undo_last_change"]) {
  test(`${name}: real results render without anchor metadata, including collapsed output`, async () => {
    const f = await setup();
    const [first, second] = await f.anchors(f.path);
    const args = name === "insert" || name === "undo_last_change" ? { path: f.path, anchor: first, direction: "after", text: "const added = 3;" }
      : name === "replace" ? { path: f.path, remove_from: first, remove_to: first, text: 'const name = "changed";' }
      : name === "replace_match" ? { path: f.path, replace_from: first, replace_to: first, match: "æøå", replacement: "changed" }
      : { path: f.path, source_from: first, source_to: first, anchor: second, direction: "after" };
    let result = await f.execute(name === "undo_last_change" ? "insert" : name, args);
    if (name === "undo_last_change") result = await f.execute(name, { path: f.path });
    expect(result.details).toHaveProperty("diff");
    for (const expanded of [false, true]) {
      const output = f.render(name, result, expanded);
      expect(output).toContain("const");
      expect(output).not.toMatch(/[ +-][A-Za-z]{4}│/);
    }
  });
}

test("cross-file move renders both captured file diffs without reading current disk content", async () => {
  const f = await setup();
  const [source] = await f.anchors(f.path);
  const [target] = await f.anchors(f.destination);
  const result = await f.execute("move", { path: f.path, source_from: source, source_to: source, anchor: target, direction: "after" });
  await writeFile(f.path, "changed after the tool completed\n");
  const output = f.render("move", result);
  expect(output).toContain("source.ts");
  expect(output).toContain("destination.ts");
  expect(output).toContain('const name = "æøå";');
  expect(output).not.toMatch(/[ +-][A-Za-z]{4}│/);
});

test("real grep results preserve file headings, line numbers and match/context markers", async () => {
  const f = await setup();
  const result = await f.execute("grep", { path: f.path, pattern: "name", context: 1 });
  for (const expanded of [false, true]) {
    const output = f.render("grep", result, expanded);
    expect(output).toContain("source.ts");
    expect(output).toMatch(/1:│\s*const name/);
    expect(output).toMatch(/2-│\s*const count/);
    expect(output).not.toMatch(/[A-Za-z]{4}│/);
  }
});

test("collapsed reads show highlighted source rather than anchors", async () => {
  const f = await setup();
  const result = await f.execute("read", { path: f.path });
  const output = f.render("read", result, false);
  expect(output).toContain('1 │ const name = "æøå";');
  expect(output).not.toMatch(/[A-Za-z]{4}│/);
});


test("captured Delta details render even when the current tool has only its native renderer", async () => {
  const f = await setup();
  const result = { content: [{ type: "text" as const, text: "Warnings:\nKeep this warning\n\nHints:\nKeep this hint" }],
    details: { diff: "+Abcd│const value = 1;", delta: { display: "inline", noChanges: false, output: "CAPTURED DELTA", scope: "edit", width: 80 } } };
  const output = f.render("insert", result);
  expect(output).toContain("CAPTURED DELTA");
  expect(output).toContain("Keep this warning");
  expect(output).toContain("Keep this hint");
});

test("collapsed previews retain truncation notices, warnings and literal anchor-like source", async () => {
  const f = await setup();
  const source = Array.from({ length: 40 }, (_, index) => `+Abcd│const value${index} = "Efgh│literal";`).join("\n");
  const result = { content: [{ type: "text" as const, text: "Warnings:\nKeep warning\n\nHints:\nKeep hint" }],
    details: { diff: source + "\n[Diff truncated]", diffLineNumbers: Array.from({ length: 40 }, (_, index) => index + 1) } };
  const collapsed = f.render("insert", result, false);
  expect(collapsed).toContain("more lines");
  expect(collapsed).toContain("[Diff truncated]");
  expect(collapsed).toContain("Keep warning");
  expect(collapsed).toContain("Keep hint");
  expect(collapsed).toContain("Efgh│literal");
  expect(f.render("insert", result)).toContain("value39");
  const read = { content: [{ type: "text" as const, text: source.replaceAll("+Abcd│", "Abcd│") + "\n[Showing lines 1–40 of 80]"}], details: { offset: 1 } };
  expect(f.render("read", read, false)).toContain("[Showing lines 1–40 of 80]");
  const grep = { content: [{ type: "text" as const, text: "=== source.ts ===\n" + source.replaceAll("+Abcd│", "1:│ Abcd│") + "\n[grep: match limit reached]"}], details: undefined };
  expect(f.render("grep", grep, false)).toContain("[grep: match limit reached]");
});

test("errors, partial results, no-ops and malformed metadata retain native behavior", async () => {
  const f = await setup();
  const error = await f.execute("insert", { path: f.path, anchor: "zzzz", direction: "after", text: "x" });
  expect(f.render("insert", error, true, true)).toContain("E_");
  const partial = { content: [{ type: "text" as const, text: "pending" }], details: { diff: "+Abcd│value" } };
  expect(f.render("insert", partial, true, false, true)).toContain("Editing");
  const noop = { content: [{ type: "text" as const, text: "No changes made" }], details: { diff: "", metrics: { classification: "noop" } } };
  expect(f.render("insert", noop)).toContain("No changes made");
  const malformed = { content: [{ type: "text" as const, text: "Plain output" }], details: { diff: 42, delta: { output: 1 } } };
  expect(f.render("insert", malformed)).toContain("Plain output");
});
