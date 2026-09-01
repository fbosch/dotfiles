import { describe, expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { fitColumns, paintDockBottomEdge, paintDockRow } from "../dock-rendering";

describe("prompt dock rendering", () => {
  test("fits left and right metadata to the available width", () => {
    const line = fitColumns("model", "ctx 10%", 16);

    expect(stripTerminalSequences(line)).toBe("model    ctx 10%");
    expect(visibleWidth(line)).toBe(16);
  });

  test("renders full-width panel rails and background", () => {
    const rail = "\u001b[34m│\u001b[39m";
    const rightBorder = "\u001b[90m│\u001b[39m";
    const background = "\u001b[48;5;236m";
    const line = paintDockRow(" prompt", 12, rail, background, rightBorder);

    expect(stripTerminalSequences(line)).toBe("│ prompt   │");
    expect(visibleWidth(line)).toBe(12);
    expect(line).toContain(background);
  });

  test("restores the panel background after a selected suggestion", () => {
    const background = "\u001b[48;5;236m";
    const selected = "\u001b[48;5;44mselected\u001b[49m";
    const line = paintDockRow(selected, 12, "│", background, "│");

    expect(line).toContain(`\u001b[49m${background}`);
    expect(visibleWidth(line)).toBe(12);
  });

  test("renders a half-height bottom edge instead of a full padding row", () => {
    const line = paintDockBottomEdge(8, "▘", "▝", "\u001b[48;5;236m");

    expect(stripTerminalSequences(line)).toBe("▘▀▀▀▀▀▀▝");
    expect(line).toContain("\u001b[38;5;236m");
    expect(visibleWidth(line)).toBe(8);
  });
});
