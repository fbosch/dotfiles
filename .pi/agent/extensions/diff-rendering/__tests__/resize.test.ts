import { expect, test } from "bun:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { theme } from "@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { stripTerminalSequences, Text, visibleWidth } from "@earendil-works/pi-tui";
import { structuredPatch } from "diff";
import { createDiffRenderer } from "../engine";
import { registerHashlineRendering } from "../hashline-rendering";
import { diffCell, diffRule } from "../presentation";
import type { DiffDetails } from "../shared";

initTheme("dark", false);
type API = Parameters<typeof registerHashlineRendering>[0];
type Resolver = Parameters<API["registerToolRenderer"]>[0];

function preview(captured: boolean, expanded = true, snapshot?: DiffDetails) {
  const resolvers: Resolver[] = [];
  registerHashlineRendering({
    registerToolRenderer: (resolver) => resolvers.push(resolver),
  });
  const native = { renderResult: () => new Text("native", 0, 0) };
  const resolve = (index: number): ReturnType<Resolver> => {
    const resolver = resolvers[index];
    return resolver ? resolver("insert", () => resolve(index + 1)) : native;
  };
  const body = `const message = "æøå 中文😀 ${"long source ".repeat(9)}";`;
  const result = {
    content: [{ type: "text" as const, text: "Edited" }],
    details: {
      diff: `+abcde│${body}`,
      diffLineNumbers: [197],
      ...(captured
        ? {
            diffRendering: snapshot ?? {
              display: "inline" as const,
              noChanges: false,
              output: [diffRule(160), ...diffCell(body, "+", 197, 160, 3), diffRule(160)].join(
                "\n",
              ),
              scope: "edit",
              width: 160,
            },
          }
        : {}),
    },
  };
  const original = structuredClone(result);
  const renderResult = resolve(0)?.renderResult;
  if (!renderResult) throw new Error("Hashline renderer missing");
  const component = renderResult(result, { expanded, isPartial: false }, theme, {
    args: { path: "source.ts" },
    argsComplete: true,
    cwd: "/repo",
    executionStarted: true,
    expanded,
    invalidate() {},
    isError: false,
    isPartial: false,
    durationMs: undefined,
    outputPad: 1,
    lastComponent: undefined,
    showImages: false,
    state: {},
    toolCallId: "resize",
  });
  return { body, component, result, original };
}

for (const captured of [false, true]) {
  test.each([false, true])(`hashline resize: captured=${captured}, expanded=%s`, (expanded) => {
    const { body, component, result, original } = preview(captured, expanded);
    const wide = component.render(160);
    for (const width of [80, 40, 200, 80]) {
      const rows = component.render(width);
      expect(component.render(width)).toBe(rows);
      expect(rows.every((row) => visibleWidth(row) <= width)).toBe(true);
      const code = rows.map(stripTerminalSequences).filter((row) => row.includes("│"));
      expect(code.length).toBeGreaterThan(0);
      const layoutWidth = captured && width >= 160 ? 160 : width;
      expect(code.every((row) => visibleWidth(row) === layoutWidth)).toBe(true);
      expect(code).toEqual(diffCell(body, "+", 197, layoutWidth, 3).map(stripTerminalSequences));
      expect(
        rows.filter((row) => /^─+$/u.test(stripTerminalSequences(row))).map(visibleWidth),
      ).toEqual([layoutWidth, layoutWidth]);
    }
    expect(component.render(160)).toEqual(wide);
    component.invalidate();
    expect(component.render(160)).toEqual(wide);
    expect(result).toEqual(original);
  });
}

test("captured split previews switch to inline below their saved width and restore on widening", async () => {
  const engine = createDiffRenderer();
  try {
    const body = preview(false).body;
    const patch = structuredPatch("source.ts", "source.ts", "", `${body}\n`);
    for (const hunk of patch.hunks) hunk.newStart = 197;
    const rendered = await engine.render([patch], {
      width: 160,
      display: "side-by-side",
      auto: false,
    });
    expect(rendered.display).toBe("side-by-side");
    const snapshot: DiffDetails = {
      ...rendered,
      noChanges: false,
      scope: "edit",
      width: 160,
      warning: "Keep captured warning",
      truncation: { outputLines: 1, totalLines: 2, outputBytes: 10, totalBytes: 20 },
      fullOutputPath: "/tmp/full-diff.txt",
    };
    const { component, result, original } = preview(true, true, snapshot);
    const wide = component.render(160);
    expect(stripTerminalSequences(wide.join("\n"))).toContain("╱");
    const narrow = component.render(60);
    const text = stripTerminalSequences(narrow.join("\n"));
    expect(text).toContain("197+ │");
    expect(text).toContain("Keep captured warning");
    expect(text).toContain("Diff output was truncated.");
    expect(text).toContain("/tmp/full-diff.txt");
    expect(narrow.every((row) => visibleWidth(row) <= 60)).toBe(true);
    expect(component.render(160)).toEqual(wide);
    expect(result).toEqual(original);
  } finally {
    await engine.dispose();
  }
});
