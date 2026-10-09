import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { appendDelimiterAndCorrect, parseTypoRules } from "../typo-engine";
import reference from "./fixtures/abolish-reference.json";

test("the offline oracle matches the configured Abolish revision", () => {
  const lock = JSON.parse(
    readFileSync(
      new URL("../../../../../.config/nvim/nvim-pack-lock.json", import.meta.url),
      "utf8",
    ),
  );
  expect(lock.plugins["vim-abolish"].rev).toBe(reference.reference.revision);
});

test.each(reference.cases)("expands rules like pinned Abolish: $rules", ({ rules, expected }) => {
  expect(Object.fromEntries(parseTypoRules(rules))).toEqual(expected);
});

test("the complete shared dictionary matches pinned Abolish", () => {
  const source = readFileSync(
    new URL("../../../../../.config/fbb/data/typos.abolish", import.meta.url),
    "utf8",
  );
  expect(Object.fromEntries(parseTypoRules(source))).toEqual(reference.shared);
});

test("completed-word boundaries match pinned Abolish under default iskeyword", () => {
  const rules = parseTypoRules("teh the");
  for (const [input, expected] of Object.entries(reference.boundaries)) {
    expect(appendDelimiterAndCorrect(input, " ", rules)).toBe(expected);
  }
});
