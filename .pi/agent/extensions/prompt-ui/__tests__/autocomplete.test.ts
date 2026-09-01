import { describe, expect, test } from "bun:test";
import {
  type AutocompleteProvider,
  stripTerminalSequences,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  createAliasAutocompleteProvider,
  findBottomBorder,
  splitEditorLines,
  styleSelectedSuggestion,
  suggestionOverlayOffset,
} from "../autocomplete";

const border = (text: string) => `\u001b[90m${text}\u001b[39m`;
const borderCells = (text: string) => [...text].map(border).join("");

describe("prompt autocomplete", () => {
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

  test("fills the selected suggestion without Pi's focus marker padding", () => {
    const selected = "\u001b[36m → /ado-pbi  Fetch backlog item\u001b[39m";
    const line = styleSelectedSuggestion(
      selected,
      36,
      "\u001b[48;2;138;190;183m",
      "\u001b[38;2;30;30;36m",
    );

    expect(stripTerminalSequences(line)).toBe(" /ado-pbi  Fetch backlog item       ");
    expect(line).toContain("\u001b[48;2;138;190;183m");
    expect(line).toContain("\u001b[38;2;30;30;36m");
    expect(visibleWidth(line)).toBe(36);
  });

  test("removes leading padding from unselected suggestions while preserving styling", () => {
    const suggestion = "  model\u001b[90m  Select model\u001b[39m";

    const line = styleSelectedSuggestion(suggestion, 36, "unused", "unused");

    expect(stripTerminalSequences(line)).toBe(" model  Select model");
    expect(line).toContain("\u001b[90m");
  });

  test("offers matching agents before file suggestions", async () => {
    const provider: AutocompleteProvider = {
      getSuggestions: async () => ({
        items: [{ value: "@example.ts", label: "example.ts" }],
        prefix: "@ex",
      }),
      applyCompletion: (lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol }),
    };
    const autocomplete = createAliasAutocompleteProvider(
      provider,
      [{ name: "explore", description: "Read-only codebase explorer", color: "#80a9c8" }],
      (mention, text) => `${mention.color}:${text}`,
    );

    const suggestions = await autocomplete.getSuggestions(["ask @ex"], 0, 7, {
      signal: new AbortController().signal,
    });

    expect(suggestions).toEqual({
      prefix: "@ex",
      items: [
        {
          value: "@explore",
          label: "#80a9c8:@explore",
          description: "Agent · Read-only codebase explorer",
        },
        { value: "@example.ts", label: "example.ts" },
      ],
    });
  });
});
