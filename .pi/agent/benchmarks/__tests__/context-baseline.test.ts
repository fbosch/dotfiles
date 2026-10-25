import { describe, expect, test } from "bun:test";
import {
  aggregate,
  analyzeSession,
  createSessionAnalyzer,
  distribution,
  formatReport,
  inRange,
  parseArgs,
} from "../context-baseline";

let counter = 0;
const nextId = () => `e${++counter}`;

interface Turn {
  input?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
  reads?: string[];
  commands?: string[];
  model?: string;
}

// Builds a linear session; each helper appends one entry parented on the previous one.
function sessionBuilder(startedAt = "2026-10-01T00:00:00.000Z") {
  const entries: unknown[] = [{ type: "session", version: 3, id: "s", timestamp: startedAt }];
  let parentId: string | null = null;
  const push = (entry: Record<string, unknown>) => {
    const id = nextId();
    entries.push({ ...entry, id, parentId, timestamp: startedAt });
    parentId = id;
    return id;
  };
  const builder = {
    entries,
    user(text: string) {
      push({ type: "message", message: { role: "user", content: text } });
      return builder;
    },
    assistant(turn: Turn = {}) {
      const calls = [
        ...(turn.reads ?? []).map((path) => ({
          type: "toolCall",
          id: nextId(),
          name: "read",
          arguments: { path },
        })),
        ...(turn.commands ?? []).map((command) => ({
          type: "toolCall",
          id: nextId(),
          name: "bash",
          arguments: { command },
        })),
      ];
      push({
        type: "message",
        message: {
          role: "assistant",
          provider: "openai",
          model: turn.model ?? "m1",
          content: [{ type: "text", text: "ok" }, ...calls],
          usage: {
            input: turn.input ?? 100,
            output: 10,
            cacheRead: turn.cacheRead ?? 0,
            cacheWrite: turn.cacheWrite ?? 0,
            totalTokens: 0,
            cost: { total: turn.cost ?? 0.01 },
          },
        },
      });
      for (const _ of calls) {
        push({
          type: "message",
          message: { role: "toolResult", content: [{ type: "text", text: "0123456789" }] },
        });
      }
      return builder;
    },
    compaction(tokensBefore: number, summaryCost = 0.5) {
      push({
        type: "compaction",
        summary: "secret summary text",
        firstKeptEntryId: parentId,
        tokensBefore,
        fromHook: true,
        usage: {
          input: 1000,
          output: 200,
          cacheRead: 0,
          cacheWrite: 0,
          cost: { total: summaryCost },
        },
      });
      return builder;
    },
    usage(cacheRead: number) {
      push({
        type: "usage",
        kind: "cache_warm",
        usage: { input: 0, output: 0, cacheRead, cacheWrite: 0, cost: { total: 0.02 } },
      });
      return builder;
    },
  };
  return builder;
}

