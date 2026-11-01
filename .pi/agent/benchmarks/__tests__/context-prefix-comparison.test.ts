import { describe, expect, test } from "bun:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { armSettings, comparisonHash, fixture, orderedArms, preflight, retainedTail, routeFastPayload, score, summarizeUsage } from "../context-prefix-comparison";

const options = { model: "gpt-6-luna-fast", thinking: "max" as const, seeds: 2, includeNative: false };

describe("prefix-compaction comparison contract", () => {
  test("preflight is pure and pairs the same synthetic sources with alternating order", () => {
    const plan = preflight(options);
    expect(plan.networkCalls).toBe(0);
    expect(plan.cases[0]?.order).toEqual(["extractive", "prefix"]);
    expect(plan.cases[1]?.order).toEqual(["prefix", "extractive"]);
    expect(fixture("same").sourceHash).toBe(fixture("same").sourceHash);
    expect(fixture("other").sourceHash).not.toBe(fixture("same").sourceHash);
    expect(plan.controls).toMatchObject({ retainedTailTokens: 1024, inlineTextBudgetBytes: 4000,
      automaticThresholdsMeasured: false, prefetch: false, warmup: false, background: false });
    expect(() => preflight({ ...options, seeds: 0 })).toThrow();
    expect(() => preflight({ ...options, seeds: 5 })).toThrow();
  });
  test("optional native control rotates through the same source cohort", () => {
    expect(orderedArms(0, true)).toEqual(["extractive", "prefix", "native"]);
    expect(orderedArms(1, true)).toEqual(["prefix", "native", "extractive"]);
    expect(orderedArms(2, true)).toEqual(["native", "extractive", "prefix"]);
  });
  test("only the extractive arm enables classifier compaction", () => {
    for (const arm of ["extractive", "prefix", "native"] as const) {
      const settings = armSettings(arm, options.model, options.thinking);
      expect(settings.contextClassifierCompaction.enabled).toBe(arm === "extractive");
      expect(settings.compactionModel).toEqual({ enabled: false, model: "openai-codex/gpt-6-luna-fast", thinkingLevel: "max" });
      expect(settings.contextMasking.prefetchRecall).toBe(false);
      expect(settings.compaction.enabled).toBe(false);
    }
  });
  test("scores exact current approvals and abstention, not obsolete values or malformed answers", () => {
    const data = fixture("same"), answer = Object.fromEntries(data.facts.map(fact => [fact.id, fact.expected]));
    expect(score(data.facts, JSON.stringify(answer))).toEqual({ valid: true, correct: 6, total: 6, stale: 0 });
    answer.schema = data.facts[0]?.stale ?? "";
    expect(score(data.facts, JSON.stringify(answer))).toMatchObject({ correct: 5, stale: 1 });
    expect(score(data.facts, "{}")).toMatchObject({ valid: false, correct: 0 });
    expect(score(data.facts, "not JSON")).toMatchObject({ valid: false, correct: 0 });
    expect(score(data.facts, JSON.stringify({ ...answer, extra: "not requested" }))).toMatchObject({ valid: false });
    const exact = JSON.stringify(Object.fromEntries(data.facts.map(fact => [fact.id, fact.expected])));
    expect(score(data.facts, "```json\n" + exact + "\n```").correct).toBe(6);
    expect(data.evidence.join("\n")).toContain("artifacts/æble-");
  });
  test("routes fast aliases for native summaries and preserves captured prefix replacements", () => {
    const input = [{ role: "user", content: "Approved: blue" }];
    const payload = { model: "gpt-6-luna-fast", store: false, input };
    const routed = routeFastPayload(payload);
    expect(routed).toEqual({ ...payload, model: "gpt-6-luna", service_tier: "priority" });
    expect(payload.model).toBe("gpt-6-luna-fast");
    expect(routeFastPayload({ model: "gpt-6-luna-fast" }, routed)).toBe(routed);
    expect(routeFastPayload({ model: "gpt-6-luna" })).toBeUndefined();
  });
  test("checks conversation retention separately from Pi system-message relocation", () => {
    const manager = SessionManager.inMemory("/tmp/prefix-retention-unit");
    const first = manager.appendMessage({ role: "user", content: "Retained evidence", timestamp: 0 });
    manager.appendMessage({ role: "system", content: "System instructions", timestamp: 0 });
    manager.appendMessage({ role: "user", content: "Latest task", timestamp: 0 });
    const before = manager.buildSessionProjection();
    const tail = retainedTail(before, first);
    expect(tail).toHaveLength(2);
    manager.appendCompaction("Checkpoint", first, 100);
    const after = manager.buildSessionProjection();
    const kept = after.entries.filter(entry => tail.some(item => item.sourceEntry.id === entry.sourceEntry.id));
    expect(kept.flatMap(entry => entry.messages)).toEqual(tail.flatMap(entry => entry.messages));
    expect(getCurrentSystemPrompt(after.messages)).toBe(getCurrentSystemPrompt(before.messages));
    expect(() => retainedTail(before, "missing")).toThrow("Missing native cut point");
  });
  test("pairs visible responses without comparing provider-generated signatures", () => {
    const response = (signature: string, thinking: string) => [{ role: "assistant", content: [
      { type: "text", text: "READY", textSignature: signature }, { type: "thinking", thinking },
    ] }];
    expect(comparisonHash(response("message-a", "thought-a"))).toBe(comparisonHash(response("message-b", "thought-b")));
    expect(comparisonHash(response("message-a", "thought-a"))).not.toBe(comparisonHash([{ role: "assistant", content: [{ type: "text", text: "Changed evidence" }] }]));
  });
  test("counts missing usage explicitly instead of reporting it as zero", () => {
    expect(summarizeUsage([{ kind: "compaction", ms: 1 }])).toMatchObject({ requests: 1, usageMissing: 1, cacheReadShare: null });
    expect(summarizeUsage([{ kind: "prefill", ms: 1, usage: {
      input: 10, output: 2, cacheRead: 90, cacheWrite: 5, totalTokens: 107,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    } }])).toMatchObject({ requests: 1, usageMissing: 0, prompt: 105, uncached: 15, cacheReadShare: 90 / 105 });
  });
});
