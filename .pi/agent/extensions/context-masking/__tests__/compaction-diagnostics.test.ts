import { expect, test } from "bun:test";
import { compactionFailureDetail } from "../compaction-diagnostics";

test("diagnostics redact credential-shaped values and remove terminal controls", () => {
  const detail = compactionFailureDetail("assessment",
    'Failed: Bearer secret-value api_key="private-value" token=private-token sk-or-v1-private\n\x1b[31m');
  expect(detail).toBe('assessment: Failed: Bearer <REDACTED> api_key="<REDACTED>" token=<REDACTED> <REDACTED>  [31m');
});

test("diagnostics bound provider text and handle non-error exceptions", () => {
  expect(compactionFailureDetail("assessment", new Error("x".repeat(1_000)))).toBe(`assessment: ${"x".repeat(500)}`);
  expect(compactionFailureDetail("assessment", { request: "private" })).toBe("assessment: Request failed");
});
