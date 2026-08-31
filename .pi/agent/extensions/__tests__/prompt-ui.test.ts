import { describe, expect, test } from "bun:test";
import { findBottomBorder } from "../prompt-ui";

const border = (text: string) => `\u001b[90m${text}\u001b[39m`;

describe("prompt UI layout", () => {
  test("finds the editor border before appended suggestions", () => {
    const lines = [border("────"), "text", border("────"), "first", "second"];

    expect(findBottomBorder(lines, border)).toBe(2);
  });

  test("does not treat styled editor content as a border", () => {
    const content = "\u001b[7m────\u001b[0m";
    const lines = [border("────"), content, border("────"), "suggestion"];

    expect(findBottomBorder(lines, border)).toBe(2);
  });
});
