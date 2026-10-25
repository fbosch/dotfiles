import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS, MARKER, parseSettings, placeholder, selectMasks } from "../policy";
import { sessionWith } from "./fixtures";

const settings = { protectRecentTurns: 2, minResultChars: 100 };

describe("selectMasks", () => {
  test("selects large results older than the protected turns, in order", () => {
    const { projection, resultIds } = sessionWith([
      { resultChars: 500, tool: "bash" },
      { resultChars: 50 },
      { resultChars: 500 },
      { resultChars: 500 },
      { resultChars: 500 },
    ]);
    const selected = selectMasks(projection(), settings);
    expect(selected.map((c) => c.entryId)).toEqual(resultIds.filter((_, i) => i === 0 || i === 2));
    expect(selected[0]).toMatchObject({ toolName: "bash", text: "x".repeat(500) });
  });

  test("selects nothing while the session fits in the protected window", () => {
    const { projection } = sessionWith([{ resultChars: 5_000 }, { resultChars: 5_000 }]);
    expect(selectMasks(projection(), settings)).toEqual([]);
  });

  test("keeps results containing images verbatim", () => {
    const { projection } = sessionWith([
      { resultChars: 500, image: true },
      { resultChars: 10 },
      { resultChars: 10 },
    ]);
    expect(selectMasks(projection(), settings)).toEqual([]);
  });

  test("skips results that are already masked or omitted", () => {
    const { manager, projection, resultIds } = sessionWith([
      { resultChars: 500 },
      { resultChars: 500 },
      { resultChars: 10 },
      { resultChars: 10 },
    ]);
    const [masked = "", omitted = ""] = resultIds;
    manager.appendContextEdit(masked, {
      content: [{ type: "text", text: `${MARKER} ${"y".repeat(500)}` }],
    });
    manager.appendContextEdit(omitted, null);
    expect(selectMasks(projection(), settings)).toEqual([]);
  });
});

describe("placeholder", () => {
  test("names the tool, size, and artifact path", () => {
    const text = placeholder({ entryId: "e1", toolName: "bash", text: "a\nb\nc" }, "/cache/e1.txt");
    expect(text.startsWith(MARKER)).toBe(true);
    expect(text).toContain("bash result");
    expect(text).toContain("3 lines, 5 chars");
    expect(text).toContain("/cache/e1.txt");
  });
});

describe("parseSettings", () => {
  test("defaults to disabled", () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.enabled).toBe(false);
    expect(DEFAULT_SETTINGS.prefetchRecall).toBe(false);
  });

  test("overrides individual fields", () => {
    expect(
      parseSettings({
        contextMasking: { enabled: true, prefetchRecall: true, protectRecentTurns: 5 },
      }),
    ).toEqual({
      ...DEFAULT_SETTINGS,
      enabled: true,
      prefetchRecall: true,
      protectRecentTurns: 5,
    });
  });

  test("rejects invalid values and unknown keys", () => {
    for (const contextMasking of [
      { enabled: "yes" },
      { prefetchRecall: "yes" },
      { triggerRatio: 0 },
      { triggerRatio: 1.5 },
      { protectRecentTurns: 0 },
      { minFreedRatio: 1 },
      { bogus: true },
      "on",
    ]) {
      expect(() => parseSettings({ contextMasking })).toThrow();
    }
  });
});
