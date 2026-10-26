import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, type ExtensionAPI, type ExtensionContext, type SessionBeforeCompactEvent, type SessionBeforeCompactResult } from "@earendil-works/pi-coding-agent";
import { CLASSIFIER_DEFAULTS, classifyCompaction, type ClassifierRequest, type ClassifierResponse, type CompactionInput } from "../classifier-compaction";
import { ClassifierDecisionCache } from "../classifier-cache";
import { registerClassifierCompaction } from "../classifier-hook";
import { recallSaved } from "../recall";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const settings = { ...CLASSIFIER_DEFAULTS, enabled: true, minFreedRatio: 0 };
const usage = { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
function answer(request: ClassifierRequest, probability: (name: string) => number = () => 0): ClassifierResponse {
  return { api: "typesafe-system-one", provider: "test", model: "test", stopReason: "stop", timestamp: 1, usage,
    answers: Object.fromEntries(Object.keys(request.questions).map(name => [name, { type: "bool", probability: probability(name) }])) };
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "conversation-compaction-")); roots.push(root);
  const manager = SessionManager.inMemory(root);
  const user = "Obsolete background. ".repeat(100), assistant = "Finished investigation: æøå. ".repeat(80);
  manager.appendMessage({ role: "user", content: user, timestamp: 1 });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: assistant }], api: "openai-responses", provider: "test", model: "test", usage, stopReason: "stop", timestamp: 2 });
  const input: CompactionInput = { sessionId: manager.getSessionId(), branch: manager.getBranch(), messages: manager.buildSessionProjection().messages };
  return { root, manager, input, user, assistant };
}

test("ordinary text compacts through the classifier without saved tool results or images", async () => {
  const f = await fixture(); let calls = 0;
  const result = await classifyCompaction(f.input, settings, { artifactRoot: f.root, classify: async request => { calls++; return answer(request); } });
  expect({ kind: result.kind, reason: result.reason }).toEqual({ kind: "retained", reason: "accepted" });
  expect(calls).toBeGreaterThan(0);
  expect(result.text).not.toContain("Obsolete background");
  expect(result.decisions.map(d => d.action)).toEqual(["omit", "omit"]);
  const originals = await Promise.all((result.savedItems ?? []).map(item => readFile(item.path, "utf8")));
  expect(originals).toEqual([`[user]\n${f.user}`, `[assistant]\n${f.assistant}`]);
});

test("previous state and prose support independent inline, reference and omit decisions", async () => {
  const f = await fixture();
  const previousSummary = "Current requirement: preserve Danish æ, ø, å.";
  const result = await classifyCompaction({ ...f.input, previousSummary }, settings, { artifactRoot: f.root, classify: async request => answer(request, name => name === "inline_t0" || name === "reference_t2" ? 1 : 0) });
  expect(result.kind).toBe("retained");
  expect(result.decisions.map(d => d.action)).toEqual(["inline", "omit", "reference"]);
  expect(result.text).toContain(previousSummary);
  expect(result.text).not.toContain("Obsolete background");
  expect(result.text).not.toContain("Finished investigation");
  const reference = result.decisions[2]; if (!reference) throw Error("Missing prose reference");
  expect(result.text).toContain(reference.path);
  expect(await readFile(reference.path, "utf8")).toBe(`[assistant]\n${f.assistant}`);
});

test("uncertain prose stays recoverable through a visible reference", async () => {
  const f = await fixture();
  const result = await classifyCompaction(f.input, settings, { artifactRoot: f.root, classify: async request => answer(request, () => 0.4) });
  expect(result.kind).toBe("retained");
  expect(result.decisions).toHaveLength(2);
  expect(result.decisions.every(d => d.action === "reference" && d.forced)).toBe(true);
});

test("oversized prose remains whole in its archive and gets a conservative reference", async () => {
  const f = await fixture(), previousSummary = "Do not split this constraint: æøå.\n".repeat(1000);
  const requests: ClassifierRequest[] = [];
  const result = await classifyCompaction({ ...f.input, previousSummary }, settings, { artifactRoot: f.root, classify: async request => { requests.push(request); return answer(request); } });
  expect(result.kind).toBe("retained");
  const decision = result.decisions[0]; if (!decision) throw Error("Missing previous-state reference");
  expect(decision).toMatchObject({ id: "t0", action: "reference", forced: true });
  expect(await readFile(decision.path, "utf8")).toBe(`[previous compaction state]\n${previousSummary}`);
  expect(result.requestBytes.every(n => n <= settings.maxRequestBytes)).toBe(true);
  for (const request of requests) {
    const context: unknown = JSON.parse(String(request.state.conversation));
    expect(context).toMatchObject({ previousState: { truncated: true } });
    expect(request.questions).not.toHaveProperty("inline_t0");
  }
});

test("unmasked tool output also participates and its original call/result stay coherent", async () => {
  const f = await fixture();
  f.manager.appendMessage({ role: "assistant", content: [{ type: "toolCall", id: "raw-call", name: "read", arguments: { path: "approved.txt" } }], api: "openai-responses", provider: "test", model: "test", usage, stopReason: "toolUse", timestamp: 3 });
  const text = "Approved value: æøå-42";
  f.manager.appendMessage({ role: "toolResult", toolName: "read", toolCallId: "raw-call", content: [{ type: "text", text }], timestamp: 4, isError: false });
  const input = { ...f.input, branch: f.manager.getBranch(), messages: f.manager.buildSessionProjection().messages };
  const requests: ClassifierRequest[] = [];
  const result = await classifyCompaction(input, settings, { artifactRoot: f.root, classify: async request => { requests.push(request); return answer(request, name => name === "reference_r0" ? 1 : 0); } });
  expect(result.kind).toBe("retained"); expect(JSON.stringify(requests)).toContain(text);
  const saved = result.savedItems?.find(item => item.toolName === "read"); if (!saved) throw Error("Missing raw tool-output archive");
  expect(await readFile(saved.path, "utf8")).toBe(text);
  expect(result.text).toContain("approved.txt"); expect(result.text).toContain(saved.path);
  expect(result.text).not.toContain(text);
});

