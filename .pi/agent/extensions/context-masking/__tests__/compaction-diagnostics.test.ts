import { expect, test } from "bun:test";
import { compactionFailureDetail, isClassifierContentFilterError } from "../compaction-diagnostics";

test("diagnostics redact credential-shaped values and remove terminal controls", () => {
  const detail = compactionFailureDetail("assessment",
    'Failed: Bearer secret-value api_key="private-value" token=private-token sk-or-v1-private\n\x1b[31m');
  expect(detail).toBe('assessment: Failed: Bearer <REDACTED> api_key="<REDACTED>" token=<REDACTED> <REDACTED>  [31m');
});

test("diagnostics bound provider text and handle non-error exceptions", () => {
  expect(compactionFailureDetail("assessment", new Error("x".repeat(1_000)))).toBe(`assessment: ${"x".repeat(500)}`);
  expect(compactionFailureDetail("assessment", { request: "private" })).toBe("assessment: Request failed");
});

test("content-filter recovery requires the exact provider status and structured refusal", () => {
  const error = 'System One API error (403): {"error":{"message":"Request blocked by content filter: [EMAIL]","code":403}}';
  expect(isClassifierContentFilterError(error)).toBe(true);
  expect(isClassifierContentFilterError(new Error(error))).toBe(true);
  for (const value of [
    error.replace("(403)", "(401)"),
    error.replace('"code":403', '"code":401'),
    error.replace("Request blocked by content filter: [EMAIL]", "Forbidden"),
    "System One API error (403): invalid JSON",
    "Request blocked by content filter: [EMAIL]",
    '{"error":{"message":"Request blocked by content filter: [EMAIL]","code":403}}',
    { message: error },
  ]) expect(isClassifierContentFilterError(value)).toBe(false);
});
