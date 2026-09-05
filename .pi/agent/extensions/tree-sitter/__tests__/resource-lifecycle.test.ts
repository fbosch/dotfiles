import { afterEach, beforeAll, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import * as wasm from "web-tree-sitter";
import treeSitterExtension from "../index";
import * as grammar from "../src/grammar";
import { allExtensions, configForExt } from "../src/languages";
import { withParseTree } from "../src/parse-tree";

const language = {} as wasm.Language;

function createResources() {
  const disposals: string[] = [];
  const root = {
    hasError: false,
    isError: false,
    isMissing: false,
    type: "program",
    childCount: 0,
    namedChildCount: 0,
    children: [],
    startIndex: 0,
    endIndex: 1,
    startPosition: { row: 0, column: 0 },
  };
  const tree = {
    rootNode: root,
    delete: mock(() => {
      disposals.push("tree");
    }),
  } as unknown as wasm.Tree;
  const parserDelete = wasm.Parser.prototype.delete;
  const deleteParser = spyOn(wasm.Parser.prototype, "delete").mockImplementation(function (
    this: wasm.Parser,
  ) {
    disposals.push("parser");
    parserDelete.call(this);
  });
  const setLanguage = spyOn(wasm.Parser.prototype, "setLanguage").mockReturnThis();
  const parse = spyOn(wasm.Parser.prototype, "parse").mockReturnValue(tree);
  const loadGrammar = spyOn(grammar, "loadGrammar").mockResolvedValue(language);
  return {
    disposals,
    parse,
    root,
    setLanguage,
    tree,
    restore() {
      deleteParser.mockRestore();
      setLanguage.mockRestore();
      parse.mockRestore();
      loadGrammar.mockRestore();
    },
  };
}

let resources: ReturnType<typeof createResources>;
beforeAll(() => grammar.ensureParser());
beforeEach(() => {
  resources = createResources();
});
afterEach(() => resources.restore());

test("every language extractor releases its parser and tree", () => {
  const configurations = new Set(allExtensions().map(configForExt));
  for (const config of configurations) {
    if (config === null) throw new Error("Missing registered language");
    expect(config.extract("", language).symbols).toEqual([]);
  }
  expect(resources.disposals).toEqual([...configurations].flatMap(() => ["tree", "parser"]));
});

test.each(["language", "parse", "empty-tree", "consume"] as const)(
  "releases resources when %s fails",
  (failure) => {
    if (failure === "language")
      resources.setLanguage.mockImplementation(() => {
        throw new Error("language failure");
      });
    if (failure === "parse")
      resources.parse.mockImplementation(() => {
        throw new Error("parse failure");
      });
    if (failure === "empty-tree") resources.parse.mockReturnValue(null);
    expect(() =>
      withParseTree("source", language, () => {
        throw new Error("consume failure");
      }),
    ).toThrow();
    expect(resources.disposals).toEqual(failure === "consume" ? ["tree", "parser"] : ["parser"]);
  },
);

test("query success and failures release all owned WASM resources", () => {
  // Module replacement is process-scoped so the fake constructors cannot leak into other suites.
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./fixtures/query-lifecycle.ts", import.meta.url))],
    {
      encoding: "utf8",
      killSignal: "SIGKILL",
      timeout: 2_000,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
});

test.each([false, true])(
  "write validation releases resources for a syntax error: %s",
  async (hasError) => {
    resources.root.hasError = hasError;
    resources.root.isError = hasError;
    type Handler = (
      event: ToolCallEvent,
      ctx: ExtensionContext,
    ) => Promise<ToolCallEventResult | undefined>;
    let handler: Handler | undefined;
    await treeSitterExtension({
      on(event: string, callback: Handler) {
        if (event === "tool_call") handler = callback;
      },
      registerTool() {},
    } as unknown as ExtensionAPI);
    if (handler === undefined) throw new Error("Missing tool_call handler");
    const result = await handler(
      {
        type: "tool_call",
        toolCallId: "write",
        toolName: "write",
        input: { path: "example.ts", content: "?" },
      },
      { cwd: "/project", ui: { notify() {} } } as unknown as ExtensionContext,
    );
    if (hasError) expect(result).toMatchObject({ block: true });
    else expect(result).toBeUndefined();
    expect(resources.disposals).toEqual(["tree", "parser"]);
  },
);
