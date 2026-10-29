import { describe, expect, test } from "bun:test";
import { formatSummary, parseArgs, reportSession, summarize } from "../context-masking-live-report";

const reply = (input: number, cacheRead: number, cacheWrite = 0) => ({
  type: "message",
  message: { role: "assistant", usage: { input, output: 10, cacheRead, cacheWrite } },
});
const rolling = (data: Record<string, unknown>) => ({ type: "custom", customType: "context-masking-rolling", data });

describe("context-masking live report", () => {
  test("counts cache reuse, commits, held masks and classifier work from one session", () => {
    const report = reportSession("a.jsonl", [
      reply(1_000, 0, 9_000),
      rolling({ version: 1, requestCount: 2, classifierDurationMs: 1_500, maskedCount: 0, pendingMasks: [{}, {}], pendingMaskTokens: 6_000 }),
      reply(500, 10_000),
      rolling({ version: 1, requestCount: 0, maskedCount: 2, estimatedSavedTokens: 6_000, deferredCount: 1, pendingMasks: [], pendingMaskTokens: 0 }),
      { type: "compaction" },
      reply(4_000, 0),
    ]);
    expect(report).toMatchObject({
      policy: "pressure",
      requests: 3,
      promptTokens: 24_500,
      cachedTokens: 10_000,
      uncachedTokens: 14_500,
      peakPromptTokens: 10_500,
      classifications: 1,
      classifierRequests: 2,
      classifierSeconds: 1.5,
      commits: 1,
      committedTokens: 6_000,
      commitsWithBacklog: 1,
      heldMasksAtEnd: 0,
      compactions: 1,
    });
  });

  test("labels older rolling records and skips sessions without rolling masking", () => {
    expect(reportSession("old.jsonl", [rolling({ version: 1, maskedCount: 1 })])?.policy).toBe("rolling");
    expect(reportSession("none.jsonl", [reply(1, 1)])).toBeUndefined();
  });

  test("totals sessions per policy", () => {
    const a = reportSession("a", [reply(0, 90), rolling({ version: 1, pendingMasks: [] })]);
    const b = reportSession("b", [reply(10, 0), rolling({ version: 1, pendingMasks: [] })]);
    if (!a || !b) throw Error("Missing reports");
    const [totals] = summarize([a, b]);
    expect(totals).toMatchObject({ policy: "pressure", sessions: 2, promptTokens: 100, cacheReadShare: 0.9 });
    expect(formatSummary([totals!])).toContain("cacheRead=90.0%");
  });

  test("reads the sessions directory, date filter and JSON flag", () => {
    const args = parseArgs(["--since", "2026-10-29", "--json"], { PI_CODING_AGENT_DIR: "/agent" });
    expect(args).toEqual({ sessionsDir: "/agent/sessions", since: Date.parse("2026-10-29"), json: true });
    expect(() => parseArgs(["--since", "soon"], {})).toThrow("--since");
  });
});