describe("analyzeSession", () => {
  test("totals usage per model with input as uncached tokens", () => {
    const { entries } = sessionBuilder()
      .user("hi")
      .assistant({ input: 100, cacheRead: 300, cost: 0.1 })
      .assistant({ input: 50, cacheRead: 450, cacheWrite: 20, cost: 0.2, model: "m2" });
    const analysis = analyzeSession(entries);

    expect(analysis.startedAt).toBe("2026-10-01T00:00:00.000Z");
    expect(analysis.turnsByModel["openai/m1"]).toEqual({
      turns: 1,
      usage: { uncachedInput: 100, cacheRead: 300, cacheWrite: 0, output: 10, cost: 0.1 },
    });
    expect(analysis.turnsByModel["openai/m2"]?.usage.cacheWrite).toBe(20);
  });

  test("measures cache recovery and prompt reduction around a compaction", () => {
    const session = sessionBuilder().user("task");
    for (let i = 0; i < 4; i++) session.assistant({ input: 100, cacheRead: 900 });
    session.compaction(10_000);
    session.assistant({ input: 2_000, cacheRead: 0, cacheWrite: 0, model: "m2" });
    session.assistant({ input: 100, cacheRead: 1_900 });
    session.assistant({ input: 100, cacheRead: 1_900 });
    session.assistant({ input: 100, cacheRead: 1_900 });

    const [cycle] = analyzeSession(session.entries).compactions;
    expect(cycle?.model).toBe("openai/m2");
    expect(cycle?.tokensBefore).toBe(10_000);
    expect(cycle?.fromHook).toBe(true);
    expect(cycle?.summaryUsage.cost).toBe(0.5);
    expect(cycle?.cycleTurns).toBe(4);
    expect(cycle?.beforeCacheReadRatio).toBeCloseTo(0.9);
    // First three turns: 3_800 cache reads of 6_000 prompt tokens.
    expect(cycle?.afterCacheReadRatio).toBeCloseTo(3_800 / 6_000);
    expect(cycle?.afterWindowTurns).toBe(3);
    expect(cycle?.firstPromptTokens).toBe(2_000);
  });

  test("counts re-fetches of pre-compaction reads and commands once per window", () => {
    const session = sessionBuilder().user("task");
    session.assistant({ reads: ["a.ts", "b.ts"], commands: ["bun test"] });
    session.compaction(5_000);
    session.assistant({ reads: ["a.ts", "a.ts", "c.ts"], commands: ["  bun test  "] });

    const [cycle] = analyzeSession(session.entries).compactions;
    expect(cycle?.postWindowCalls).toBe(4);
    expect(cycle?.postWindowRepeats).toBe(2);
  });

  test("uses calls older than the pre-compaction window as the control baseline", () => {
    const session = sessionBuilder().user("task");
    session.assistant({ reads: ["old.ts"] });
    for (let i = 0; i < 10; i++) session.assistant({ reads: i === 0 ? ["old.ts", "new.ts"] : [] });
    session.compaction(5_000);

    const [cycle] = analyzeSession(session.entries).compactions;
    expect(cycle?.preWindowCalls).toBe(2);
    expect(cycle?.preWindowRepeats).toBe(1);
  });

  test("attributes turns only to the latest compaction on their path", () => {
    const session = sessionBuilder().user("task").assistant();
    session.compaction(5_000).assistant().assistant();
    session.compaction(6_000).assistant();

    const [first, second] = analyzeSession(session.entries).compactions;
    expect(first?.cycleTurns).toBe(2);
    expect(second?.cycleTurns).toBe(1);
    expect(second?.beforeCacheReadRatio).toBe(0);
  });

  test("follows parent links so sibling branches do not share history", () => {
    const entries: unknown[] = [
      { type: "session", id: "s", timestamp: "2026-10-01T00:00:00.000Z" },
      { type: "message", id: "u", parentId: null, message: { role: "user", content: "x" } },
      {
        type: "message",
        id: "a1",
        parentId: "u",
        message: {
          role: "assistant",
          provider: "p",
          model: "m",
          content: [{ type: "toolCall", name: "read", arguments: { path: "x.ts" } }],
          usage: {},
        },
      },
      // Branch from the user message, so the earlier read is not on this path.
      { type: "compaction", id: "c", parentId: "u", tokensBefore: 10 },
      {
        type: "message",
        id: "a2",
        parentId: "c",
        message: {
          role: "assistant",
          provider: "p",
          model: "m",
          content: [{ type: "toolCall", name: "read", arguments: { path: "x.ts" } }],
          usage: {},
        },
      },
    ];
    const [cycle] = analyzeSession(entries).compactions;
    expect(cycle?.postWindowCalls).toBe(1);
    expect(cycle?.postWindowRepeats).toBe(0);
  });

  test("separates tool-result text, other usage, and recall calls", () => {
    const { entries } = sessionBuilder()
      .user("abcde")
      .assistant({ reads: ["a.ts"] })
      .usage(500);
    entries.push({
      type: "message",
      id: "recall",
      parentId: null,
      message: {
        role: "assistant",
        provider: "p",
        model: "m",
        content: [{ type: "toolCall", name: "tool_output_search", arguments: {} }],
        usage: {},
      },
    });
    const analysis = analyzeSession(entries);

    expect(analysis.toolResultChars).toBe(10);
    expect(analysis.otherMessageChars).toBeGreaterThan(5);
    expect(analysis.nonMessageUsage.cacheRead).toBe(500);
    expect(analysis.recallCalls).toBe(1);
  });

  test("counts malformed lines without failing the session", () => {
    const analyzer = createSessionAnalyzer();
    analyzer.addLine('{"type":"session","timestamp":"2026-10-01T00:00:00.000Z"}');
    analyzer.addLine("{not json");
    analyzer.addLine("");
    analyzer.addLine("42");
    expect(analyzer.finish().malformedLines).toBe(2);
  });
});

