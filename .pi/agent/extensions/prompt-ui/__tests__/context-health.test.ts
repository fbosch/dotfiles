import { describe, expect, test } from "bun:test";
import { contextHealthColor } from "../context-health";

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