test("text decisions reuse identical evidence but changing the current task invalidates reuse", async () => {
  const f = await fixture(), cache = new ClassifierDecisionCache(); let calls = 0;
  const dependencies = { artifactRoot: f.root, cache, classify: async (request: ClassifierRequest) => { calls++; return answer(request); } };
  const first = await classifyCompaction(f.input, settings, dependencies);
  const again = await classifyCompaction(f.input, settings, dependencies);
  expect(first.kind).toBe("retained"); expect(again.cacheHits).toBe(1); expect(calls).toBe(1);
  expect(again.usage).toBeUndefined();
  await classifyCompaction({ ...f.input, taskContext: "Recover the earlier investigation instead." }, settings, dependencies);
  expect(calls).toBe(2);
});

test("invalid text decisions do not populate the cache and originals survive cancellation", async () => {
  const f = await fixture(), cache = new ClassifierDecisionCache();
  const invalid = await classifyCompaction(f.input, settings, { artifactRoot: f.root, cache, classify: async request => answer(request, () => NaN) });
  expect(invalid.reason).toBe("invalid-classifier-answer");
  const controller = new AbortController(); let calls = 0;
  const cancelled = await classifyCompaction(f.input, settings, { artifactRoot: f.root, cache, classify: async request => { calls++; controller.abort(); return answer(request); } }, controller.signal);
  expect(calls).toBe(1); expect(cancelled.cacheHits).toBe(0);
  expect(cancelled.reason).toBe("aborted"); expect(cancelled.usage?.input).toBe(10);
  for (const item of cancelled.savedItems ?? []) expect(await readFile(item.path, "utf8")).toBeTruthy();
});

test("symlinked conversation artifacts fail closed before any provider request", async () => {
  const f = await fixture();
  const first = await classifyCompaction(f.input, settings, { artifactRoot: f.root, classify: async request => answer(request) });
  const saved = first.savedItems?.[0]; if (!saved) throw Error("Missing prose archive");
  const outside = join(f.root, "outside.txt"); await writeFile(outside, "Forbidden external text", { mode: 0o600 });
  await rm(saved.path); await symlink(outside, saved.path);
  let calls = 0;
  const second = await classifyCompaction(f.input, settings, { artifactRoot: f.root, classify: async request => { calls++; return answer(request); } });
  expect(second.reason).toBe("conversation-archive-failed"); expect(calls).toBe(0);
  expect(await readFile(outside, "utf8")).toBe("Forbidden external text");
});

test("the live hook commits text-only compaction and pruned prose remains available through recall", async () => {
  const f = await fixture();
  const kept = f.manager.appendMessage({ role: "user", content: "Protected recent tail", timestamp: 5 });
  type Handler = (event: SessionBeforeCompactEvent, ctx: ExtensionContext) => Promise<SessionBeforeCompactResult | undefined>;
  let handler: Handler | undefined; let nativeCalls = 0;
  const api = { on: (_event: string, fn: Handler) => { handler = fn; }, appendEntry: (type: string, data: unknown) => { f.manager.appendCustomEntry(type, data); } } as unknown as Pick<ExtensionAPI, "on" | "appendEntry">;
  registerClassifierCompaction(api, { settings: () => settings, artifactRoot: () => f.root, compact: async () => { nativeCalls++; throw Error("Native fallback must not run"); } });
  const ctx = { hasUI: false, sessionManager: f.manager, modelRegistry: { getModelOfType: () => ({ id: "synthetic" }), classify: async (_model: unknown, request: ClassifierRequest) => answer(request) } } as unknown as ExtensionContext;
  const event = { type: "session_before_compact", signal: new AbortController().signal, reason: "manual", willRetry: false, branchEntries: f.manager.getBranch(), preparation: { firstKeptEntryId: kept, messagesToSummarize: [...f.input.messages], turnPrefixMessages: [], isSplitTurn: false, tokensBefore: 10_000, fileOps: { read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() }, settings: { enabled: true, reserveTokens: 1000, keepRecentTokens: 10 } } } satisfies SessionBeforeCompactEvent;
  if (!handler) throw Error("Missing hook"); const result = await handler(event, ctx);
  expect(nativeCalls).toBe(0); expect(result?.compaction?.firstKeptEntryId).toBe(kept);
  if (!result?.compaction) throw Error("Missing accepted compaction");
  f.manager.appendCompaction(result.compaction.summary, kept, 10_000, result.compaction.details);
  const active = JSON.stringify(f.manager.buildSessionProjection().messages);
  expect(active).toContain("Protected recent tail"); expect(active).not.toContain("Obsolete background");
  const recalled = await recallSaved(f.manager.getBranch(), f.root, "Obsolete background");
  expect(recalled.text).toContain("Obsolete background"); expect(recalled.skipped).toBe(0);
});

test("recall rejects a content-addressed archive whose file no longer matches its snapshot", async () => {
  const f = await fixture();
  const result = await classifyCompaction(f.input, settings, { artifactRoot: f.root, classify: async request => answer(request) });
  f.manager.appendCustomEntry("context-masking", { items: result.savedItems });
  const item = result.savedItems?.[0]; if (!item) throw Error("Missing text archive");
  await writeFile(item.path, "Leaked external content");
  const recalled = await recallSaved(f.manager.getBranch(), f.root, "Leaked external content");
  expect(recalled.skipped).toBe(1);
  expect(recalled.text).not.toContain("Leaked external content");
});
