import { describe, expect, test } from "bun:test";
import { sanitizeHeaderField } from "../sanitize";

describe("header field sanitization", () => {
  test("removes terminal sequences and normalizes unsafe controls before layout", () => {
    const value =
      "\u001b]8;;https://example.invalid\u0007linked\u001b]8;;\u0007" +
      "\u001b[31m red\u001b[0m\u001b bare\u0000\u001f\u007f\u0085\u009b" +
      "line\u2028separator\u2029end";
    const sanitized = sanitizeHeaderField(value);

    expect(() => JSON.stringify(sanitized)).not.toThrow();
    const codePoints = [...sanitized].map((character) => character.codePointAt(0) ?? 0);
    expect(
      codePoints.some(
        (codePoint) =>
          codePoint <= 0x1f ||
          (codePoint >= 0x7f && codePoint <= 0x9f) ||
          codePoint === 0x2028 ||
          codePoint === 0x2029,
      ),
    ).toBe(false);
    expect(sanitized).toContain("linked");
    expect(sanitized).toContain("line separator end");
  });

  test("bounds fields by Unicode code point without splitting Danish text", () => {
    expect(sanitizeHeaderField("æøå".repeat(40), 10)).toBe("æøåæøåæøå…");
    expect([...sanitizeHeaderField("x".repeat(200), 64)]).toHaveLength(64);
  });
});
