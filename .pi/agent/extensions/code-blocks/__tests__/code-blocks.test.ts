import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { MarkdownTheme } from "@earendil-works/pi-tui";
import { Markdown, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { associateFilenamesWithCodeFences, installCodeBlockRenderer, renderCodeBlock } from "..";

const FOREGROUND = "\u001b[38;2;187;187;187m";
const FOREGROUND_RESET = "\u001b[39m";
const BACKGROUNDS = {
  customMessageBg: "\u001b[48;2;44;44;44m",
  toolErrorBg: "\u001b[48;2;62;34;37m",
  toolSuccessBg: "\u001b[48;2;35;45;26m",
  userMessageBg: "\u001b[48;2;34;34;34m",
} as const;

const markdownTheme: MarkdownTheme = {
  heading: (text) => text,
  link: (text) => text,
  linkUrl: (text) => text,
  code: (text) => text,
  codeBlock: (text) => text,
  codeBlockBorder: (text) => text,
  quote: (text) => text,
  quoteBorder: (text) => text,
  hr: (text) => text,
  listBullet: (text) => text,
  bold: (text) => text,
  italic: (text) => text,
  strikethrough: (text) => text,
  underline: (text) => text,
  highlightCode: (code) =>
    code.split("\n").map((line) => `${FOREGROUND}${line}${FOREGROUND_RESET}`),
};

const blockTheme = {
  fg: (_color: string, text: string) => `${FOREGROUND}${text}${FOREGROUND_RESET}`,
  getBgAnsi: (color: keyof typeof BACKGROUNDS) => BACKGROUNDS[color],
} as Pick<Theme, "fg" | "getBgAnsi">;

const component = { theme: markdownTheme };

function plain(lines: readonly string[]): string[] {
  return lines.map(stripTerminalSequences);
}

describe("code block rendering", () => {
  test("renders ordinary code as a full-width panel with a language header and line numbers", () => {
    const lines = renderCodeBlock(
      component,
      { type: "code", lang: "ts", text: "const answer = 42;\nreturn answer;\n" },
      28,
      undefined,
      blockTheme,
    );

    expect(lines.every((line) => visibleWidth(line) === 28)).toBe(true);
    expect(plain(lines)).toEqual([
      "                            ",
      "   TypeScript              ",
      "                            ",
      "                            ",
      "  1  const answer = 42;     ",
      "  2  return answer;         ",
      "                            ",
    ]);
    expect(lines[1]).toContain(BACKGROUNDS.customMessageBg);
    expect(lines[3]).toContain(BACKGROUNDS.userMessageBg);
  });

  test("wraps long code without repeating the line number on continuation rows", () => {
    const lines = renderCodeBlock(
      component,
      { type: "code", lang: "ts", text: "const longIdentifier = anotherLongIdentifier;" },
      20,
      undefined,
      blockTheme,
    );
    const body = plain(lines).slice(4, -1);

    expect(body.length).toBeGreaterThan(1);
    expect(body[0]?.startsWith("  1  ")).toBe(true);
    expect(body.slice(1).every((line) => line.startsWith("     "))).toBe(true);
    expect(lines.every((line) => visibleWidth(line) === 20)).toBe(true);
  });

  test("renders unified diffs with source line numbers and full-row change backgrounds", () => {
    const diff = [
      "diff --git a/example.ts b/example.ts",
      "--- a/example.ts",
      "+++ b/example.ts",
      "@@ -10,2 +10,3 @@",
      " const stable = true;",
      "-const oldValue = 1;",
      "+const newValue = 2;",
      "+return newValue;",
    ].join("\n");
    const lines = renderCodeBlock(
      component,
      { type: "code", lang: "diff", text: diff },
      32,
      undefined,
      blockTheme,
    );
    const rendered = plain(lines);

    expect(rendered[1]?.trim()).toBe(" example.ts");
    expect(rendered[4]?.startsWith(" 10  const stable = true;")).toBe(true);
    expect(rendered[5]?.startsWith(" 11- const oldValue = 1;")).toBe(true);
    expect(rendered[6]?.startsWith(" 11+ const newValue = 2;")).toBe(true);
    expect(rendered[7]?.startsWith(" 12+ return newValue;")).toBe(true);
    expect(lines[5]).toContain(BACKGROUNDS.toolErrorBg);
    expect(lines[6]).toContain(BACKGROUNDS.toolSuccessBg);
  });

  test("keeps header-like source lines inside a diff hunk", () => {
    const lines = renderCodeBlock(
      component,
      { type: "code", lang: "diff ts", text: "@@ -1 +1 @@\n--- old\n+++ new" },
      24,
      undefined,
      blockTheme,
    );
    const rendered = plain(lines);

    expect(rendered[1]?.trim()).toBe(" Diff");
    expect(rendered[4]?.startsWith("  1- -- old")).toBe(true);
    expect(rendered[5]?.startsWith("  1+ ++ new")).toBe(true);
  });

  test("uses the old path for deleted files and omits file metadata from source rows", () => {
    const diff = [
      "diff --git a/old.ts b/old.ts",
      "deleted file mode 100644",
      "index 1234567..0000000",
      "--- a/old.ts",
      "+++ /dev/null",
      "@@ -8 +0,0 @@",
      "-export const oldValue = 1;",
    ].join("\n");
    const lines = renderCodeBlock(
      component,
      { type: "code", lang: "diff", text: diff },
      36,
      undefined,
      blockTheme,
    );
    const rendered = plain(lines);

    expect(rendered[1]?.trim()).toBe(" old.ts");
    expect(rendered[4]?.startsWith("  8- export const oldValue = 1;")).toBe(true);
    expect(rendered.some((line) => line.includes("deleted file mode"))).toBe(false);
  });

  test("renders each file in a multi-file diff as a separate panel", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1 +1 @@",
      "-const a = 1;",
      "+const a = 2;",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -20 +20 @@",
      "-const b = 1;",
      "+const b = 2;",
    ].join("\n");
    const rendered = plain(
      renderCodeBlock(
        component,
        { type: "code", lang: "diff", text: diff },
        28,
        undefined,
        blockTheme,
      ),
    );

    expect(
      rendered.filter((line) => line.trim().endsWith(".ts")).map((line) => line.trim()),
    ).toEqual([" a.ts", " b.ts"]);
    expect(rendered.some((line) => line.startsWith(" 20- const b = 1;"))).toBe(true);
  });

  test("splits traditional multi-file unified diffs without Git separators", () => {
    const diff = [
      "--- a.ts",
      "+++ a.ts",
      "@@ -1 +1 @@",
      "-const a = 1;",
      "+const a = 2;",
      "--- b.ts",
      "+++ b.ts",
      "@@ -4 +4 @@",
      "-const b = 1;",
      "+const b = 2;",
    ].join("\n");
    const rendered = plain(
      renderCodeBlock(
        component,
        { type: "code", lang: "diff", text: diff },
        28,
        undefined,
        blockTheme,
      ),
    );

    expect(
      rendered.filter((line) => line.trim().endsWith(".ts")).map((line) => line.trim()),
    ).toEqual([" a.ts", " b.ts"]);
    expect(rendered.some((line) => line.startsWith("  4+ const b = 2;"))).toBe(true);
  });

  test("drops the gutter when the panel is too narrow to show content", () => {
    const lines = renderCodeBlock(
      component,
      { type: "code", lang: "text", text: "x" },
      5,
      undefined,
      blockTheme,
    );

    expect(plain(lines)[4]).toBe("x    ");
    expect(lines.every((line) => visibleWidth(line) === 5)).toBe(true);
  });

  test("preserves fence metadata after the language as the panel title", () => {
    const lines = renderCodeBlock(
      component,
      { type: "code", lang: "ts src/example file.ts", text: "export {};" },
      40,
      undefined,
      blockTheme,
    );

    expect(plain(lines)[1]?.trim()).toBe(" src/example file.ts");
  });

  test("uses a strict leading filename comment when fence metadata has no path", () => {
    const lines = renderCodeBlock(
      component,
      { type: "code", lang: "ts", text: "// agents.ts\nexport const agents = {};" },
      32,
      undefined,
      blockTheme,
    );

    expect(plain(lines)[1]?.trim()).toBe(" agents.ts");
    expect(plain(lines)[4]?.includes("// agents.ts")).toBe(true);
  });

  test("moves a standalone path into the following fence metadata", () => {
    const markdown = [
      "`.pi/agent/extensions/code-blocks.ts`",
      "",
      "```ts",
      "export const value = 1;",
      "```",
    ].join("\n");

    expect(associateFilenamesWithCodeFences(markdown)).toBe(
      [
        '```ts filename=".pi/agent/extensions/code-blocks.ts"',
        "export const value = 1;",
        "```",
      ].join("\n"),
    );
  });

  test("renders a preceding standalone path in the panel header", () => {
    const patch = installCodeBlockRenderer();
    const source = associateFilenamesWithCodeFences(
      "`.pi/agent/extensions/code-blocks.ts`\n\n```ts\nexport const value = 1;\n```",
    );
    const markdown = new Markdown(source, 0, 0, markdownTheme);

    try {
      const rendered = plain(markdown.render(48));
      expect(rendered.some((line) => line.trim() === " .pi/agent/extensions/code-blocks.ts")).toBe(
        true,
      );
      expect(rendered.filter((line) => line.includes("code-blocks.ts"))).toHaveLength(1);
    } finally {
      patch.restore();
    }
  });

  test("reapplies the panel background after syntax reset sequences", () => {
    const resettingComponent = {
      theme: {
        ...markdownTheme,
        highlightCode: (code: string) => [`\u001b[31m${code}\u001b[0mplain\u001b[49mbackground`],
      },
    };
    const lines = renderCodeBlock(
      resettingComponent,
      { type: "code", lang: "ts", text: "styled" },
      32,
      undefined,
      blockTheme,
    );

    expect(lines[4]).toContain(`\u001b[0m${BACKGROUNDS.userMessageBg}plain`);
    expect(lines[4]).toContain(`\u001b[49m${BACKGROUNDS.userMessageBg}background`);
  });

  test("integrates with Pi's Markdown lexer without displaying fences", () => {
    const patch = installCodeBlockRenderer();
    const markdown = new Markdown("```ts\nconst value = 1;\n```", 0, 0, markdownTheme);

    try {
      const rendered = plain(markdown.render(24));
      expect(rendered.some((line) => line.includes("```"))).toBe(false);
      expect(rendered.some((line) => line.includes("TypeScript"))).toBe(true);
      expect(rendered.some((line) => line.includes("const value = 1;"))).toBe(true);
    } finally {
      patch.restore();
    }
  });

  test("conceals partial closing markers while a code fence streams", () => {
    const patch = installCodeBlockRenderer();

    try {
      for (const source of [
        "```ts\nconst value = 1;\n`",
        "```ts\nconst value = 1;\n``",
        "~~~ts\nconst value = 1;\n~",
        "~~~ts\nconst value = 1;\n~~",
      ]) {
        const rendered = plain(new Markdown(source, 0, 0, markdownTheme).render(24));
        expect(rendered.some((line) => line.includes("`"))).toBe(false);
        expect(rendered.some((line) => line.includes("~"))).toBe(false);
        expect(rendered.some((line) => line.includes("const value = 1;"))).toBe(true);
      }
    } finally {
      patch.restore();
    }
  });

  test("restores Pi's Markdown renderer across repeated installs", () => {
    const prototype = Markdown.prototype as unknown as { renderToken: unknown };
    const originalRenderToken = prototype.renderToken;
    const firstPatch = installCodeBlockRenderer();
    const firstRenderer = prototype.renderToken;
    const secondPatch = installCodeBlockRenderer();
    const secondRenderer = prototype.renderToken;

    expect(firstPatch.installed).toBe(true);
    expect(secondPatch.installed).toBe(true);
    expect(firstRenderer).not.toBe(originalRenderToken);
    expect(secondRenderer).not.toBe(firstRenderer);
    firstPatch.restore();
    expect(prototype.renderToken).toBe(secondRenderer);
    secondPatch.restore();
    expect(prototype.renderToken).toBe(originalRenderToken);
  });
});