describe("aggregate", () => {
  test("pools usage and compaction cycles across sessions", () => {
    const first = sessionBuilder().user("a").assistant({ input: 100, cacheRead: 300 });
    first.compaction(8_000).assistant({ input: 1_000, commands: ["ls"] });
    const second = sessionBuilder().user("b").assistant({ input: 100, cacheRead: 100 });

    const report = aggregate([analyzeSession(first.entries), analyzeSession(second.entries)]);
    const model = report.models.find((m) => m.model === "openai/m1");

    expect(report.sessions).toMatchObject({ analyzed: 2, withCompaction: 1, malformedLines: 0 });
    expect(model).toMatchObject({ sessions: 2, turns: 3, uncachedInput: 1_200, cacheRead: 400 });
    expect(model?.cacheReadRatio).toBeCloseTo(400 / 1_600);
    expect(report.compactions).toHaveLength(1);
    expect(report.compactions[0]).toMatchObject({ model: "openai/m1", count: 1, fromHookShare: 1 });
    expect(report.compactions[0]?.firstPromptReduction?.median).toBeCloseTo(1 - 1_000 / 8_000);
  });

  test("report text contains aggregates but no conversation content", () => {
    const session = sessionBuilder()
      .user("private request")
      .assistant({ reads: ["private/path.ts"] });
    session.compaction(9_000).assistant();
    const text = formatReport(aggregate([analyzeSession(session.entries)]));
    const json = JSON.stringify(aggregate([analyzeSession(session.entries)]));

    for (const output of [text, json]) {
      expect(output).not.toContain("private");
      expect(output).not.toContain("secret summary");
    }
    expect(text).toContain("openai/m1");
  });
});

describe("helpers", () => {
  test("distribution uses nearest-rank percentiles", () => {
    expect(distribution([])).toBeNull();
    expect(distribution([5, 1, 3, 2, 4])).toEqual({ median: 3, p90: 5 });
  });

  test("inRange filters on the session start time", () => {
    expect(inRange(null, null, null)).toBe(true);
    expect(inRange(null, "2026-10-01", null)).toBe(false);
    expect(inRange("2026-10-02T00:00:00Z", "2026-10-01", "2026-10-03")).toBe(true);
    expect(inRange("2026-10-03T00:00:00Z", "2026-10-01", "2026-10-03")).toBe(false);
  });

  test("parseArgs resolves the sessions directory and validates flags", () => {
    expect(parseArgs([], { PI_CODING_AGENT_DIR: "/agent" }).sessionsDir).toBe("/agent/sessions");
    expect(parseArgs(["--since", "2026-10-01", "--json", "/tmp/out.json"], {})).toMatchObject({
      since: "2026-10-01",
      json: "/tmp/out.json",
    });
    expect(() => parseArgs(["--since"], {})).toThrow("Missing value");
    expect(() => parseArgs(["--since", "soon"], {})).toThrow("Invalid date");
    expect(() => parseArgs(["--bogus", "x"], {})).toThrow("Unknown option");
  });
});
