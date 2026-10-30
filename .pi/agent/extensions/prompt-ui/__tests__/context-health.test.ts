import { describe, expect, test } from "bun:test";
import {
  cacheIndicator,
  contextHealthColor,
  contextIndicator,
  freedTokenIndicator,
} from "../context-health";

describe("context health color", () => {
  test("uses success through 25 percent", () => {
    expect(contextHealthColor(0)).toBe("success");
    expect(contextHealthColor(25)).toBe("success");
  });

  test("uses warning from 26 through 50 percent", () => {
    expect(contextHealthColor(26)).toBe("warning");
    expect(contextHealthColor(50)).toBe("warning");
  });

  test("uses error above 50 percent", () => {
    expect(contextHealthColor(51)).toBe("error");
    expect(contextHealthColor(100)).toBe("error");
  });
});

describe("context indicator", () => {
  test("matches OpenCode compact token usage", () => {
    expect(contextIndicator(139_800, 35, false)).toEqual({
      text: "139.8K (35%)",
      color: "warning",
    });
  });

  test("colors based on the displayed percentage", () => {
    expect(contextIndicator(83_500, 50.4, false)).toEqual({
      text: "83.5K (50%)",
      color: "warning",
    });
    expect(contextIndicator(83_500, 50.5, false)).toEqual({
      text: "83.5K (51%)",
      color: "error",
    });
  });

  test("uses a muted placeholder when usage is unknown", () => {
    expect(contextIndicator(null, null, false)).toEqual({ text: "?", color: "muted" });
  });

  test("marks estimates without implying a known count after compaction", () => {
    expect(contextIndicator(20_000, 10, true)).toEqual({ text: "~20K (10%)", color: "success" });
    expect(contextIndicator(null, null, true)).toEqual({ text: "?", color: "muted" });
  });
});

describe("freed token indicator", () => {
  test("uses compact approximate token savings", () => {
    expect(freedTokenIndicator(42_000)).toBe("󰈉 ~42K");
    expect(freedTokenIndicator(1_234)).toBe("󰈉 ~1.2K");
    expect(freedTokenIndicator(450)).toBe("󰈉 ~450");
  });

  test("hides the badge when there is no net reduction", () => {
    expect(freedTokenIndicator(0)).toBe("");
    expect(freedTokenIndicator(-10)).toBe("");
  });
});

describe("cache indicator", () => {
  test.each([
    { percent: 0, displayed: 0, color: "error" },
    { percent: 49.4, displayed: 49, color: "error" },
    { percent: 49.5, displayed: 50, color: "warning" },
    { percent: 50, displayed: 50, color: "warning" },
    { percent: 89, displayed: 89, color: "warning" },
    { percent: 89.5, displayed: 90, color: "muted" },
    { percent: 90, displayed: 90, color: "muted" },
    { percent: 100, displayed: 100, color: "muted" },
  ])("colors $displayed% as $color", ({ percent, displayed, color }) => {
    expect(cacheIndicator(percent)).toEqual({ text: `󰆼 ${displayed}%`, color });
  });

  test("hides the badge when usage is unknown", () => {
    expect(cacheIndicator(undefined)).toEqual({ text: "", color: "muted" });
  });
});
