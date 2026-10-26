import { expect, test } from "bun:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { sessionWith } from "../../context-masking/__tests__/fixtures";
import { MARKER } from "../../context-masking/policy";
import { readContextSnapshot } from "../context-status";

function measured(manager: SessionManager, stopReason: "stop" | "error" | "aborted" = "stop") {
  return manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "Done." }],
    api: "openai-responses",
    provider: "openai",
    model: "test",
    timestamp: 0,
    stopReason,
    usage: {
      input: 100,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 110,
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
  expect(snapshot(manager)).toEqual({ usage, estimated: false, freedTokens: 0 });
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
  expect(snapshot(manager)).toEqual({ usage, estimated: true, freedTokens });
  measured(manager);
  expect(snapshot(manager)).toEqual({ usage, estimated: false, freedTokens });
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
  const unknown = readContextSnapshot({
    sessionManager: manager,
    getContextUsage: () => ({ tokens: null, percent: null, contextWindow: 11_000 }),
  });
  expect(unknown).toEqual({
    usage: { tokens: null, percent: null, contextWindow: 11_000 },
    estimated: true,
    freedTokens: 0,
  });
  measured(manager);
  expect(snapshot(manager)).toEqual({ usage, estimated: false, freedTokens: 0 });
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
  expect(snapshot(manager)).toEqual({ usage, estimated: false, freedTokens: 0 });
  manager.branch(masked);
  expect(snapshot(manager)).toEqual({ usage, estimated: false, freedTokens });
  manager.appendContextEdit(id, null);
  expect(snapshot(manager)).toEqual({ usage, estimated: true, freedTokens: 0 });
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
