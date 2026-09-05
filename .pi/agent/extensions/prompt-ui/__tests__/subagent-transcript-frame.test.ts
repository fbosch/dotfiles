import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { SubagentTranscriptFrame } from "../subagent-transcript-frame";

const background = "\u001b[48;2;25;25;25m";
const border = "\u001b[38;2;187;187;187m";
function createTheme(mode: ReturnType<Theme["getColorMode"]> = "truecolor"): Theme {
  return {
    fg: (color: string, text: string) => {
      expect(color).toBe("borderAccent");
      return `${border}${text}\u001b[39m`;
    },
    getColorMode: () => mode,
  } as Theme;
}
const theme = createTheme();

describe("subagent transcript frame", () => {
  test("frames and paints the pane while reserving horizontal padding", () => {
    let contentWidth = 0;
    const frame = new SubagentTranscriptFrame(
      {
        render: (width) => {
          contentWidth = width;
          return ["first\u001b[0m line", ""];
        },
        invalidate() {},
      },
      theme,
    );

    const lines = frame.render(20);
    expect(contentWidth).toBe(16);
    expect(lines.map(stripTerminalSequences)).toEqual([
      `╭${"─".repeat(18)}╮`,
      `│ first line${" ".repeat(7)}│`,
      `│${" ".repeat(18)}│`,
      `╰${"─".repeat(18)}╯`,
    ]);
    expect(lines.every((line) => visibleWidth(line) === 20)).toBe(true);
    expect(lines.every((line) => line.includes(background) && line.includes(border))).toBe(true);
    expect(lines[1]).toContain(`\u001b[0m${background}`);
  });

  test("keeps message backgrounds and restores the canvas after their reset", () => {
    const messageBackground = "\u001b[48;2;34;34;34m";
    const frame = new SubagentTranscriptFrame(
      {
        render: () => [`${messageBackground}message\u001b[49m canvas`],
        invalidate() {},
      },
      theme,
    );

    const line = frame.render(24)[1];
    expect(line).toContain(`${messageBackground}message\u001b[49m${background} canvas`);
  });

  test("uses the nearest dark background in 256-color mode", () => {
    const frame = new SubagentTranscriptFrame(
      { render: () => ["content"], invalidate() {} },
      createTheme("256color"),
    );

    expect(frame.render(20).every((line) => line.includes("\u001b[48;5;234m"))).toBe(true);
  });

  test("fits resized and narrow viewports without splitting wide text", () => {
    const frame = new SubagentTranscriptFrame(
      {
        render: (width) => [truncateToWidth("æøå界".repeat(30), width, "")],
        invalidate() {},
      },
      theme,
    );

    for (const width of [80, 24, 12, 10, 4, 3, 2]) {
      const lines = frame.render(width);
      expect(lines).toHaveLength(3);
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
    const frame = new SubagentTranscriptFrame(pane, theme);
    frame.handleInput("\u001b[5~");
    frame.handleInput("\u001b");
    frame.invalidate();
    frame.dispose();

    expect(inputs).toEqual(["\u001b[5~", "\u001b"]);
    expect(invalidations).toBe(1);
    expect(disposals).toBe(1);
  });
});
