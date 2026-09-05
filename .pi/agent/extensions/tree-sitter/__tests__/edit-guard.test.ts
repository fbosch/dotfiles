/**
 * Tests for the pre-write edit simulation (src/edit-guard.ts).
 *
 * The content simulation runs pi core's own edit execute with file
 * operations redirected to memory, so these tests double as integration
 * guards: if pi's matching behavior changes, they fail loudly.
 *
 * Regression guards for: prefix-matching oldText (an oldText that ends with
 * fewer closing delimiters than the file line has) leaving trailing
 * characters in the result, BOM/CRLF normalization, fuzzy matching, and
 * pass-through for edits the tool itself would reject.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EditToolInput, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describePrefixLeftover, findPrefixLeftover, simulateEditContent } from "../src/edit-guard";

const FILE = `(ns guard-repro
  (:require [clojure.test :as t]))

(deftest test-tool-read-with-limit
  (let [all (f)]
    (t/is (map? all))
    (t/is (contains? all "read"))
    (t/is (contains? all "bash"))))
`;

// The tool's execute ignores ctx (file operations are overridden) — a dummy
// value is enough for the test.
const FAKE_CTX = {} as ExtensionContext;

async function simulate(rawContent: string, edits: EditToolInput["edits"]): Promise<string | null> {
  return simulateEditContent(rawContent, "repro.clj", edits, "/tmp", FAKE_CTX);
}

describe("edit simulation", () => {
  it("applies a byte-exact edit", async () => {
    const content = await simulate(FILE, [
      { oldText: `    (t/is (map? all))`, newText: `    (t/is (map? all) true)` },
    ]);
    assert(content !== null);
    assert(content.includes(`(t/is (map? all) true)`));
    assert.equal(
      findPrefixLeftover(FILE, [
        { oldText: `    (t/is (map? all))`, newText: `    (t/is (map? all) true)` },
      ]),
      undefined,
    );
  });

  it("detects a prefix match that leaves closing delimiters (ticket repro)", async () => {
    // oldText ends with 2 parens; the file line has 4 — the match is a prefix
    const edits = [
      {
        oldText: `    (t/is (contains? all "bash"))`,
        newText: `    (t/is (contains? all "bash"))  ; tuned`,
      },
    ];
    const content = await simulate(FILE, edits);
    assert(content !== null);
    assert(content.includes(`  ; tuned))`), "leftover parens remain after the replacement");
    const leftover = findPrefixLeftover(FILE, edits);
    assert(leftover);
    assert.equal(leftover.editIndex, 0);
    assert.equal(leftover.line, 8);
    assert.equal(leftover.leftover, "))");
    assert(describePrefixLeftover(leftover).includes("edit #1"));
    assert(describePrefixLeftover(leftover).includes("line 8"));
  });

  it("does not flag a mid-token substring match", async () => {
    const edits = [{ oldText: `"bash"`, newText: `"bush"` }];
    const content = await simulate(FILE, edits);
    assert(content !== null);
    assert(content.includes(`(t/is (contains? all "bush"))))`));
    assert.equal(findPrefixLeftover(FILE, edits), undefined);
  });

  it("does not flag a match that ends exactly at the line end", async () => {
    const edits = [
      {
        oldText: `    (t/is (contains? all "bash"))))`,
        newText: `    (t/is (contains? all "bash"))  ; tuned`,
      },
    ];
    assert((await simulate(FILE, edits)) !== null);
    assert.equal(findPrefixLeftover(FILE, edits), undefined);
  });

  it("returns null when oldText is not found", async () => {
    assert.equal(await simulate(FILE, [{ oldText: "no such text", newText: "x" }]), null);
  });

  it("returns null when oldText is empty", async () => {
    assert.equal(await simulate(FILE, [{ oldText: "", newText: "x" }]), null);
  });

  it("returns null when oldText is not unique", async () => {
    assert.equal(await simulate(FILE, [{ oldText: "all", newText: "x" }]), null);
  });

  it("returns null when edits overlap", async () => {
    assert.equal(
      await simulate(FILE, [
        { oldText: `(t/is (map? all))`, newText: "(a)" },
        { oldText: `(map? all))`, newText: "(b)" },
      ]),
      null,
    );
  });

  it("returns null when any edit in a batch is not found", async () => {
    assert.equal(
      await simulate(FILE, [
        { oldText: `(t/is (map? all))`, newText: "(a)" },
        { oldText: "missing", newText: "(b)" },
      ]),
      null,
    );
  });

  it("returns null when the replacement would not change the content", async () => {
    assert.equal(
      await simulate(FILE, [{ oldText: `(t/is (map? all))`, newText: `(t/is (map? all))` }]),
      null,
    );
  });

  it("matches oldText with LF newlines against a CRLF file and restores endings", async () => {
    const crlf = FILE.replace(/\n/g, "\r\n");
    const content = await simulate(crlf, [
      { oldText: `(t/is (map? all))`, newText: `(t/is (map? all) true)` },
    ]);
    assert(content !== null);
    assert(content.includes(`(t/is (map? all) true)`));
    assert(content.includes("\r\n"));
    assert(!/[^\r]\n/.test(content), "line endings restored to CRLF");
  });

  it("strips a UTF-8 BOM before matching and preserves it in the result", async () => {
    const content = await simulate(`\uFEFF${FILE}`, [
      { oldText: "(ns guard-repro", newText: "(ns guard-repro2" },
    ]);
    assert(content !== null);
    assert(content.startsWith("\uFEFF"));
    assert(content.includes("(ns guard-repro2"));
  });

  it("falls back to fuzzy matching for trailing whitespace in oldText", async () => {
    // File line carries trailing whitespace; oldText includes it, newText strips it.
    const withWs = FILE.replace("    (t/is (map? all))", "    (t/is (map? all))  ");
    const content = await simulate(withWs, [
      { oldText: `    (t/is (map? all))  `, newText: `    (t/is (map? all))` },
    ]);
    assert(content !== null);
    assert(content.includes(`    (t/is (map? all))\n`));
    assert(!content.includes(`    (t/is (map? all))  \n`), "trailing whitespace removed");
  });

  it("returns null for a fuzzy no-op edit", async () => {
    // oldText has trailing whitespace the file doesn't have: fuzzy match,
    // but nothing would change — the tool reports "No changes made".
    assert.equal(
      await simulate(FILE, [
        { oldText: `    (t/is (map? all))  `, newText: `    (t/is (map? all))` },
      ]),
      null,
    );
  });

  it("reports the correct edit index in a multi-edit call", async () => {
    // First edit is clean; second is the prefix match.
    const edits = [
      { oldText: `(t/is (map? all))`, newText: `(t/is (map? all) true)` },
      {
        oldText: `    (t/is (contains? all "bash"))`,
        newText: `    (t/is (contains? all "bash"))  ; tuned`,
      },
    ];
    assert((await simulate(FILE, edits)) !== null);
    const leftover = findPrefixLeftover(FILE, edits);
    assert(leftover);
    assert.equal(leftover.editIndex, 1);
    assert(describePrefixLeftover(leftover).includes("edit #2"));
  });

  it("detects prefix leftovers for fuzzy-matched oldText", () => {
    // oldText carries trailing whitespace, so the finder must use the same
    // fuzzy matching space as the tool.
    const withWs = FILE.replace("    (t/is (map? all))", "    (t/is (map? all))  ");
    const edits = [
      {
        oldText: `    (t/is (contains? all "bash"))  `,
        newText: `    (t/is (contains? all "bash"))  ; tuned`,
      },
    ];
    const leftover = findPrefixLeftover(withWs, edits);
    assert(leftover);
    assert.equal(leftover.line, 8);
    assert.equal(leftover.leftover, "))");
  });

  it("truncates long leftovers in the diagnosis message", () => {
    const longLine = FILE.replace(
      '    (t/is (contains? all "bash"))))',
      `    (t/is (contains? all "bash"))${")".repeat(60)}`,
    );
    const edits = [
      {
        oldText: `    (t/is (contains? all "bash"))`,
        newText: `    (t/is (contains? all "bash"))  ; tuned`,
      },
    ];
    const leftover = findPrefixLeftover(longLine, edits);
    assert(leftover);
    const msg = describePrefixLeftover(leftover);
    assert(msg.includes("\u2026"), "long leftover truncated");
    assert(msg.includes("60 character(s)"));
  });

  it("applies multiple disjoint edits regardless of input order", async () => {
    // Input order is the reverse of positional order — application must sort
    // by position or the earlier shifts corrupt later offsets.
    const content = await simulate(FILE, [
      { oldText: `(t/is (contains? all "bash"))))`, newText: `(t/is (contains? all "sh"))))` },
      { oldText: `(t/is (map? all))`, newText: `(t/is (map? all) true)` },
      { oldText: `(let [all (f)]`, newText: `(let [all (g)]` },
    ]);
    assert(content !== null);
    assert(content.includes(`(let [all (g)]`));
    assert(content.includes(`(t/is (map? all) true)`));
    assert(content.includes(`(t/is (contains? all "sh"))))`));
    assert(!content.includes(`"read"))(`), "no index-shifted garbage");
  });

  it("applies multiple disjoint edits", async () => {
    const content = await simulate(FILE, [
      { oldText: `(t/is (map? all))`, newText: "(t/is (seq? all))" },
      { oldText: `(t/is (contains? all "read"))`, newText: `(t/is (contains? all "write"))` },
    ]);
    assert(content !== null);
    assert(content.includes(`(t/is (seq? all))`));
    assert(content.includes(`(t/is (contains? all "write"))`));
    assert(content.includes(`(t/is (contains? all "bash"))))`));
  });
});
