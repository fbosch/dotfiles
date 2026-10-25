import { describe, expect, test } from "bun:test";
import {
  DEFAULT_POLICIES,
  formatSummary,
  type MaskingPolicy,
  parseArgs,
  replaySession,
  summarize,
} from "../context-masking-replay";

const policy: MaskingPolicy = {
  name: "tail-2",
  protectRecentTurns: 2,
  minResultChars: 100,
  placeholderChars: 10,
};

// Linear session builder; each turn is an assistant message with one tool call and its result.
function session() {
  const entries: unknown[] = [{ type: "session", id: "s", timestamp: "2026-10-01T00:00:00.000Z" }];
  let parentId: string | null = null;
  let n = 0;
  const push = (entry: Record<string, unknown>) => {
    const id = `e${++n}`;
    entries.push({ ...entry, id, parentId });
    parentId = id;
    return id;
  };
  const api = {
    entries,
    last: () => parentId,
    system(chars: number) {
      push({
        type: "message",
        message: { role: "system", content: "", sections: { preamble: "s".repeat(chars) } },
      });
      return api;
    },
    user(chars: number) {
      push({ type: "message", message: { role: "user", content: "u".repeat(chars) } });
      return api;
    },
    turn(resultChars: number, { tool = "read", path = `f${n}.ts`, prompt = 0 } = {}) {
      const callId = `c${n}`;
      const args = tool === "bash" ? { command: path } : { path };
      push({
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: callId, name: tool, arguments: args }],
          usage: { input: prompt, cacheRead: 0, cacheWrite: 0 },
        },
      });
      const resultId = push({
        type: "message",
        message: {
          role: "toolResult",
          toolCallId: callId,
          toolName: tool,
          content: [{ type: "text", text: "r".repeat(resultChars) }],
        },
      });
      return Object.assign(api, { lastResult: resultId });
    },
    compaction(tokensBefore: number, firstKeptEntryId?: string | null) {
      push({
        type: "compaction",
        summary: "x".repeat(50),
        tokensBefore,
        firstKeptEntryId: firstKeptEntryId ?? parentId,
      });
      return api;
    },
    edit(targetId: string, replacement: string | null) {
      push({ type: "context_edit", targetId, replacement });
      return api;
    },
    lastResult: "" as string,
  };
  return api;
}

describe("replaySession", () => {
  test("masks large results outside the protected recent turns", () => {
    const s = session().system(100).user(100);
    s.turn(1_000, { path: "old.ts" }).turn(50, { path: "small.ts" }).turn(1_000).turn(1_000);
    s.compaction(10_000);

    const [result] = replaySession(s.entries, [policy]);
    // Context: system 100 + user 100 + 4 assistant call args + results 3_050.
    expect(result?.maskedResults).toBe(1);
    expect(result?.maskedCharsByTool).toEqual({ read: 1_000 });
    const argChars = JSON.stringify({ path: "old.ts" }).length;
    expect(result?.freedShare).toBeGreaterThan(990 / (3_250 + 4 * argChars + 10));
    expect(result?.freedShare).toBeLessThan(990 / 3_250);
  });

  test("protects everything when the session is shorter than the window", () => {
    const s = session().user(10).turn(5_000).compaction(1_000);
    expect(replaySession(s.entries, [policy])[0]?.maskedResults).toBe(0);
  });

  test("rebuilds context after an earlier compaction from its summary and kept range", () => {
    const s = session().user(10);
    s.turn(5_000, { path: "summarized.ts" });
    const kept = s.turn(2_000, { path: "kept.ts" }).last();
    s.compaction(9_000, kept);
    s.turn(10).turn(10).turn(10);
    s.compaction(9_000);

    const second = replaySession(s.entries, [policy])[1];
    // The summarized 5_000-char result is gone; only the kept 2_000-char result can be masked.
    expect(second?.maskedCharsByTool).toEqual({ read: 2_000 });
  });

  test("applies context edits before masking", () => {
    const s = session().user(10);
    s.turn(3_000);
    s.edit(s.lastResult, null);
    s.turn(10).turn(10).compaction(1_000);
    expect(replaySession(s.entries, [policy])[0]?.maskedResults).toBe(0);
  });

  test("counts masked results whose call is requested again after the compaction", () => {
    const s = session().user(10);
    s.turn(2_000, { path: "again.ts" })
      .turn(2_000, { tool: "bash", path: "bun test" })
      .turn(10)
      .turn(10);
    s.compaction(5_000);
    s.turn(10, { path: "again.ts" });

    const [result] = replaySession(s.entries, [policy]);
    expect(result?.maskedKeyed).toBe(2);
    expect(result?.maskedRefetched).toBe(1);
    expect(result?.maskedCharsByTool).toEqual({ read: 2_000, bash: 2_000 });
  });

  test("measures prompt growth per turn before the compaction", () => {
    const s = session().user(10);
    for (const prompt of [1_000, 1_500, 1_500, 2_500, 4_000]) s.turn(10, { prompt });
    s.compaction(5_000);
    // Positive deltas: 500, 1_000, 1_500; lower median is 1_000.
    expect(replaySession(s.entries, [policy])[0]?.growthPerTurn).toBe(1_000);
  });

  test("replays every default policy per compaction", () => {
    const s = session().user(10).turn(10).compaction(1_000);
    expect(replaySession(s.entries).map((r) => r.policy)).toEqual(
      DEFAULT_POLICIES.map((p) => p.name),
    );
  });
});

describe("summarize", () => {
  test("pools results per policy and estimates extra turns", () => {
    const s = session().user(10);
    s.turn(20_000, { path: "big.ts", prompt: 1_000 })
      .turn(10, { prompt: 2_000 })
      .turn(10, { prompt: 3_000 });
    s.compaction(100_000);
    s.turn(10, { path: "big.ts" });

    const [summary] = summarize(replaySession(s.entries, [policy]));
    expect(summary?.compactions).toBe(1);
    expect(summary?.freesHalf).toBe(1);
    expect(summary?.refetchedShare).toBe(1);
    expect(summary?.toolShares).toEqual([{ tool: "read", share: 1 }]);
    // Roughly 99% of 100k tokens freed, growing 1_000 tokens per turn.
    expect(summary?.extraTurns?.median).toBeGreaterThan(95);
  });

  test("summary text contains no conversation content", () => {
    const s = session().user(10);
    s.turn(5_000, { path: "private/secret.ts" }).turn(10).turn(10).compaction(1_000);
    const text = formatSummary(summarize(replaySession(s.entries, [policy])), 1);
    expect(text).not.toContain("private");
    expect(text).toContain("tail-2");
  });
});

test("parseArgs validates flags", () => {
  expect(parseArgs([], { PI_CODING_AGENT_DIR: "/agent" }).sessionsDir).toBe("/agent/sessions");
  expect(() => parseArgs(["--since", "later"], {})).toThrow("Invalid date");
  expect(() => parseArgs(["--nope", "x"], {})).toThrow("Unknown option");
});
