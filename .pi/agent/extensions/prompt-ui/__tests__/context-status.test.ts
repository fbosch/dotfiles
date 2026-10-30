import { expect, test } from "bun:test";
import { estimateTokens, SessionManager } from "@earendil-works/pi-coding-agent";
import { sessionWith } from "../../context-masking/__tests__/fixtures";
import { MARKER } from "../../context-masking/policy";
import { readContextSnapshot } from "../context-status";

function measured(
  manager: SessionManager,
  stopReason: "stop" | "error" | "aborted" = "stop",
  tokens = { input: 100, output: 10, cacheRead: 0, cacheWrite: 0 },
) {
  return manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "Done." }],
    api: "openai-responses",
    provider: "openai",
    model: "test",
    timestamp: 0,
    stopReason,
    usage: {
      ...tokens,
      totalTokens: tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  });
}
const usage = { tokens: 110, percent: 1, contextWindow: 11_000 };
function snapshot(manager: SessionManager) {
  return readContextSnapshot({ sessionManager: manager, getContextUsage: () => usage });
}
function mask(manager: SessionManager, id: string) {
  const text = `${MARKER} saved output: /saved/${id}.txt`;
  manager.appendContextEdit(id, { content: [{ type: "text", text }] });
  manager.appendCustomEntry("context-masking", {
    items: [{ entryId: id, path: `/saved/${id}.txt`, toolName: "read" }],
  });
  return Math.ceil(text.length / 4);
}

test("distinguishes measured context from initial, trailing and invalid usage", () => {
  const manager = SessionManager.inMemory("/work");
  expect(snapshot(manager).estimated).toBe(true);
  measured(manager);
  expect(snapshot(manager)).toEqual({ usage, estimated: false, cachePercent: 0, freedTokens: 0 });
  manager.appendMessage({ role: "user", content: "next", timestamp: 0 });
  expect(snapshot(manager).estimated).toBe(true);
  measured(manager, "error");
  expect(snapshot(manager).estimated).toBe(true);
  measured(manager, "aborted");
  expect(snapshot(manager).estimated).toBe(true);
  measured(manager);
  expect(snapshot(manager).estimated).toBe(false);
});

test("marks a later masking edit as estimated and retains the badge after fresh usage", () => {
  const { manager, resultIds } = sessionWith([{ resultChars: 2_000 }]);
  const id = resultIds[0];
  if (!id) throw new Error("Missing result");
  measured(manager);
  const freedTokens = 500 - mask(manager, id);
  expect(snapshot(manager)).toEqual({ usage, estimated: true, cachePercent: 0, freedTokens });
  measured(manager);
  expect(snapshot(manager)).toEqual({ usage, estimated: false, cachePercent: 0, freedTokens });
  manager.appendCustomEntry("unrelated", { note: "metadata is not model context" });
  expect(snapshot(manager).estimated).toBe(false);
});

test("measures only active savings, not archives, quoted markers or omitted results", () => {
  const { manager, resultIds } = sessionWith([{ resultChars: 2_000 }]);
  const id = resultIds[0];
  if (!id) throw new Error("Missing result");
  const freedTokens = 500 - mask(manager, id);
  manager.appendMessage({
    role: "user",
    content: `Quote: ${MARKER} is not a tool result.`,
    timestamp: 0,
  });
  expect(snapshot(manager).freedTokens).toBe(freedTokens);
  manager.appendCompaction("Summary; saved results remain available.", null, 1_000);
  const tokens = manager
    .buildSessionProjection()
    .messages.reduce((total, message) => total + estimateTokens(message), 0);
  const compacted = readContextSnapshot({
    sessionManager: manager,
    getContextUsage: () => ({ tokens: null, percent: null, contextWindow: 11_000 }),
  });
  expect(compacted).toEqual({
    usage: {
      tokens,
      percent: (tokens / 11_000) * 100,
      contextWindow: 11_000,
    },
    estimated: true,
    freedTokens: 0,
    cachePercent: undefined,
  });
  measured(manager);
  expect(snapshot(manager)).toEqual({ usage, estimated: false, cachePercent: 0, freedTokens: 0 });
});

