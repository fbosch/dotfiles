import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import {
  color,
  diffAnnotation,
  diffCell,
  hunkSeparator,
  lineBackground,
  RESET,
} from "../presentation";

test("hunk separators and ellipsis annotations fill the code background to the full width", () => {
  const background = color(lineBackground(" "), true);
  for (const width of [40, 120, 180]) {
    for (const row of [
      hunkSeparator(width),
      hunkSeparator(width, 30),
      diffAnnotation("...", width),
    ]) {
      expect(row).toStartWith(background);
      expect(stripVTControlCharacters(row).length).toBe(width);
      expect(row).toEndWith(RESET);
    }
    expect(diffCell("context", " ", 1, width, 2)[0]).toStartWith(background);
  }
});
