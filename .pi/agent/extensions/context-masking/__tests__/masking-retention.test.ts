import { describe, expect, test } from "bun:test";
import { SessionManager, type ProjectedSessionEntry } from "@earendil-works/pi-coding-agent";
import {
  assessmentKey,
  awaitWithAbort,
  buildRollingContext,
  collectRollingCandidates,
  digestText,
  estimatedUtf8Tokens,
  packRollingRequests,
  readRollingAssessments,
  ROLLING_LIMITS,
  validateRollingDecisions,
  type RollingCandidate,
} from "../masking-retention";

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function session() {
  const manager = SessionManager.inMemory("/work");
  manager.appendMessage({ role: "user", content: "Original task: inspect the migration.", timestamp: 0 });
  let turn = 0;
  function cycle(
    id: string,
    text: string,
    options: {
      tool?: string;
      args?: Record<string, string>;
      isError?: boolean;
      image?: boolean;
      toolCalls?: Array<{ id: string; tool: string; args: Record<string, string> }>;
      incomplete?: boolean;
    } = {},
  ) {
    const calls = options.toolCalls ?? [{
      id,
      tool: options.tool ?? "read",
      args: options.args ?? { path: "source" },
    }];
    manager.appendMessage({
      role: "assistant",
      content: calls.map((call) => ({
        type: "toolCall" as const,
        id: call.id,
        name: call.tool,
        arguments: call.args,
      })),
      api: "openai-responses",
      provider: "openai",
      model: "test",
      usage,
      stopReason: "toolUse",
      timestamp: ++turn,
    });
    const resultIds = calls.slice(0, options.incomplete ? 1 : calls.length).map((call, index) => manager.appendMessage({
      role: "toolResult",
      toolCallId: call.id,
      toolName: call.tool,
      content: index > 0 ? [{ type: "text" as const, text: "other result" }] : options.image
        ? [{ type: "text" as const, text }, { type: "image" as const, data: "AA==", mimeType: "image/png" }]
        : [{ type: "text" as const, text }],
      isError: options.isError ?? false,
      timestamp: ++turn,
    }));
    return resultIds;
  }
  const projection = (): ProjectedSessionEntry[] => manager.buildSessionProjection().entries;
  return { manager, cycle, projection };
}

const policy = { protectRecentTurns: 1, minResultChars: 10 };

