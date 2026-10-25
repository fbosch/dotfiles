import { describe, expect, test } from "bun:test";
import { sessionWith } from "../../extensions/context-masking/__tests__/fixtures";
import { latencyStats, selectByScore } from "../context-compaction-classify";
import {
  type Block,
  buildCase,
  coverage,
  distinctiveTokens,
  fit,
  scoreCase,
} from "../context-compaction-eval";

describe("compaction benchmark", () => {
  const blocks: Block[] = [
    { kind: "user", text: "alphaPath", index: 0 },
    { kind: "exchange", text: "betaPath".repeat(20), index: 1 },
    { kind: "exchange", text: "gammaPath", index: 2 },
  ];

  test("fits whole blocks and skips oversized blocks", () => {
    expect(fit(blocks, 18).map((b) => b.index)).toEqual([0, 2]);
    expect(fit(blocks, 0)).toEqual([]);
  });

  test("ranks by score density, then restores chronological order", () => {
    expect(selectByScore(blocks, [0.8, 1, 0.9], 18).map((b) => b.index)).toEqual([0, 2]);
    expect(selectByScore(blocks, [0.1, 0.1, 1], 9).map((b) => b.index)).toEqual([2]);
  });

  test("extracts distinctive identifiers and scores matching budgets", () => {
    expect(distinctiveTokens("plain alphaPath src/example.ts --verbose")).toEqual(
      new Set(["alphaPath", "src/example.ts", "--verbose"]),
    );
    const score = scoreCase({
      blocks,
      summary: "alphaPath",
      needed: new Set(["alphaPath", "gammaPath"]),
      currentRequest: "task",
    });
    expect(score.covered.summary).toBe(1);
    expect(score.covered["recency@1x"]).toBe(1);
    expect(score.covered["recency@2x"]).toBe(2);
    expect(coverage("", new Set())).toBe(0);
  });

  test("uses the latest retained user request, not the earliest", () => {
    const { manager } = sessionWith([]);
    const kept = manager.appendMessage({
      role: "user",
      content: "first retained request",
      timestamp: 1,
    });
    manager.appendMessage({ role: "user", content: "latest retained request", timestamp: 2 });
    const id = manager.appendCompaction("task summary", kept, 100);
    const entries = manager.getEntries();
    const entry = entries.find((e) => e.id === id);
    expect(entry).toBeDefined();
    if (!entry) throw new Error("missing compaction");
    const c = buildCase(entries, new Map(entries.map((e) => [e.id, e])), entry);
    expect(c?.currentRequest).toBe("latest retained request");
  });

  test("reports nearest-rank latency quantiles and empty runs", () => {
    expect(latencyStats([10, 50, 20, 40, 30])).toEqual({
      count: 5,
      total: 150,
      median: 30,
      p95: 50,
    });
    expect(latencyStats([])).toEqual({ count: 0, total: 0, median: 0, p95: 0 });
  });
});
