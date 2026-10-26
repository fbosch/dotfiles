import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { compact, ExtensionAPI, ExtensionContext, SessionBeforeCompactEvent, SessionBeforeCompactResult } from "@earendil-works/pi-coding-agent";
import { CLASSIFIER_DEFAULTS, classifyCompaction, type ClassifierRequest, type ClassifierResponse, type CompactionInput } from "../classifier-compaction";
import { ClassifierDecisionCache } from "../classifier-cache";
import { parseClassifierSettings, registerClassifierCompaction } from "../classifier-hook";
import { HYBRID_CHECKPOINT, isHybridCheckpoint, prepareHybridSummary, restoreCheckpointFiles } from "../hybrid-summary";
import { placeholder } from "../policy";
import { sessionWith } from "./fixtures";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const settings = { ...CLASSIFIER_DEFAULTS, enabled: true, mode: "hybrid" as const, maxOutputBytes: 1 };
const usage = { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 10,
  cost: { input: 0.01, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 } };
function answer(request: ClassifierRequest, value: (key: string) => number = () => 0.9): ClassifierResponse {
  return { api: "typesafe-system-one", provider: "test", model: "test", stopReason: "stop", timestamp: 0, usage,
    answers: Object.fromEntries(Object.keys(request.questions).map(key => [key, { type: "bool", probability: value(key) }])) };
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "hybrid-test-")); roots.push(root);
  const { manager, resultIds } = sessionWith([{ resultChars: 1000, args: { path: "approved.txt" } }, { resultChars: 1000, args: { path: "trace.txt" } }]);
  await mkdir(join(root, manager.getSessionId()));
  const texts = ["Latest approved schema: udtræk_æøå_123", "irrelevant background trace"], paths: string[] = [];
  for (const [i, id] of resultIds.entries()) {
    const path = join(root, manager.getSessionId(), id + ".txt"), text = texts[i] ?? "";
    await writeFile(path, text); paths.push(path);
    manager.appendContextEdit(id, { content: [{ type: "text", text: placeholder({ entryId: id, toolName: "read", text }, path) }] });
  }
  manager.appendCustomEntry("context-masking", { items: paths.map((path, i) => ({ path, entryId: resultIds[i], toolName: "read" })) });
  manager.appendMessage({ role: "user", content: "Continue the approved migration; preserve Danish exactly.", timestamp: 1 });
  const input: CompactionInput = { branch: manager.getBranch(), messages: manager.buildSessionProjection().messages };
  const preparation: SessionBeforeCompactEvent["preparation"] = {
    firstKeptEntryId: resultIds[0] ?? "", messagesToSummarize: [...input.messages], turnPrefixMessages: [],
    isSplitTurn: false, tokensBefore: 8000, fileOps: { read: new Set(["read-only.ts"]), written: new Set(), edited: new Set(["edited.ts"]) },
    settings: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
  };
  return { root, manager, paths, texts, input, preparation };
}

test("hybrid selects exact relevant evidence with one question each and keeps the native boundary", async () => {
  const f = await fixture(); const requests: ClassifierRequest[] = [];
  const result = await classifyCompaction(f.input, settings, { artifactRoot: f.root, classify: async r => { requests.push(r); return answer(r, k => k === "evidence_r0" ? 0.95 : 0.01); } });
  expect(result.kind).toBe("retained");
  expect(Object.keys(requests[0]?.questions ?? {})).toEqual(["evidence_r0", "evidence_r1"]);
  expect(result.decisions.map(d => d.action)).toEqual(["inline", "omit"]);
  const p = prepareHybridSummary({ ...f.preparation, isSplitTurn: true }, result.evidence, settings.maxSummaryInputBytes);
  expect(p?.firstKeptEntryId).toBe(f.preparation.firstKeptEntryId);
  expect(p?.tokensBefore).toBe(8000);
  expect(p?.fileOps).toBe(f.preparation.fileOps);
  expect(p?.turnPrefixMessages).toEqual([]);
  expect(JSON.stringify(p?.messagesToSummarize)).toContain("udtræk_æøå_123");
  expect(JSON.stringify(p?.messagesToSummarize)).toContain("Continue the approved migration");
  expect(JSON.stringify(p?.messagesToSummarize)).not.toContain("trace.txt");
  for (const [i, path] of f.paths.entries()) {
    const expected = f.texts[i];
    if (expected === undefined) throw Error("Missing fixture text");
    expect(await readFile(path, "utf8")).toBe(expected);
  }
});

