import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { appendDelimiterAndCorrect, parseTypoRules } from "../typo-engine";

const source = readFileSync(
  new URL("../../../../../.config/fbb/data/typos.abolish", import.meta.url),
  "utf8",
);
const corrections = [
  ["comparision", "comparison"],
  ["comparisno", "comparison"],
  ["comparisons", "comparisons"],
  ["depenedencies", "dependencies"],
  ["dependancies", "dependencies"],
  ["dependencyes", "dependencies"],
  ["functino", "function"],
  ["functoin", "function"],
  ["fucntion", "function"],
  ["identifer", "identifier"],
  ["identifers", "identifiers"],
  ["persistance", "persistence"],
  ["recieve", "receive"],
  ["recieved", "received"],
  ["recieving", "receiving"],
  ["seperate", "separate"],
  ["seprate", "separate"],
  ["seerate", "separate"],
  ["perfomance", "performance"],
  ["performace", "performance"],
  ["perofmrance", "performance"],
  ["perofrmance", "performance"],
  ["repsonse", "response"],
  ["respose", "response"],
  ["resposnse", "response"],
  ["commmand", "command"],
  ["commmands", "commands"],
  ["everythign", "everything"],
] as const;

test("shared rules compile and every replacement is stable", () => {
  const rules = parseTypoRules(source);
  for (const replacement of rules.values()) {
    expect(appendDelimiterAndCorrect(replacement, "", rules)).toBe(replacement);
  }
});

test("shared rules correct known typos without corrupting their canonical spellings", () => {
  const rules = parseTypoRules(source);
  for (const [typo, canonical] of corrections) {
    for (const transform of [
      (word: string) => word,
      (word: string) => word.slice(0, 1).toUpperCase() + word.slice(1),
      (word: string) => word.toUpperCase(),
    ]) {
      expect(appendDelimiterAndCorrect(transform(typo), " ", rules)).toBe(
        `${transform(canonical)} `,
      );
      expect(appendDelimiterAndCorrect(transform(canonical), " ", rules)).toBe(
        `${transform(canonical)} `,
      );
    }
  }
});
