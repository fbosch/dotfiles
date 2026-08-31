import { describe, expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import {
  findBottomBorder,
  fitColumns,
  paintDockBottomEdge,
  paintDockRow,
  splitEditorLines,
  styleSelectedSuggestion,
  suggestionOverlayOffset,
} from "../prompt-ui";

const border = (text: string) => `\u001b[90m${text}\u001b[39m`;
const borderCells = (text: string) => [...text].map(border).join("");

describe("prompt UI layout", () => {
  test("finds the editor border before appended suggestions", () => {
    const lines = [borderCells("────"), "text", borderCells("────"), "first", "second"];

    expect(findBottomBorder(lines, border)).toBe(2);
  });

  test("does not treat styled editor content as a border", () => {
    const content = "\u001b[7m────\u001b[0m";
    const lines = [border("────"), content, border("────"), "suggestion"];

    expect(findBottomBorder(lines, border)).toBe(2);
  });

  test("moves only autocomplete suggestions above the dock", () => {
    const lines = [borderCells("────"), "text", borderCells("────"), "first", "second"];

    expect(splitEditorLines(lines, border)).toEqual({
      content: ["text"],
      suggestions: ["first", "second"],
    });
  });

  test("anchors autocomplete above the dock and its top padding", () => {
    expect(suggestionOverlayOffset(3)).toBe(-4);
  });

  test("preserves editor scroll indicators without their decorative rule", () => {
    const lines = [border("─── ↑ 2 more ─"), "text", border("─── ↓ 3 more ─"), "suggestion"];

    expect(splitEditorLines(lines, border)).toEqual({
      content: ["↑ 2 more", "text", "↓ 3 more"],
      suggestions: ["suggestion"],
    });
  });

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

  test("fills the selected suggestion and replaces Pi's focus arrow with spacing", () => {
    const selected = "\u001b[36m → /ado-pbi  Fetch backlog item\u001b[39m";
    const line = styleSelectedSuggestion(
      selected,
      36,
      "\u001b[48;2;138;190;183m",
      "\u001b[38;2;30;30;36m",
    );

    expect(stripTerminalSequences(line)).toBe("   /ado-pbi  Fetch backlog item     ");
    expect(line).toContain("\u001b[48;2;138;190;183m");
    expect(line).toContain("\u001b[38;2;30;30;36m");
    expect(visibleWidth(line)).toBe(36);
  });
});