test("estimates the compacted projection without reusing kept pre-compaction provider usage", () => {
  const manager = SessionManager.inMemory("/work");
  const keptId = manager.appendMessage({ role: "user", content: "Retained task", timestamp: 0 });
  measured(manager);
  manager.appendCompaction("New compacted summary", keptId, 100_000);
  let currentUsage: ReturnType<Parameters<typeof readContextSnapshot>[0]["getContextUsage"]> = {
    tokens: null,
    percent: null,
    contextWindow: 11_000,
  };
  const read = () =>
    readContextSnapshot({ sessionManager: manager, getContextUsage: () => currentUsage });
  const tokens = manager
    .buildSessionProjection()
    .messages.reduce((total, message) => total + estimateTokens(message), 0);
  expect(read()).toEqual({
    usage: { tokens, percent: (tokens / 11_000) * 100, contextWindow: 11_000 },
    estimated: true,
    cachePercent: 0,
    freedTokens: 0,
  });
  expect(tokens).toBeLessThan(110);
  measured(manager);
  currentUsage = usage;
  expect(read()).toEqual({ usage, estimated: false, cachePercent: 0, freedTokens: 0 });
});

test("post-compaction estimates count only the current system snapshot", () => {
  const manager = SessionManager.inMemory("/work");
  manager.appendMessage({ role: "system", content: "Old system".repeat(500), timestamp: 0 });
  manager.appendMessage({ role: "user", content: "Old task", timestamp: 0 });
  manager.appendCompaction("Summary", null, 100_000);
  const currentSystem = { role: "system" as const, content: "Current system", timestamp: 1 };
  manager.appendMessage(currentSystem);
  const tokens = manager
    .buildSessionProjection()
    .messages.filter((message) => message.role !== "system")
    .reduce((total, message) => total + estimateTokens(message), estimateTokens(currentSystem));
  expect(
    readContextSnapshot({
      sessionManager: manager,
      getContextUsage: () => ({ tokens: null, percent: null, contextWindow: 11_000 }),
    }),
  ).toEqual({
    usage: { tokens, percent: (tokens / 11_000) * 100, contextWindow: 11_000 },
    estimated: true,
    freedTokens: 0,
    cachePercent: undefined,
  });
});

test("unknown context capacity remains unknown after compaction", () => {
  const manager = SessionManager.inMemory("/work");
  manager.appendCompaction("Summary", null, 100_000);
  expect(
    readContextSnapshot({ sessionManager: manager, getContextUsage: () => undefined }).usage,
  ).toBeUndefined();
  expect(
    readContextSnapshot({
      sessionManager: manager,
      getContextUsage: () => ({ tokens: null, percent: null, contextWindow: 0 }),
    }).usage,
  ).toEqual({ tokens: null, percent: null, contextWindow: 0 });
});

test("recomputes savings and usage provenance on branch changes", () => {
  const { manager, resultIds } = sessionWith([{ resultChars: 2_000 }]);
  const id = resultIds[0];
  if (!id) throw new Error("Missing result");
  const original = measured(manager);
  const freedTokens = 500 - mask(manager, id);
  const masked = measured(manager);
  expect(snapshot(manager).freedTokens).toBe(freedTokens);
  manager.branch(original);
  expect(snapshot(manager)).toEqual({ usage, estimated: false, cachePercent: 0, freedTokens: 0 });
  manager.branch(masked);
  expect(snapshot(manager)).toEqual({ usage, estimated: false, cachePercent: 0, freedTokens });
  manager.appendContextEdit(id, null);
  expect(snapshot(manager)).toEqual({ usage, estimated: true, cachePercent: 0, freedTokens: 0 });
});

test("ignores marker-looking output without a recorded mask", () => {
  const { manager, resultIds } = sessionWith([{ resultChars: 2_000 }]);
  const id = resultIds[0];
  if (!id) throw new Error("Missing result");
  manager.appendContextEdit(id, {
    content: [{ type: "text", text: `${MARKER} quoted file contents` }],
  });
  expect(snapshot(manager).freedTokens).toBe(0);
});

test("subtracts all mask overhead and never reports negative net savings", () => {
  const { manager, resultIds } = sessionWith([{ resultChars: 20 }, { resultChars: 2_000 }]);
  const [small, large] = resultIds;
  if (!small || !large) throw new Error("Missing results");
  const smallCost = mask(manager, small);
  expect(snapshot(manager).freedTokens).toBe(0);
  const largeCost = mask(manager, large);
  expect(snapshot(manager).freedTokens).toBe(505 - smallCost - largeCost);
  manager.appendContextEdit(large, null);
  expect(snapshot(manager).freedTokens).toBe(0);
});

