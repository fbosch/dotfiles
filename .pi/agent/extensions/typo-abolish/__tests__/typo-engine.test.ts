import { expect, test } from "bun:test";
import { appendDelimiterAndCorrect, parseTypoRules } from "../typo-engine";

test("uses Neovim keyword boundaries rather than ASCII or apostrophe boundaries", () => {
  const rules = parseTypoRules("teh the\næblet æble\n1stt 1st\n_foo _bar");
  for (const [input, expected] of [
    ["'teh", "'the "],
    ["æteh", "æteh "],
    ["øteh", "øteh "],
    ["åteh", "åteh "],
    ["λteh", "λteh "],
    ["æblet", "æble "],
    ["1stt", "1st "],
    ["_foo", "_bar "],
  ] as const) {
    expect(appendDelimiterAndCorrect(input, " ", rules)).toBe(expected);
  }
});

test("preserves trailing underscores in Abolish mixed-case variants", () => {
  expect([...parseTypoRules("foo_ bar_")]).toEqual([
    ["Foo_", "Bar_"],
    ["foo_", "bar_"],
    ["FOO_", "BAR_"],
  ]);
});

test.each([
  "missing_replacement",
  "f{unct{ino,oin},ucntion} function",
  "te{h the",
  "teh th}e",
  "cant' can't",
  "{} the",
  "teh the{}",
])("rejects unsupported or malformed rules with their line number: %s", (rule) => {
  expect(() => parseTypoRules(`# rules\n\n${rule}`)).toThrow(/line 3/i);
});
