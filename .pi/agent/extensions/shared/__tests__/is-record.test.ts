import { describe, expect, test } from "bun:test";
import { isRecord } from "../is-record";

describe("isRecord", () => {
  test("accepts objects and excludes arrays and null", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("object")).toBe(false);
  });
});
