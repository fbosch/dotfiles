import { describe, expect, it } from "bun:test";
import {
  BENCHMARK_TIMEOUTS,
  makeFixtures,
  normalizeFixture,
  pipelineOrderForRepeat,
  scoreCompactionMetrics,
  summarizeRunCounts,
  type FixtureCase,
} from "../fast-jev-compaction-live";

describe("expanded fast-Jev benchmark fixtures", () => {
  it("normalizes all cases and keeps required and disposable markers separate", () => {
    const fixtures = makeFixtures();

    expect(fixtures.map((fixture) => fixture.name)).toEqual([
      "read-heavy-prunable",
      "protected-error-action-heavy",
      "conversation-prior-summary",
    ]);
    for (const fixture of fixtures) {
      expect(fixture.tailMessageCount).toBe(fixture.tailMessages.length);
      const required = Object.values(fixture.requiredMarkers).flat();
      expect(required.some((marker) => fixture.disposableMarkers.includes(marker))).toBe(false);
      expect(required.some((marker) => fixture.routineDroppableMarkers.includes(marker))).toBe(
        false,
      );
    }

    const conversation = fixtures.find((fixture) => fixture.name === "conversation-prior-summary");
    expect(conversation?.previousSummary).toContain("FACT-CONVERSATION-PRIOR-GOAL");
    expect(conversation?.requiredMarkers.error).toContain("FACT-CONVERSATION-PRIOR-ERROR");

    const read = fixtures.find((fixture) => fixture.name === "read-heavy-prunable");
    expect(read?.routineDroppableMarkers).toEqual(["FACT-READ-OLD-ROUTINE-0"]);
  });

  it("rejects a routine marker that is accidentally required", () => {
    const fixture = makeFixtures()[0] as FixtureCase;
    expect(() =>
      normalizeFixture({
        ...fixture,
        requiredMarkers: { ...fixture.requiredMarkers, goal: ["FACT-READ-OLD-ROUTINE-0"] },
      }),
    ).toThrow("fixture marker is both required and disposable");
  });

  it("alternates pipeline order by repeat", () => {
    expect(pipelineOrderForRepeat(1)).toEqual(["ours", "upstream"]);
    expect(pipelineOrderForRepeat(2)).toEqual(["upstream", "ours"]);
  });

  it("keeps the corrected request deadlines bounded", () => {
    expect(BENCHMARK_TIMEOUTS).toEqual({
      jevMs: 2_400,
      lunaMs: 60_000,
      childMs: 90_000,
      totalBudgetMs: 720_000,
    });
  });
});

describe("expanded fast-Jev benchmark metrics", () => {
  it("scores failed compactions as zero savings without retention", () => {
    expect(
      scoreCompactionMetrics({
        beforeTokens: 100,
        finalTokens: 10,
        compactionSucceeded: false,
      }),
    ).toEqual({
      finalTokensEstimate: 100,
      savingsTokensEstimate: 0,
      savingsPercentEstimate: 0,
      retentionStatus: "not-scored",
    });
    expect(
      scoreCompactionMetrics({
        beforeTokens: 100,
        finalTokens: 10,
        compactionSucceeded: true,
      }),
    ).toEqual({
      finalTokensEstimate: 10,
      savingsTokensEstimate: 90,
      savingsPercentEstimate: 0.9,
      retentionStatus: "scored",
    });
  });

  it("counts routes, fallbacks, and sanitized errors without model text", () => {
    const counts = summarizeRunCounts([
      {
        ok: true,
        requests: {
          fallbackUsed: true,
          lunaRequests: 1,
          jevEvents: [{ provider: "vercel-ai-gateway", status: 503, ok: false }],
          lunaEvents: [{ provider: "openrouter", ok: true }],
        },
      },
      {
        ok: true,
        requests: {
          fallbackUsed: false,
          lunaRequests: 0,
          jevEvents: [{ provider: "vercel-ai-gateway", status: 200, ok: true }],
          lunaEvents: [],
        },
      },
    ]);

    expect(counts).toEqual({
      runs: 2,
      successfulRuns: 2,
      failedRuns: 0,
      jevHttp: 2,
      lunaFallbacks: 1,
      lunaRequests: 1,
      routes: {
        "jev:vercel-ai-gateway": 2,
        "luna:openrouter": 1,
      },
      errors: { "fallback:no-summary": 1, "jev:vercel-ai-gateway:503": 1 },
    });
  });
});
