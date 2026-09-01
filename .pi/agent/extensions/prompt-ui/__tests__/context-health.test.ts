import { describe, expect, test } from "bun:test";
import { contextHealthColor, contextIndicator } from "../context-health";

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
    expect(contextIndicator(139_800, 35)).toEqual({
      text: "139.8K (35%)",
      color: "warning",
    });
  });

  test("colors based on the displayed percentage", () => {
    expect(contextIndicator(83_500, 50.4)).toEqual({
      text: "83.5K (50%)",
      color: "warning",
    });
    expect(contextIndicator(83_500, 50.5)).toEqual({
      text: "83.5K (51%)",
      color: "error",
    });
  });

  test("uses a muted placeholder when usage is unknown", () => {
    expect(contextIndicator(null, null)).toEqual({ text: "?", color: "muted" });
  });
});
