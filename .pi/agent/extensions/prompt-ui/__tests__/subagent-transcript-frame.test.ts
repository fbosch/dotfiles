import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  compositeTuiLine,
  hyperlink,
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { SubagentTranscriptFrame } from "../subagent-transcript-frame";

const background = "\u001b[48;2;25;25;25m";
const border = "\u001b[38;2;187;187;187m";
const accent = "\u001b[38;2;102;165;173m";
const muted = "\u001b[38;2;104;104;104m";
function createTheme(mode: ReturnType<Theme["getColorMode"]> = "truecolor"): Theme {
  return {
    fg: (color: string, text: string) => {
      expect(["borderAccent", "accent", "muted"]).toContain(color);
      const colorAnsi = color === "accent" ? accent : color === "muted" ? muted : border;
      return `${colorAnsi}${text}\u001b[39m`;
    },
    bold: (text: string) => text,
    getColorMode: () => mode,
  } as Theme;
}
const theme = createTheme();

function createPane(lines: string[]): Component {
  return { render: () => ["Subagent session", ...lines], invalidate() {} };
}

describe("subagent transcript frame", () => {
  test("frames and paints the pane while reserving horizontal padding", () => {
    let contentWidth = 0;
    const frame = new SubagentTranscriptFrame(
      {
        render: (width) => {
          contentWidth = width;
          return ["Subagent session", "first\u001b[0m line", ""];
        },
        invalidate() {},
      },
      theme,
      "explore",
    );

    const lines = frame.render(32);
    expect(contentWidth).toBe(28);
    expect(lines.map(stripTerminalSequences)).toEqual([
      `╭${"─".repeat(30)}╮`,
      `│ explore subagent session${" ".repeat(5)}│`,
      `│ first line${" ".repeat(19)}│`,
      `│${" ".repeat(30)}│`,
      `╰${"─".repeat(30)}╯`,
    ]);
    expect(lines.every((line) => visibleWidth(line) === 32)).toBe(true);
    expect(lines.every((line) => line.includes(background) && line.includes(border))).toBe(true);
    expect(lines[2]).toContain(`\u001b[0m${background}`);
  });

  test("colors only the agent name and uses the mention accent when no color is configured", () => {
    const configured = new SubagentTranscriptFrame(createPane([]), theme, "explore", "#5B9BD5");
    const fallback = new SubagentTranscriptFrame(createPane([]), theme, "explore");

    expect(configured.render(40)[1]).toContain(
      "\u001b[38;2;91;155;213mexplore\u001b[39m subagent session",
    );
    expect(fallback.render(40)[1]).toContain(`${accent}explore\u001b[39m subagent session`);
  });

  test("shows the effective model after the agent-specific heading", () => {
    const frame = new SubagentTranscriptFrame(
      createPane([]),
      theme,
      "explore",
      "#5B9BD5",
      "openai-codex/gpt-5.6-luna",
    );
    const title = frame.render(64)[1] ?? "";

    expect(stripTerminalSequences(title)).toContain(
      "explore subagent session · openai-codex/gpt-5.6-luna",
    );
    expect(title).toContain("\u001b[38;2;91;155;213mexplore\u001b[39m");
    expect(title).toContain(`${muted} · openai-codex/gpt-5.6-luna\u001b[39m`);
  });

  test("keeps agent names on one row without terminal control sequences", () => {
    const frame = new SubagentTranscriptFrame(
      createPane([]),
      theme,
      "\u001b]133;A\u0007ex\nplore\tæøå",
    );
    const title = frame.render(48)[1] ?? "";

    expect(stripTerminalSequences(title)).toContain("ex plore æøå subagent session");
    expect(title).not.toContain("\u001b]133;");
    expect(title).not.toContain("\n");
    expect(title).not.toContain("\t");
    expect(visibleWidth(title)).toBe(48);
  });

  test("does not leak terminal message-boundary markers through composed overlay rows", () => {
    const link = hyperlink("source", "https://example.test/transcript");
    const frame = new SubagentTranscriptFrame(
      createPane(["\u001b]133;A\u0007", `${link}\u001b]133;B\u001b\\\u001b]133;C\u0007`]),
      theme,
      "explore",
    );

    const composed = frame
      .render(40)
      .map((line) => compositeTuiLine(".".repeat(50), line, 5, 40, 50));
    expect(composed.every((line) => !line.includes("\u001b]133;"))).toBe(true);
    for (const line of composed.slice(1, -1)) {
      const plain = stripTerminalSequences(line);
      expect(plain.startsWith(".....│")).toBe(true);
      expect(plain.endsWith("│.....")).toBe(true);
      expect(visibleWidth(line)).toBe(50);
    }
    expect(composed[3]).toContain("\u001b]8;;https://example.test/transcript");
  });

  test("keeps message backgrounds and restores the canvas after their reset", () => {
    const messageBackground = "\u001b[48;2;34;34;34m";
    const frame = new SubagentTranscriptFrame(
      createPane([`${messageBackground}message\u001b[49m canvas`]),
      theme,
      "explore",
    );

    const line = frame.render(32)[2];
    expect(line).toContain(`${messageBackground}message\u001b[49m${background} canvas`);
  });

  test("uses the nearest dark background in 256-color mode", () => {
    const frame = new SubagentTranscriptFrame(
      createPane(["content"]),
      createTheme("256color"),
      "explore",
    );
    expect(frame.render(32).every((line) => line.includes("\u001b[48;5;234m"))).toBe(true);
  });

  test("fits resized and narrow viewports without splitting wide text", () => {
    const frame = new SubagentTranscriptFrame(
      {
        render: (width) => ["Subagent session", truncateToWidth("æøå界".repeat(30), width, "")],
        invalidate() {},
      },
      theme,
      "explore",
    );

    for (const width of [80, 24, 12, 10, 4, 3, 2]) {
      const lines = frame.render(width);
      expect(lines).toHaveLength(4);
      expect(lines.every((line) => visibleWidth(line) === width)).toBe(true);
      expect(stripTerminalSequences(lines[0] ?? "")).toBe(`╭${"─".repeat(width - 2)}╮`);
      expect(stripTerminalSequences(lines.at(-1) ?? "")).toBe(`╰${"─".repeat(width - 2)}╯`);
    }
    expect(frame.render(1)).toEqual([]);
    expect(frame.render(0)).toEqual([]);
  });

  test("forwards scrolling, Escape, invalidation, and disposal to the pane", () => {
    const inputs: string[] = [];
    let invalidations = 0;
    let disposals = 0;
    const pane: Component & { dispose(): void } = {
      render: () => [],
      handleInput: (data) => inputs.push(data),
      invalidate: () => {
        invalidations += 1;
      },
      dispose: () => {
        disposals += 1;
      },
    };
    const frame = new SubagentTranscriptFrame(pane, theme, "explore");
    frame.handleInput("\u001b[5~");
    frame.handleInput("\u001b");
    frame.invalidate();
    frame.dispose();

    expect(inputs).toEqual(["\u001b[5~", "\u001b"]);
    expect(invalidations).toBe(1);
    expect(disposals).toBe(1);
  });
});
