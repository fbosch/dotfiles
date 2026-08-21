import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { answerRequestLimits, normalizeAssistantResponse } from "../index.js";

describe("assistant response normalization", () => {
  test("retains only final non-synthetic text parts", () => {
    const result = normalizeAssistantResponse([
      { type: "reasoning", text: "private reasoning" },
      { type: "text", text: " First answer. " },
      { type: "tool", state: { output: "tool output" } },
      { type: "text", text: "ignored", ignored: true },
      { type: "text", text: "synthetic", synthetic: true },
      { type: "text", text: "Second answer." },
      { type: "file", url: "data:text/plain,provider-data" },
    ]);

    assert.deepEqual(result, {
      ok: true,
      answer: "First answer. \nSecond answer.",
      truncated: false,
    });
  });

  test("rejects empty and malformed final text", () => {
    assert.deepEqual(normalizeAssistantResponse([{ type: "reasoning", text: "hidden" }]), {
      ok: false,
      code: "empty_response",
    });
    assert.deepEqual(normalizeAssistantResponse([{ type: "text", text: "   " }]), {
      ok: false,
      code: "empty_response",
    });
    assert.deepEqual(normalizeAssistantResponse([{ type: "text", text: 42 }]), {
      ok: false,
      code: "provider_failed",
    });
    assert.deepEqual(normalizeAssistantResponse({ parts: [] }), {
      ok: false,
      code: "provider_failed",
    });
  });

  test("bounds UTF-8 output without splitting a code point", () => {
    const oversized = `${"a".repeat(answerRequestLimits.responseBytes - 1)}😀`;
    const result = normalizeAssistantResponse([{ type: "text", text: oversized }]);

    if (result.ok === false) assert.fail(`normalization failed: ${result.code}`);
    assert.equal(result.truncated, true);
    assert.ok(Buffer.byteLength(result.answer) <= answerRequestLimits.responseBytes);
    assert.equal(result.answer.includes("�"), false);
    assert.equal(result.answer, "a".repeat(answerRequestLimits.responseBytes - 1));
  });

  test("rejects ill-formed Unicode from a provider", () => {
    assert.deepEqual(normalizeAssistantResponse([{ type: "text", text: "\ud800" }]), {
      ok: false,
      code: "provider_failed",
    });
  });
});
