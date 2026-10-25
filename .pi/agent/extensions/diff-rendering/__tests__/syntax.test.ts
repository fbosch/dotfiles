import { afterEach, describe, expect, test } from "bun:test";
import { createSyntaxHighlighter, type HighlightResult, type SyntaxToken } from "../syntax";

const highlighters: Array<ReturnType<typeof createSyntaxHighlighter>> = [];

function createHighlighter(theme?: string): ReturnType<typeof createSyntaxHighlighter> {
  const highlighter =
    theme === undefined ? createSyntaxHighlighter() : createSyntaxHighlighter(theme);
  highlighters.push(highlighter);
  return highlighter;
}

function sourceFromResult(result: HighlightResult): string {
  return result.lines.map((line) => line.map((token) => token.content).join("")).join("\n");
}

function findToken(
  result: HighlightResult,
  predicate: (token: SyntaxToken) => boolean,
): SyntaxToken {
  const token = result.lines.flat().find(predicate);
  if (token === undefined) throw new Error("Expected syntax token was not found");
  return token;
}

afterEach(async () => {
  await Promise.all(highlighters.splice(0).map((highlighter) => highlighter.dispose()));
});

describe("createSyntaxHighlighter", () => {
  test("reuses cached tokens and bounds both cache entries and retained source bytes", async () => {
    const highlighter = createHighlighter();
    const first = await highlighter.highlight("first", "file.unknown");
    expect(await highlighter.highlight("first", "other.unknown")).toBe(first);
    for (let i = 0; i < 128; i++) await highlighter.highlight(`entry ${i}`, "file.unknown");
    expect(await highlighter.highlight("first", "file.unknown")).not.toBe(first);

    const large = "x".repeat(60_000);
    const original = await highlighter.highlight(large, "file.unknown");
    for (let i = 0; i < 20; i++) await highlighter.highlight(large + i, "file.unknown");
    expect(await highlighter.highlight(large, "file.unknown")).not.toBe(original);
    await expect(
      highlighter.highlight(large, "file.unknown", AbortSignal.abort()),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
  test("uses the Zenwritten palette and preserves source text including Danish letters", async () => {
    const highlighter = createHighlighter();
    const source = "const name = 'Søren';\n// æøå ændres\n";
    await Promise.all([highlighter.prewarm(), highlighter.prewarm()]);

    const result = await highlighter.highlight(source, "sample.ts");

    expect(sourceFromResult(result)).toBe(source);
    expect(findToken(result, (token) => token.content === "const")).toMatchObject({
      color: "#BBBBBB",
      fontStyle: 2,
    });
    expect(findToken(result, (token) => token.content.includes("Søren"))).toMatchObject({
      color: "#8E8E8E",
    });
    expect(findToken(result, (token) => token.content.includes("ændres"))).toMatchObject({
      color: "#686868",
      fontStyle: 1,
    });
  });

  test("loads additional grammars lazily, deduplicates concurrent loads, and falls back safely", async () => {
    const highlighter = createHighlighter();
    const rust = "fn main() { let værdi = 1; }\n";
    const [first, second] = await Promise.all([
      highlighter.highlight(rust, "sample.rs"),
      highlighter.highlight(rust, "sample.rs"),
    ]);

    expect(sourceFromResult(first)).toBe(rust);
    expect(sourceFromResult(second)).toBe(rust);
    expect(first.warning).toBeUndefined();

    const unknown = await highlighter.highlight("blå tekst\n", "sample.unknown");
    expect(sourceFromResult(unknown)).toBe("blå tekst\n");
    expect(unknown.warning).toContain("unknown language");
    expect(unknown.lines[0]?.[0]).toEqual({ content: "blå tekst" });

    const oversized = "x".repeat(64 * 1024 + 1);
    const bounded = await highlighter.highlight(oversized, "sample.ts");
    expect(sourceFromResult(bounded)).toBe(oversized);
    expect(bounded.warning).toContain("resource limits");
    expect(bounded.lines[0]?.[0]).toEqual({ content: oversized });
  });

  test("supports bundled themes, rejects invalid names, isolates aborts, and disposes", async () => {
    expect(() => createSyntaxHighlighter("not-a-bundled-theme")).toThrow(
      'Unknown Shiki theme "not-a-bundled-theme"',
    );

    const configured = createHighlighter("github-dark");
    const controller = new AbortController();
    const cancelled = configured.highlight("const value = 1;", "sample.ts", controller.signal);
    controller.abort();

    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });

    const result = await configured.highlight("const value = 1;", "sample.ts");
    expect(sourceFromResult(result)).toBe("const value = 1;");

    await configured.dispose();
    await expect(configured.highlight("const value = 1;", "sample.ts")).rejects.toThrow(
      "Syntax highlighter has been disposed",
    );
    await expect(configured.prewarm()).rejects.toThrow("Syntax highlighter has been disposed");
    await configured.dispose();
  });

  test("disposes safely while initialization is pending", async () => {
    const highlighter = createHighlighter();
    const pendingHighlight = highlighter.highlight("local value = 1", "sample.lua");
    const disposing = highlighter.dispose();

    await expect(pendingHighlight).rejects.toThrow("Syntax highlighter has been disposed");
    await disposing;
    await highlighter.dispose();
  });
});