test("uncertain and partial evidence stays available rather than being silently omitted", async () => {
  const f = await fixture();
  const result = await classifyCompaction(f.input, { ...settings, maxArtifactBytes: 12 }, { artifactRoot: f.root, classify: async r => answer(r, () => 0) });
  expect(result.kind).toBe("retained");
  expect(result.requestBytes).toEqual([]);
  expect(result.evidence.every(e => e.partial && e.action === "reference")).toBe(true);
  const p = prepareHybridSummary(f.preparation, result.evidence, settings.maxSummaryInputBytes);
  expect(JSON.stringify(p)).toContain("partial excerpt");
  const uncertain = await classifyCompaction(f.input, settings, { artifactRoot: f.root, classify: async r => answer(r, () => 0.4) });
  expect(uncertain.decisions.every(d => d.action === "inline")).toBe(true);
});

test("exact task/evidence reuse avoids provider requests and does not charge cached usage again", async () => {
  const f = await fixture(), cache = new ClassifierDecisionCache(); let calls = 0;
  const deps = { artifactRoot: f.root, cache, classify: async (r: ClassifierRequest) => { calls++; return answer(r); } };
  const first = await classifyCompaction(f.input, settings, deps), second = await classifyCompaction(f.input, settings, deps);
  expect(calls).toBe(1); expect(first.usage?.totalTokens).toBe(10);
  expect(second.requestBytes).toEqual([]); expect(second.cacheHits).toBe(1);
  expect(second.usage).toBeUndefined(); expect(second.usageComplete).toBe(true);
  expect(second.evidence).toEqual(first.evidence);
  await classifyCompaction({ ...f.input, instructions: "Investigate an earlier proposal instead." }, settings, deps);
  await classifyCompaction({ ...f.input, previousSummary: "The task constraints changed." }, settings, deps);
  await classifyCompaction(f.input, { ...settings, model: "another-model" }, deps);
  await writeFile(f.paths[0] ?? "", "Revised approval: udtræk_æøå_456");
  await classifyCompaction(f.input, settings, deps);
  expect(calls).toBe(5);
});

test("invalid or aborted responses do not populate reusable decisions", async () => {
  const f = await fixture(), cache = new ClassifierDecisionCache(), controller = new AbortController(); let calls = 0;
  const aborted = await classifyCompaction(f.input, settings, { artifactRoot: f.root, cache, classify: async r => { controller.abort(); return answer(r); } }, controller.signal);
  expect(aborted.reason).toBe("aborted"); expect(aborted.usage?.totalTokens).toBe(10);
  const invalid = await classifyCompaction(f.input, settings, { artifactRoot: f.root, cache, classify: async r => answer(r, () => NaN) });
  expect(invalid.reason).toBe("invalid-classifier-answer");
  const next = await classifyCompaction(f.input, settings, { artifactRoot: f.root, cache, classify: async r => { calls++; return answer(r); } });
  expect(calls).toBe(1); expect(next.cacheHits).toBe(0);
});

test("cache is bounded and returns detached responses without historical usage", () => {
  const cache = new ClassifierDecisionCache(1), request: ClassifierRequest = { state: {}, questions: {} };
  const response = answer(request);
  cache.set("first", request, response);
  expect(cache.get("first", request)?.usage).toBeUndefined();
  cache.set("second", request, response);
  expect(cache.get("first", request)).toBeUndefined();
  expect(cache.get("second", request)?.stopReason).toBe("stop");
});

test("hybrid configuration is opt-in and rejects unsafe or malformed settings", () => {
  expect(parseClassifierSettings(undefined).mode).toBe("extractive");
  expect(parseClassifierSettings({ contextClassifierCompaction: { mode: "hybrid" } }).mode).toBe("hybrid");
  expect(() => parseClassifierSettings({ contextClassifierCompaction: { mode: "other" } })).toThrow();
  expect(() => parseClassifierSettings({ contextClassifierCompaction: { maxSummaryInputBytes: 100001 } })).toThrow();
});

test("read/summary bounds fail before further model work and leave files intact", async () => {
  const f = await fixture(); let calls = 0;
  const deps = { artifactRoot: f.root, classify: async (r: ClassifierRequest) => { calls++; return answer(r); } };
  const readBound = await classifyCompaction(f.input, { ...settings, maxTotalArtifactBytes: 1 }, deps);
  expect(readBound.reason).toBe("artifact-read-budget"); expect(calls).toBe(0);
  const historyBound = await classifyCompaction({ ...f.input, previousSummary: "x".repeat(30000) }, settings, deps);
  expect(historyBound.reason).toBe("conversation-request-limit"); expect(calls).toBe(0);
  expect(prepareHybridSummary(f.preparation, [], 1)).toBeUndefined();
  expect(restoreCheckpointFiles(f.preparation, f.manager.getBranch())).toBe(f.preparation);
});

