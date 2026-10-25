import { describe, expect, test } from "bun:test";
import {
  CASES,
  distribution,
  fixture,
  positiveInteger,
  type Sample,
  summarize,
  verifyOutput,
} from "../diff-rendering-model";

describe("diff rendering benchmark", () => {
  test("fixtures are deterministic, distinct and cross the large-input highlighting limit", () => {
    expect(fixture("small", 0)).toEqual(fixture("small", 0));
    expect(fixture("small", 1)).not.toEqual(fixture("small", 0));
    for (const name of Object.keys(CASES) as (keyof typeof CASES)[]) {
      const input = fixture(name, 0);
      expect(input.oldContent.trimEnd().split("\n")).toHaveLength(CASES[name]);
      expect(input.newContent).toContain("æøå");
      expect(input.oldContent.length + input.newContent.length > 80_000).toBe(name === "large");
    }
  });
  test("statistics use median and nearest-rank p95", () => {
    expect(distribution([4, 1, 3, 2])).toEqual({
      count: 4,
      medianMs: 2.5,
      p95Ms: 4,
      minMs: 1,
      maxMs: 4,
    });
    expect(() => distribution([])).toThrow();
    expect(() => distribution([NaN])).toThrow();
  });
  test("run counts reject malformed and unbounded numeric values", () => {
    expect(positiveInteger(undefined, 3)).toBe(3);
    expect(positiveInteger("2", 3)).toBe(2);
    for (const value of ["0", "-1", "1.5", "2oops", "Infinity", "9007199254740992"]) {
      expect(() => positiveInteger(value, 3)).toThrow();
    }
  });
  test("output checks every source line after stripping styles", () => {
    const input = fixture("small", 0);
    const output = `\x1b[31m${input.oldContent}\x1b[32m${input.newContent}`;
    expect(() => verifyOutput(output, input.oldContent, input.newContent)).not.toThrow();
    expect(() =>
      verifyOutput(output.replace("new_00000_0011", "missing"), input.oldContent, input.newContent),
    ).toThrow();
  });
  test("summaries keep engines, layouts and cache phases separate", () => {
    const base: Sample = {
      engine: "delta",
      caseName: "small",
      layout: "inline",
      trial: 1,
      phase: "first-render",
      iteration: 0,
      durationMs: 2,
      outputBytes: 100,
      outputHash: "fixture",
      archimedesHighlightEligible: true,
    };
    const rows = summarize([
      base,
      { ...base, engine: "archimedes", durationMs: 8 },
      { ...base, phase: "warm-repeat", durationMs: 1 },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.medianMs).toBe(2);
  });
});
