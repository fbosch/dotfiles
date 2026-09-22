import { describe, expect, test } from "bun:test";
import { readContextUsage, readContextUsageFromContext } from "../context-usage";

describe("public context usage adapter", () => {
  test("accepts known usage and preserves null after compaction", () => {
    expect(readContextUsage({ tokens: 12_000, contextWindow: 200_000, percent: 6 })).toEqual({
      tokens: 12_000,
      contextWindow: 200_000,
      percent: 6,
    });
    expect(readContextUsage({ tokens: null, contextWindow: 200_000, percent: null })).toEqual({
      tokens: null,
      contextWindow: 200_000,
      percent: null,
    });
  });

  test("falls back to the selected model window when usage is undefined", () => {
    expect(
      readContextUsageFromContext({
        getContextUsage: () => undefined,
        model: { contextWindow: 128_000 },
      }),
    ).toEqual({
      tokens: null,
      contextWindow: 128_000,
      percent: null,
    });
  });

  test("fails soft for malformed or throwing public usage", () => {
    expect(
      readContextUsageFromContext({
        getContextUsage: () => {
          throw new Error("not ready");
        },
        model: { contextWindow: 128_000 },
      }),
    ).toEqual({ tokens: null, contextWindow: 128_000, percent: null });
    expect(
      readContextUsage({ tokens: "stale", contextWindow: 128_000, percent: 1 }),
    ).toBeUndefined();
  });

  test("does not invent a window without a model or public usage", () => {
    expect(readContextUsageFromContext({ getContextUsage: () => undefined })).toBeUndefined();
  });
});
