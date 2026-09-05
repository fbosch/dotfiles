import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkDelimiterBalance, type LexRules } from "../src/delimiter";

const RULES = {
  clj: {
    lineComment: ";",
    blockComment: null,
    nestedBlock: false,
    backtickLongString: false,
    charLiteral: null,
  },
  janet: {
    lineComment: "#",
    blockComment: ["#|", "|#"],
    nestedBlock: false,
    backtickLongString: true,
    charLiteral: null,
  },
  scm: {
    lineComment: ";",
    blockComment: ["#|", "|#"],
    nestedBlock: true,
    backtickLongString: false,
    charLiteral: null,
  },
  el: {
    lineComment: ";",
    blockComment: null,
    nestedBlock: false,
    backtickLongString: false,
    charLiteral: "?",
  },
} satisfies Record<string, LexRules>;

type TestLanguage = keyof typeof RULES;

function check(source: string, language: TestLanguage): string | null {
  return checkDelimiterBalance(`test.${language}`, source, RULES[language]);
}

describe("delimiter balance scanner", () => {
  it("passes balanced Clojure forms", () => {
    assert.equal(check("(defn f [x] (+ x 1))", "clj"), null);
    assert.equal(check("(let [x 1 y 2] (+ x y))", "clj"), null);
  });

  it("flags unclosed paren in Clojure", () => {
    const err = check("(defn f [x]\n  (+ x 1)", "clj");
    assert(err != null);
    assert(err.includes("unclosed"));
  });

  it("flags stray closer in Clojure", () => {
    const err = check("(+ 1 2))", "clj");
    assert(err != null);
    assert(err.includes("stray"));
  });

  it("ignores parens in line comments", () => {
    assert.equal(check("(+ 1 2) ; (this is a comment)\n", "clj"), null);
  });

  it("ignores parens in strings", () => {
    assert.equal(check('(def s "a ) b { c }")', "clj"), null);
    assert.equal(check('(str "(parens in string)")', "clj"), null);
  });

  it("handles Scheme nestable block comments", () => {
    assert.equal(check("(define x 1) #| outer ( #| inner ) |# still |#", "scm"), null);
  });

  it("handles Janet backtick strings", () => {
    const src = "(def s `a long string with ( parens )`)\n(+ 1 2)";
    assert.equal(check(src, "janet"), null);
  });

  it("handles Elisp char literals", () => {
    assert.equal(check("(setq c ?\\()", "el"), null);
  });

  it("handles deep nesting", () => {
    const src = [
      "(defn f [x]",
      "  (let [y 1]",
      "    (if (> x 0)",
      "      (do (println x) (recur (dec x)))",
      "      y)))",
    ].join("\n");
    assert.equal(check(src, "clj"), null);
  });
});
