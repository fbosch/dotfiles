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

test("color caching preserves foreground/background values, validates input and handles palette churn", () => {
  for (let i = 0; i < 300; i++) {
    const hex = `#${i.toString(16).padStart(6, "0")}`;
    expect(color(hex)).toBe(`\u001b[38;2;0;${i >> 8};${i & 255}m`);
  }
  for (let i = 0; i < 3; i++) {
    expect(color("#A1b2C3")).toBe("\u001b[38;2;161;178;195m");
    expect(color("#A1b2C3", true)).toBe("\u001b[48;2;161;178;195m");
  }
  for (const invalid of ["red", "#123", "#123456\n", "#123456\u001b[0m"]) {
    expect(() => color(invalid)).toThrow("Invalid syntax color");
  }
});

test("fitting styled cells preserve text, resets and full-width padding", () => {
  const body = `${color("#BBBBBB")}æøå 中文😀e\u0301${RESET}`;
  const rows = diffCell(body, "+", 7, 40, 2);
  expect(rows).toHaveLength(1);
  expect(stripVTControlCharacters(rows[0] ?? "")).toStartWith("▌ 7+ │ æøå 中文😀e\u0301");
  expect(rows[0]).toContain(RESET + color(lineBackground("+"), true));
  expect(rows[0]).toEndWith(RESET);
});

test("multiline cells preserve CRLF row boundaries and use continuation gutters", () => {
  const rows = diffCell(`${color("#BBBBBB")}før\r\nefter${RESET}`, "-", 7, 40, 2);
  expect(rows).toHaveLength(2);
  expect(stripVTControlCharacters(rows[0] ?? "")).toStartWith("▌ 7- │ før");
  expect(stripVTControlCharacters(rows[1] ?? "")).toStartWith("▌    │ efter");
});