test("hybrid hook invokes native summarization on selected facts and accounts fresh classifier usage", async () => {
  const f = await fixture(); let handler: ((event: SessionBeforeCompactEvent, ctx: ExtensionContext) => Promise<SessionBeforeCompactResult | undefined>) | undefined;
  let captured: SessionBeforeCompactEvent["preparation"] | undefined;
  const records: unknown[] = [];
  const api = { on: (_event: string, fn: typeof handler) => { handler = fn; }, appendEntry: (_type: string, data: unknown) => records.push(data) } as unknown as Pick<ExtensionAPI, "on" | "appendEntry">;
  const native: typeof compact = async (...args) => {
    captured = args[0];
    return { summary: "Working summary: schema udtræk_æøå_123", firstKeptEntryId: args[0].firstKeptEntryId, tokensBefore: args[0].tokensBefore,
      usage: { ...usage, input: 20, totalTokens: 20 }, details: { readFiles: ["read-only.ts"], modifiedFiles: ["edited.ts"] } };
  };
  registerClassifierCompaction(api, { settings: () => settings, artifactRoot: () => f.root,
    globalSettings: () => ({ compactionModel: { model: "test/summary", thinkingLevel: "off" } }), compact: native });
  const ctx = { hasUI: false, sessionManager: f.manager,
    modelRegistry: { getModelOfType: () => ({ id: "test" }), find: () => ({ id: "summary" }),
      classify: async (_model: unknown, r: ClassifierRequest) => answer(r, k => k === "evidence_r0" ? 0.95 : 0.01) } } as unknown as ExtensionContext;
  const event = { type: "session_before_compact", preparation: f.preparation, branchEntries: f.manager.getBranch(), reason: "manual", willRetry: false, signal: new AbortController().signal } satisfies SessionBeforeCompactEvent;
  if (!handler) throw Error("Missing handler");
  const result = await handler(event, ctx);
  expect(captured?.firstKeptEntryId).toBe(event.preparation.firstKeptEntryId);
  expect(JSON.stringify(captured)).toContain("udtræk_æøå_123");
  expect(JSON.stringify(captured)).not.toContain("irrelevant background");
  expect(result?.compaction?.usage?.totalTokens).toBe(30);
  expect(isHybridCheckpoint(result?.compaction?.details)).toBe(true);
  expect(result?.compaction?.summary).toContain("Working summary");
  expect(result?.compaction?.summary).toContain("recall");
  expect(records.length).toBe(1);
  expect(JSON.stringify(result?.compaction?.details)).not.toContain("udtræk_æøå_123");
  expect(JSON.stringify(result?.compaction?.details)).toContain("read-only.ts");
  f.manager.appendCompaction(result?.compaction?.summary ?? "", f.preparation.firstKeptEntryId, 8000, result?.compaction?.details, true);
  const restored = restoreCheckpointFiles({ ...f.preparation, fileOps: { read: new Set(), edited: new Set(), written: new Set() } }, f.manager.getBranch());
  expect(restored.fileOps.read.has("read-only.ts")).toBe(true);
  expect(restored.fileOps.edited.has("edited.ts")).toBe(true);
  expect(isHybridCheckpoint({ type: HYBRID_CHECKPOINT, version: 1, artifactIndex: "external" })).toBe(true);
});

test("hybrid checkpoints keep their catalogue external and native fallback file lists survive", async () => {
  const f = await fixture();
  f.manager.appendCompaction("Native fallback", f.preparation.firstKeptEntryId, 8000,
    { readFiles: ["fallback-source.ts"], modifiedFiles: ["fallback-edited.ts"] }, true);
  const restored = restoreCheckpointFiles(f.preparation, f.manager.getBranch());
  expect(restored.fileOps.read.has("fallback-source.ts")).toBe(true);
  expect(restored.fileOps.edited.has("fallback-edited.ts")).toBe(true);
  f.manager.appendCompaction("Working facts", f.preparation.firstKeptEntryId, 8000,
    { type: HYBRID_CHECKPOINT, version: 1, artifactIndex: "external", readFiles: [], modifiedFiles: [] }, true);
  type ContextHandler = (event: import("@earendil-works/pi-coding-agent").ContextEvent,
    ctx: ExtensionContext) => Promise<import("@earendil-works/pi-coding-agent").ContextEventResult | undefined>;
  let handler: ContextHandler | undefined;
  const { registerContextMasking } = await import("../index");
  const { DEFAULT_SETTINGS } = await import("../policy");
  registerContextMasking({ on: (name: string, fn: ContextHandler) => { if (name === "context") handler = fn; } } as unknown as Pick<ExtensionAPI, "on">,
    { settings: () => DEFAULT_SETTINGS, artifactRoot: () => f.root });
  if (!handler) throw Error("Missing context hook");
  const ctx = { sessionManager: f.manager } as unknown as ExtensionContext;
  expect(await handler({ type: "context", messages: [] }, ctx)).toBeUndefined();
  for (const [i, path] of f.paths.entries()) expect(await readFile(path, "utf8")).toBe(f.texts[i] ?? "");
});