test("restoring full output removes its savings even when artifact metadata remains", () => {
  const { manager, resultIds } = sessionWith([{ resultChars: 2_000 }]);
  const id = resultIds[0];
  if (!id) throw new Error("Missing result");
  const freedTokens = 500 - mask(manager, id);
  expect(snapshot(manager).freedTokens).toBe(freedTokens);
  manager.appendContextEdit(id, { content: [{ type: "text", text: "x".repeat(2_000) }] });
  expect(snapshot(manager).freedTokens).toBe(0);
});

test("weights cache hits by all input tokens, excluding output and including cache writes", () => {
  const manager = SessionManager.inMemory("/work");
  expect(snapshot(manager).cachePercent).toBeUndefined();
  measured(manager, "stop", { input: 100, output: 5_000, cacheRead: 800, cacheWrite: 100 });
  expect(snapshot(manager).cachePercent).toBe(80);
  measured(manager);
  expect(snapshot(manager).cachePercent).toBeCloseTo((800 / 1_100) * 100);
  measured(manager, "stop", { input: 0, output: 10, cacheRead: 100, cacheWrite: 0 });
  expect(snapshot(manager).cachePercent).toBe(75);
});

test("retains historical cache usage through tool results, masking, and compaction", () => {
  const { manager, resultIds } = sessionWith([{ resultChars: 2_000 }]);
  const id = resultIds[0];
  if (!id) throw new Error("Missing result");
  measured(manager, "stop", { input: 20, output: 5, cacheRead: 80, cacheWrite: 0 });
  manager.appendMessage({
    role: "toolResult",
    toolCallId: "call0",
    toolName: "read",
    content: [{ type: "text", text: "Result" }],
    isError: false,
    timestamp: 0,
  });
  expect(snapshot(manager).cachePercent).toBe(80);
  mask(manager, id);
  expect(snapshot(manager).cachePercent).toBe(80);
  manager.appendCompaction("Summary", null, 1_000);
  expect(snapshot(manager).cachePercent).toBe(80);
  measured(manager, "stop", { input: 90, output: 5, cacheRead: 10, cacheWrite: 0 });
  expect(snapshot(manager).cachePercent).toBe(45);
  manager.appendMessage({ role: "user", content: "next", timestamp: 0 });
  expect(snapshot(manager).cachePercent).toBe(45);
});

test("averages only requests on the selected branch", () => {
  const manager = SessionManager.inMemory("/work");
  const first = measured(manager, "stop", { input: 20, output: 5, cacheRead: 80, cacheWrite: 0 });
  const second = measured(manager, "stop", { input: 90, output: 5, cacheRead: 10, cacheWrite: 0 });
  expect(snapshot(manager).cachePercent).toBe(45);
  manager.branch(first);
  expect(snapshot(manager).cachePercent).toBe(80);
  measured(manager, "stop", { input: 20, output: 5, cacheRead: 180, cacheWrite: 0 });
  expect(snapshot(manager).cachePercent).toBeCloseTo((260 / 300) * 100);
  manager.branch(second);
  expect(snapshot(manager).cachePercent).toBe(45);
});

test("keeps usage for historical assistant messages removed from the active context", () => {
  const manager = SessionManager.inMemory("/work");
  const first = measured(manager, "stop", { input: 20, output: 5, cacheRead: 80, cacheWrite: 0 });
  measured(manager, "stop", { input: 90, output: 5, cacheRead: 10, cacheWrite: 0 });
  manager.appendContextEdit(first, null);
  expect(snapshot(manager).cachePercent).toBe(45);
});

test("ignores failed, aborted, and zero-input responses without discarding prior usage", () => {
  const manager = SessionManager.inMemory("/work");
  for (const reason of ["error", "aborted"] as const) {
    measured(manager, reason);
    expect(snapshot(manager).cachePercent).toBeUndefined();
  }
  measured(manager, "stop", { input: 0, output: 10, cacheRead: 0, cacheWrite: 0 });
  expect(snapshot(manager).cachePercent).toBeUndefined();
  measured(manager, "stop", { input: 20, output: 5, cacheRead: 80, cacheWrite: 0 });
  for (const reason of ["error", "aborted"] as const) measured(manager, reason);
  measured(manager, "stop", { input: 0, output: 10, cacheRead: 0, cacheWrite: 0 });
  expect(snapshot(manager).cachePercent).toBe(80);
});
