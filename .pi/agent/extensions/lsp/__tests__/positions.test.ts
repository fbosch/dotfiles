import { expect, test } from "bun:test";
import { fromProtocolPosition, toProtocolPosition } from "../positions";

test("converts one-based code-point columns to UTF-16 positions", () => {
  const text = "a😀b\nsecond";

  expect(toProtocolPosition(text, 1, 3)).toEqual({ line: 0, character: 3 });
  expect(fromProtocolPosition(text, { line: 0, character: 3 })).toEqual({ line: 1, column: 3 });
});

test("rejects positions outside the document", () => {
  expect(() => toProtocolPosition("value", 2, 1)).toThrow("outside the document");
  expect(() => toProtocolPosition("value", 1, 7)).toThrow("outside line 1");
});