describe("rolling masking policy", () => {
  test("estimates from UTF-8 bytes and triggers at exactly 4,000 newly eligible tokens", () => {
    const f = session();
    for (let index = 0; index < 3; index++) f.cycle(`old-${index}`, "æ".repeat(2_000));
    f.cycle("recent", "short");
    const below = collectRollingCandidates(f.projection(), policy, new Set());
    expect(below).toHaveLength(3);
    expect(below.reduce((sum, candidate) => sum + candidate.estimatedTokens, 0)).toBe(3_000);

    const exact = session();
    for (let index = 0; index < 4; index++) exact.cycle(`old-${index}`, "æ".repeat(2_000));
    exact.cycle("recent", "short");
    const candidates = collectRollingCandidates(exact.projection(), policy, new Set());
    expect(candidates.reduce((sum, candidate) => sum + candidate.estimatedTokens, 0)).toBe(ROLLING_LIMITS.triggerTokens);
    expect(estimatedUtf8Tokens("æ".repeat(4))).toBe(2);
  });

  test("incomplete multi-call cycles and duplicate or future call IDs stay visible", () => {
    const f = session();
    f.cycle("batch", "large output", {
      incomplete: true,
      toolCalls: [
        { id: "multi-a", tool: "read", args: { path: "a" } },
        { id: "multi-b", tool: "read", args: { path: "b" } },
      ],
    });
    f.cycle("recent", "short");
    expect(collectRollingCandidates(f.projection(), policy, new Set())).toEqual([]);

    const duplicate = session();
    duplicate.cycle("dup", "large output", { toolCalls: [{ id: "reuse", tool: "read", args: {} }] });
    duplicate.cycle("dup-again", "large output", { toolCalls: [{ id: "reuse", tool: "read", args: {} }] });
    duplicate.cycle("recent", "short");
    expect(collectRollingCandidates(duplicate.projection(), policy, new Set())).toEqual([]);

    const future = session();
    const orphan = future.manager.appendMessage({
      role: "toolResult", toolCallId: "future", toolName: "read",
      content: [{ type: "text", text: "orphan output" }], isError: false, timestamp: 0,
    });
    const [legitimate] = future.cycle("future", "large output");
    if (!orphan || !legitimate) throw Error("Missing tool result fixture");
    future.cycle("recent", "short");
    const ids = collectRollingCandidates(future.projection(), policy, new Set()).map(candidate => candidate.sourceId);
    expect(ids).toEqual([legitimate]);
    expect(ids).not.toContain(orphan);
  });

  test("uses projected calls and retains unresolved errors unless exact later arguments succeed", () => {
    const projected = session();
    const callId = projected.cycle("edited-call", "large output")[0];
    const assistant = projected.projection().find((entry) =>
      entry.messages.some((message) => message.role === "assistant")
    );
    expect(assistant?.sourceEntry.type).toBe("message");
    if (!assistant || assistant.sourceEntry.type !== "message") throw new Error("Missing assistant entry");
    projected.manager.appendContextEdit(assistant.sourceEntry.id, {
      content: [{ type: "toolCall", id: "rewritten-call", name: "read", arguments: { path: "source" } }],
    });
    projected.cycle("recent", "short");
    expect(callId).toBeDefined();
    expect(collectRollingCandidates(projected.projection(), policy, new Set())).toEqual([]);

    const exact = session();
    exact.cycle("error", "failed output", { args: { path: "same" }, isError: true });
    exact.cycle("retry", "successful output", { args: { path: "same" } });
    exact.cycle("recent", "short");
    const exactCandidates = collectRollingCandidates(exact.projection(), policy, new Set());
    expect(exactCandidates.some((candidate) => candidate.text === "failed output")).toBe(true);

    const different = session();
    different.cycle("error", "failed output", { args: { path: "same" }, isError: true });
    different.cycle("retry", "successful output", { args: { path: "different" } });
    different.cycle("recent", "short");
    expect(collectRollingCandidates(different.projection(), policy, new Set()).some(
      (candidate) => candidate.text === "failed output",
    )).toBe(false);

    const differentTool = session();
    differentTool.cycle("error", "failed output", { args: { path: "same" }, isError: true });
    differentTool.cycle("other-tool", "successful output", { tool: "bash", args: { path: "same" } });
    differentTool.cycle("recent", "short");
    expect(collectRollingCandidates(differentTool.projection(), policy, new Set()).some(
      candidate => candidate.text === "failed output",
    )).toBe(false);
  });

  test("marks results superseded by a later equivalent call or whole-file read", () => {
    const f = session();
    f.cycle("first", "first listing", { tool: "bash", args: { command: "ls" } });
    f.cycle("partial", "partial read", { args: { path: "a.ts", offset: "10" } });
    f.cycle("other", "other file read", { args: { path: "b.ts" } });
    f.cycle("again", "second listing", { tool: "bash", args: { command: "ls" } });
    f.cycle("whole", "whole read", { args: { path: "a.ts" } });
    f.cycle("recent", "short");
    const flags = Object.fromEntries(
      collectRollingCandidates(f.projection(), policy, new Set()).map((candidate) => [candidate.text, candidate.superseded]),
    );
    expect(flags).toEqual({
      "first listing": true,
      "partial read": true,
      "other file read": false,
      "second listing": false,
      "whole read": false,
    });
  });

  test("counts assistant turns since each result", () => {
    const f = session();
    f.cycle("old", "old output", { args: { path: "x" } });
    f.cycle("mid", "mid output", { args: { path: "y" } });
    f.cycle("recent", "short");
    const turns = collectRollingCandidates(f.projection(), policy, new Set()).map((candidate) => candidate.turnsSince);
    expect(turns).toEqual([2, 1]);
  });
  test("protects recent, image, non-text, empty, and already-masked outputs", () => {
    const f = session();
    f.cycle("image", "large image output", { image: true });
    f.cycle("large", "[context-masking] already masked output");
    f.cycle("empty", "");
    f.cycle("encoded", "data:image/png;base64," + "A".repeat(300));
    f.cycle("recent", "short");
    expect(collectRollingCandidates(f.projection(), policy, new Set())).toEqual([]);
  });

  test("keeps visible checkpoint state intact when the latest user only says continue", () => {
    const f = session();
    f.manager.appendCompaction("Checkpoint: the migration remains blocked on its schema constraint.", null, 1_000);
    f.manager.appendMessage({ role: "user", content: "Continue.", timestamp: 55 });
    const context = buildRollingContext(f.projection());
    expect(context?.latestUserDirection).toBe("Continue.");
    expect(context?.checkpointState).toContain("migration remains blocked");
  });

  test("preserves the actual first and latest user directions and includes bounded exchange evidence", () => {
    const f = session();
    f.cycle("historical", "recent tool evidence");
    f.manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Recent assistant response." }],
      api: "openai-responses",
      provider: "openai",
      model: "test",
      usage,
      stopReason: "stop",
      timestamp: 50,
    });
    f.manager.appendMessage({ role: "user", content: "Latest direction.", timestamp: 51 });
    const context = buildRollingContext(f.projection());
    expect(context?.latestUserDirection).toBe("Latest direction.");
    expect(context?.recentHistory.some((item) => item.role === "toolResult" && item.text === "recent tool evidence")).toBe(true);
    expect(context?.recentHistory.some((item) => item.role === "toolCall" && item.toolName === "read")).toBe(true);

    f.manager.appendMessage({ role: "user", content: "data:image/png;base64," + "A".repeat(300), timestamp: 52 });
    expect(buildRollingContext(f.projection())).toBeUndefined();

    const oversized = session();
    oversized.manager.appendMessage({ role: "user", content: "long direction ".repeat(1_000), timestamp: 1 });
    expect(buildRollingContext(oversized.projection())).toBeUndefined();
  });

  test("keeps full candidates intact when request packets exceed byte or count limits", () => {
    const context = {
      checkpointState: "",
      originalGoal: "goal",
      latestUserDirection: "continue",
      recentHistory: [],
      omittedRecentMessages: 0,
    };
    const candidates: RollingCandidate[] = Array.from({ length: 5 }, (_, index) => {
      const text = "x".repeat(18_000);
      return {
        sourceId: `source-${index}`,
        bodyDigest: digestText(text),
        toolName: "read",
        text,
        estimatedTokens: estimatedUtf8Tokens(text),
        turnsSince: 0,
        superseded: false,
      };
    });
    const packed = packRollingRequests(context, candidates);
    expect(packed.batches).toHaveLength(ROLLING_LIMITS.maxRequests);
    expect(packed.batches.every((batch) => batch.bytes <= ROLLING_LIMITS.requestBytes)).toBe(true);
    expect(packed.deferred).toHaveLength(1);
    expect(packed.deferred[0]?.text).toBe(candidates[4]?.text);

    const oversizedText = "z".repeat(30_000);
    const tooLarge: RollingCandidate = {
      sourceId: "large",
      bodyDigest: digestText(oversizedText),
      toolName: "read",
      text: oversizedText,
      estimatedTokens: estimatedUtf8Tokens(oversizedText),
      turnsSince: 0,
      superseded: false,
    };
    const rejected = packRollingRequests(context, [tooLarge]);
    expect(rejected.batches).toEqual([]);
    expect(rejected.deferred).toEqual([]);
    expect(rejected.oversized[0]?.text).toBe(oversizedText);
  });

  test("accepts only complete finite bool verdicts and preserves assessments only in branch records", () => {
    const text = "whole body";
    const candidate: RollingCandidate = {
      sourceId: "entry-1",
      bodyDigest: digestText(text),
      toolName: "read",
      text,
      estimatedTokens: 3,
      turnsSince: 0,
      superseded: false,
    };
    const valid = { stopReason: "stop", answers: { "entry-1": { type: "bool", probability: 0.35 } } };
    expect(validateRollingDecisions(valid, [candidate])?.get(candidate.sourceId)).toBe(true);
    for (const malformed of [
      { stopReason: "error", answers: { "entry-1": { type: "bool", probability: 0 } } },
      { stopReason: "stop", answers: {} },
      { stopReason: "stop", answers: { other: { type: "bool", probability: 0 } } },
      { stopReason: "stop", answers: { "entry-1": { type: "score", probability: 0 } } },
      { stopReason: "stop", answers: { "entry-1": { type: "bool", probability: Number.NaN } } },
      { stopReason: "stop", answers: { "entry-1": { type: "bool", probability: 1.1 } } },
    ])
      expect(validateRollingDecisions(malformed, [candidate])).toBeUndefined();
    expect(validateRollingDecisions(valid, [candidate, candidate])).toBeUndefined();

    const f = session();
    expect(readRollingAssessments(f.manager.getBranch())).toEqual(new Set());
    f.manager.appendCustomEntry("context-masking-rolling", {
      version: 1,
      assessments: [{ sourceId: candidate.sourceId, bodyDigest: candidate.bodyDigest }],
    });
    expect(readRollingAssessments(f.manager.getBranch())).toEqual(
      new Set([assessmentKey(candidate.sourceId, candidate.bodyDigest)]),
    );
  });

  test("an adapter that ignores abort cannot hold the rolling hook open", async () => {
    const controller = new AbortController();
    let resolveLate: ((value: string) => void) | undefined;
    const ignored = new Promise<string>((resolve) => { resolveLate = resolve; });
    const settled = awaitWithAbort(ignored, controller.signal);
    controller.abort(new Error("deadline"));
    await expect(settled).rejects.toThrow("deadline");
    resolveLate?.("late");
    await Promise.resolve();
  });
});
