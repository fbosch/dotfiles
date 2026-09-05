import { expect, test } from "bun:test";
import { getLanguage } from "../src/grammar";
import { configForFile } from "../src/languages";

// Exercise the pinned WASM, not a parser mock. A cold grammar cache needs network access.
test("loads Lua and extracts local/global functions and their callees", async () => {
  const language = await getLanguage(".lua");
  if (language === null) throw new Error("Failed to load tree-sitter grammar for Lua");
  const config = configForFile("example.lua");
  if (config === null) throw new Error("Lua symbol configuration is missing");

  const source = [
    "local function helper(value)",
    "  return tostring(value)",
    "end",
    "function greet(value)",
    "  return helper(value)",
    "end",
  ].join("\n");
  const result = config.extract(source, language);

  expect(result.warnings).toEqual([]);
  expect(result.symbols).toMatchObject([
    {
      kind: "function",
      name: "helper",
      signature: "local function helper(value)",
      isExported: false,
      range: { startLine: 1, endLine: 3 },
    },
    {
      kind: "function",
      name: "greet",
      signature: "function greet(value)",
      isExported: true,
      range: { startLine: 4, endLine: 6 },
    },
  ]);
  expect(
    result.symbols.map((symbol) => source.slice(symbol.range.startByte, symbol.range.endByte)),
  ).toEqual([source.split("\n").slice(0, 3).join("\n"), source.split("\n").slice(3).join("\n")]);
  expect(
    result.symbols.map((symbol) => config.findCallees(source, language, symbol.range)),
  ).toEqual([[{ name: "tostring", line: 2 }], [{ name: "helper", line: 5 }]]);
}, 120_000);

test("Lua callees include dotted and colon calls without comments or string matches", async () => {
  const language = await getLanguage(".lua");
  if (language === null) throw new Error("Failed to load tree-sitter grammar for Lua");
  const config = configForFile("example.lua");
  if (config === null) throw new Error("Lua symbol configuration is missing");
  const source = [
    "local function caller()",
    "  helper()",
    "  M.target()",
    "  vim.api.nvim_buf_set_lines(0, 0, -1, false, {})",
    "  object:method()",
    '  local text = "ignored.call()"',
    "  -- ignored:method()",
    "end",
    "outside()",
  ].join("\n");
  const extracted = config.extract(source, language);
  expect(extracted.warnings).toEqual([]);
  const symbol = extracted.symbols[0];
  if (symbol === undefined) throw new Error("Lua caller was not extracted");
  expect(config.findCallees(source, language, symbol.range)).toEqual([
    { name: "helper", line: 2 },
    { name: "M.target", line: 3 },
    { name: "vim.api.nvim_buf_set_lines", line: 4 },
    { name: "object:method", line: 5 },
  ]);
}, 120_000);
