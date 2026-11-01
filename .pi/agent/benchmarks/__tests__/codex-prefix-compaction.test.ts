import { describe, expect, test } from "bun:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { checkedSummary, CodexPrefixCapture, MAX_SUMMARY_BYTES, SUMMARY_INSTRUCTION, summaryPayload } from "../codex-prefix-compaction";

const identity = { sessionId: "session", modelKey: "codex/model", thinking: "max" };
const body = () => ({
  model: "test-model", store: false, stream: true, instructions: "System æøå",
  input: [{ role: "user", content: [{ type: "input_text", text: "Approved: blue" }] }],
  tools: [{ type: "function", name: "read", parameters: { type: "object" } }],
  reasoning: { effort: "max", summary: "auto" }, prompt_cache_key: "session",
  include: ["reasoning.encrypted_content"], tool_choice: "auto",
});
const message = (text: string): AssistantMessage => ({
  role: "assistant", api: "openai-codex-responses", provider: "openai-codex", model: "test",
  content: [{ type: "text", text }], stopReason: "stop", timestamp: 0,
  usage: { input: 100, output: 20, cacheRead: 80, cacheWrite: 0, totalTokens: 200,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});

describe("Codex prefix experiment", () => {
  test("extends only input and preserves all prompt-affecting fields", () => {
    const original = body(), before = structuredClone(original);
    const replay = summaryPayload(original, "Keep the approval");
    expect(replay).toEqual({ ...original, input: [...original.input, {
      role: "user", content: [{ type: "input_text", text: SUMMARY_INSTRUCTION + "\nCompaction focus:\nKeep the approval" }],
    }] });
    expect(replay.input).toHaveLength(original.input.length + 1);
    expect(JSON.stringify(replay)).toContain("Keep the approval");
    expect(original).toEqual(before);
    expect(replay.instructions).toBe("System æøå");
  });
  test("rejects delta or unknown payloads", () => {
    for (const value of [null, {}, { ...body(), store: true }, { ...body(), input: null },
      { ...body(), previous_response_id: "previous" }])
      expect(() => summaryPayload(value)).toThrow();
  });
  test("requires a completed turn and unchanged model/session/thinking/projection", () => {
    const capture = new CodexPrefixCapture();
    capture.capture(body(), identity);
    expect(capture.get(identity, "projection")).toBeUndefined();
    capture.settle(identity, "projection", true);
    expect(capture.get(identity, "projection")).toEqual(body());
    expect(capture.get(identity, "masked-projection")).toBeUndefined();
    for (const changed of [{ ...identity, sessionId: "other" }, { ...identity, modelKey: "other" },
      { ...identity, thinking: "off" }])
      expect(capture.get(changed, "projection")).toBeUndefined();
    capture.invalidate();
    expect(capture.get(identity, "projection")).toBeUndefined();
  });
  test("failed requests and invalid new captures cannot reuse an earlier request", () => {
    const capture = new CodexPrefixCapture();
    capture.capture(body(), identity);
    capture.settle(identity, "projection", false);
    expect(capture.get(identity, "projection")).toBeUndefined();
    capture.capture(body(), identity);
    capture.settle(identity, "projection", true);
    expect(() => capture.capture({}, identity)).toThrow();
    expect(capture.get(identity, "projection")).toBeUndefined();
  });
  test("returned payloads cannot mutate the captured request", () => {
    const capture = new CodexPrefixCapture();
    capture.capture(body(), identity);
    capture.settle(identity, "projection", true);
    const copy = capture.get(identity, "projection");
    if (!copy) throw Error("Capture missing");
    copy.instructions = "Changed";
    expect(capture.get(identity, "projection")?.instructions).toBe("System æøå");
  });
  test("accepts bounded text and rejects tool use, incomplete, empty and oversized output", () => {
    expect(checkedSummary(message("  æøå checkpoint  "))).toBe("æøå checkpoint");
    expect(() => checkedSummary(message(""))).toThrow();
    expect(() => checkedSummary(message("ø".repeat(MAX_SUMMARY_BYTES)))).toThrow();
    expect(() => checkedSummary({ ...message("partial"), stopReason: "length" })).toThrow();
    expect(() => checkedSummary({ ...message("tools"), stopReason: "toolUse",
      content: [{ type: "toolCall", id: "call", name: "read", arguments: {} }] })).toThrow();
  });
});
