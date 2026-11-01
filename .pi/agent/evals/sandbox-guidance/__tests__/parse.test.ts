import { expect, test } from "bun:test";
import { parseEvidence } from "../replay";

test("malformed evidence names its source and never becomes a passing empty result", () => {
  expect(() => parseEvidence("{", "attempt.json")).toThrow(
    "Invalid JSON in evaluation evidence: attempt.json",
  );
  expect(parseEvidence('{"ok":true}', "attempt.json")).toEqual({ ok: true });
});
