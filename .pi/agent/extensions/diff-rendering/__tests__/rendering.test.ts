import { expect, test } from "bun:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { theme } from "@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { applyDiffTheme, diffComponent, renderDiffLines } from "../rendering";
import { type DiffDetails, sourceLinesForRender } from "../shared";

initTheme("dark", false);

const details: DiffDetails = {
  display: "inline",
  noChanges: false,
  output: `\u001b[38;2;187;187;187mæøå 中文😀 ${"long line ".repeat(12)}\u001b[0m`,
  scope: "test",
  width: 120,
};

function expected(width: number): string[] {
  return renderDiffLines(sourceLinesForRender(applyDiffTheme(details.output, theme)), width);
}

test("diff output reuses wrapped rows at the same terminal width", () => {
  const component = diffComponent(details, true, theme);
  const first = component.render(40);
  expect(first).toEqual(expected(40));
  expect(component.render(40)).toBe(first);
});

test("diff output recomputes wrapping after resize and explicit invalidation", () => {
  const component = diffComponent(details, true, theme);
  const wide = component.render(120);
  const narrow = component.render(40);
  expect(narrow).toEqual(expected(40));
  expect(narrow.length).toBeGreaterThan(wide.length);
  expect(component.render(40)).toBe(narrow);
  component.invalidate();
  const refreshed = component.render(40);
  expect(refreshed).toEqual(narrow);
  expect(refreshed).not.toBe(narrow);
  expect(component.render(120)).toEqual(wide);
});

test("empty diff output can reuse and invalidate an empty row buffer", () => {
  const component = diffComponent({ ...details, noChanges: true }, true, theme);
  const first = component.render(40);
  expect(first).toEqual([]);
  expect(component.render(40)).toBe(first);
  component.invalidate();
  expect(component.render(40)).toEqual([]);
});
