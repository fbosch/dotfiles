import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { MarkdownTheme } from "@earendil-works/pi-tui";
import { Markdown, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { installCodeBlockRenderer, renderCodeBlock } from "../code-blocks";

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
      "  TypeScript                ",
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
    const body = plain(lines).slice(3, -1);

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

    expect(rendered[1]?.trim()).toBe("Diff example.ts");
    expect(rendered[3]?.startsWith(" 10  const stable = true;")).toBe(true);
    expect(rendered[4]?.startsWith(" 11- const oldValue = 1;")).toBe(true);
    expect(rendered[5]?.startsWith(" 11+ const newValue = 2;")).toBe(true);
    expect(rendered[6]?.startsWith(" 12+ return newValue;")).toBe(true);
    expect(lines[4]).toContain(BACKGROUNDS.toolErrorBg);
    expect(lines[5]).toContain(BACKGROUNDS.toolSuccessBg);
  });

  test("restores Pi's Markdown renderer after unload", () => {
    const prototype = Markdown.prototype as unknown as { renderToken: unknown };
    const originalRenderToken = prototype.renderToken;
    const patch = installCodeBlockRenderer();

    expect(patch.installed).toBe(true);
    expect(prototype.renderToken).not.toBe(originalRenderToken);
    patch.restore();
    expect(prototype.renderToken).toBe(originalRenderToken);
  });
});
