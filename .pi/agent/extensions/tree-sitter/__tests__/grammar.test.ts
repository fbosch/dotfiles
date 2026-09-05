import { expect, test } from "bun:test";
import { getLanguage } from "../src/grammar";
import { configForFile } from "../src/languages";
import { withParseTree } from "../src/parse-tree";

// These integration checks use real pinned artifacts; a cold cache needs network access.
const grammarCases = [
  {
    extension: ".swift",
    valid: "func greet() { helper() }\nfunc helper() {}",
    invalid: "func greet( { helper() }",
  },
  {
    extension: ".toml",
    valid: 'title = "Example"\n[owner]\nname = "Ada"',
    invalid: "title = =",
  },
  {
    extension: ".yaml",
    valid: "name: example\nitems:\n  - one\n  - two\n",
    invalid: "name: [one,",
  },
  {
    extension: ".vue",
    valid:
      '<template><button>{{ message }}</button></template>\n<script setup>const message = "hi"</script>',
    invalid: "<template><",
  },
] as const;

test("Swift symbol queries match the pinned grammar", async () => {
  const language = await getLanguage(".swift");
  if (language === null) throw new Error("Failed to load tree-sitter grammar for Swift");
  const config = configForFile("example.swift");
  if (config === null) throw new Error("Swift symbol configuration is missing");
  const source = "func greet() { helper() }\nfunc helper() {}";
  const extracted = config.extract(source, language);
  expect(extracted.warnings).toEqual([]);
  expect(extracted.symbols.map((symbol) => symbol.name)).toEqual(["greet", "helper"]);
  const greet = extracted.symbols[0];
  if (greet === undefined) throw new Error("Swift greet was not extracted");
  expect(config.findCallees(source, language, greet.range)).toEqual([{ name: "helper", line: 1 }]);
}, 120_000);

for (const { extension, valid, invalid } of grammarCases) {
  test(`loads ${extension} and parses valid and invalid samples`, async () => {
    const language = await getLanguage(extension);
    if (language === null) throw new Error(`Failed to load tree-sitter grammar for ${extension}`);

    withParseTree(valid, language, (tree) => {
      expect(tree.rootNode.hasError).toBe(false);
    });
    withParseTree(invalid, language, (tree) => {
      expect(tree.rootNode.hasError).toBe(true);
    });
  }, 120_000);
}
