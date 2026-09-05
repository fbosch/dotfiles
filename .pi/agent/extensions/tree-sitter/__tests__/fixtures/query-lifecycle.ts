import { mock } from "bun:test";
import { deepEqual, ok } from "node:assert/strict";
import type { Language } from "web-tree-sitter";

let failure: "none" | "parse" | "matches" = "none";
const disposals: string[] = [];

mock.module("web-tree-sitter", () => ({
  Parser: class {
    setLanguage() {}
    parse() {
      if (failure === "parse") throw new Error("parse failed");
      return {
        rootNode: {},
        delete() {
          disposals.push("tree");
        },
      };
    }
    delete() {
      disposals.push("parser");
    }
  },
  Query: class {
    matches() {
      if (failure === "matches") throw new Error("query failed");
      return [
        {
          captures: [
            { name: "callee", node: { startIndex: 0, endIndex: 4, startPosition: { row: 0 } } },
          ],
        },
      ];
    }
    delete() {
      disposals.push("query");
    }
  },
}));

const { configForExt } = await import("../../src/languages");
const config = configForExt(".ts");
ok(config);
for (const mode of ["none", "parse", "matches"] as const) {
  failure = mode;
  disposals.length = 0;
  const result = config.findCallees("call()", {} as Language, {
    startByte: 0,
    endByte: 6,
    startLine: 1,
    endLine: 1,
  });
  deepEqual(result, mode === "none" ? [{ name: "call", line: 1 }] : []);
  deepEqual(disposals, mode === "parse" ? ["parser", "query"] : ["tree", "parser", "query"]);
}
