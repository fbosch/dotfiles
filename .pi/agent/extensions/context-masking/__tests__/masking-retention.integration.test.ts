import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  convertToLlm,
  SessionManager,
  type BeforeAgentStartEvent,
  type BeforeAgentStartEventResult,
  type ExtensionAPI,
  type ExtensionContext,
  type SessionBoundaryDraft,
  type SessionStartEvent,
  type TurnEndEvent,
  type TurnEndEventResult,
} from "@earendil-works/pi-coding-agent";
import { CUSTOM_TYPE, registerContextMasking } from "../index";
import { buildIndex } from "../artifact-index";
import { DEFAULT_SETTINGS, MARKER, type MaskingSettings } from "../policy";
import { ROLLING_LIMITS, type RollingClassifierRequest, type RollingClassifierResponse } from "../masking-retention";
import { recallSaved, registerRecallPrefetch } from "../recall";
import { recallableTextArchiveRecords, savedItems } from "../evidence-archive";
import { CLASSIFIER_DEFAULTS, classifyCompaction } from "../classifier-compaction";
import { userStartEvent } from "../../shared/__tests__/agent-start-events";
import { sessionWith } from "./fixtures";

type Dependencies = NonNullable<Parameters<typeof registerContextMasking>[1]>;
type Classifier = NonNullable<Dependencies["classify"]>;
type Handler = (event: TurnEndEvent, ctx: ExtensionContext) => Promise<TurnEndEventResult | undefined>;
const body = "audit-line æøå\n".repeat(1_000);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function response(request: RollingClassifierRequest, probability = 0): RollingClassifierResponse {
  return {
    api: "typesafe-system-one",
    provider: "test",
    model: "test",
    timestamp: 0,
    stopReason: "stop",
    answers: Object.fromEntries(Object.keys(request.questions).map(id => [
      id, { type: "bool" as const, probability },
    ])),
  };
}

function deferred<T>() {
  let complete: ((value: T) => void) | undefined;
  const promise = new Promise<T>(resolve => { complete = resolve; });
  return {
    promise,
    resolve(value: T) {
      if (!complete) throw Error("Deferred promise was not initialized");
      complete(value);
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function customData(result: TurnEndEventResult | undefined, type = "context-masking-rolling") {
  const entry = result?.entries?.find(entry => entry.type === "custom" && entry.customType === type);
  if (entry?.type !== "custom" || !isRecord(entry.data)) throw Error("Missing custom metadata: " + type);
  return entry.data;
}

function edits(result: TurnEndEventResult | undefined) {
  return result?.entries?.filter(entry => entry.type === "context_edit") ?? [];
}

async function harness(options: {
  bodies?: string[];
  args?: Array<Record<string, string> | undefined>;
  settings?: Partial<MaskingSettings>;
  classify?: Classifier;
  missingModel?: boolean;
  deadlineMs?: number;
  longRoot?: boolean;
  archiveFailure?: boolean;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "rolling-mask-integration-"));
  roots.push(root);
  const artifactRoot = options.archiveFailure ? join(root, "not-a-directory") : options.longRoot
    ? join(root, ...Array.from({ length: 4 }, () => "d".repeat(180)))
    : root;
  if (options.archiveFailure) await writeFile(artifactRoot, "owned fixture");
  const bodies = options.bodies ?? [body];
  const fixture = sessionWith([...bodies.map((_, index) => {
    const args = options.args?.[index];
    return args ? { resultChars: 1, args } : { resultChars: 1 };
  }), { resultChars: 5 }]);
  for (const [index, text] of bodies.entries()) {
    const id = fixture.resultIds[index];
    if (!id) throw Error("Missing source fixture");
    fixture.manager.appendContextEdit(id, { content: [{ type: "text", text }] });
  }
  let manager = fixture.manager;
  const controller = new AbortController();
  const calls: RollingClassifierRequest[] = [];
  const handlers = new Map<string, unknown>();
  const pi = {
    on: (name: string, handler: unknown) => {
      handlers.set(name, handler);
      return () => { handlers.delete(name); };
    },
  } satisfies Pick<ExtensionAPI, "on">;
  const settings: MaskingSettings = {
    ...DEFAULT_SETTINGS,
    enabled: true,
    rollingEnabled: true,
    protectRecentTurns: 1,
    minResultChars: 800,
    triggerRatio: 1,
    ...options.settings,
  };
  const classify: Classifier = async (ctx, request, signal) => {
    calls.push(request);
    return options.classify ? options.classify(ctx, request, signal) : response(request);
  };
  registerContextMasking(pi, {
    settings: () => settings,
    artifactRoot: () => artifactRoot,
    ...(options.missingModel ? {} : { classify }),
    ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
  });
  // Mock only handler-used context services; the boundary payload below is SDK-checked.
  const ctx = {
    hasUI: false,
    mode: "print",
    cwd: "/work",
    signal: controller.signal,
    get sessionManager() { return manager; },
    modelRegistry: { getModelOfType: () => undefined },
    getContextUsage: () => undefined,
  } as unknown as ExtensionContext;

  function appendDraft(target: SessionManager, entry: SessionBoundaryDraft) {
    if (entry.type === "context_edit") target.appendContextEdit(entry.targetId, entry.replacement);
    else if (entry.type === "custom") target.appendCustomEntry(entry.customType, entry.data);
    else throw Error("Unexpected rolling boundary draft: " + entry.type);
  }
  async function run(entries: SessionBoundaryDraft[] = []) {
    // The SDK projects earlier handlers’ drafts in a temporary session before invoking us.
    const header = manager.getHeader();
    if (!header) throw Error("Missing session header");
    const preview = SessionManager.inMemory("/work", undefined, [header, ...manager.getBranch()]);
    for (const entry of entries) appendDraft(preview, entry);
    const projection = preview.buildSessionProjection();
    const assistantEntry = projection.entries.slice().reverse().find(entry =>
      entry.messages.some(message => message.role === "assistant")
    );
    const message = assistantEntry?.messages.find(message => message.role === "assistant");
    if (!assistantEntry || !message) throw Error("Missing assistant boundary fixture");
    const lastResult = projection.entries.slice().reverse().find(entry =>
      entry.messages.some(message => message.role === "toolResult")
    );
    const toolResult = lastResult?.messages.find(message => message.role === "toolResult");
    const event: TurnEndEvent = {
      type: "turn_end",
      turnIndex: 1,
      message,
      messageEntryId: assistantEntry.sourceEntry.id,
      toolResults: toolResult ? [toolResult] : [],
      toolResultEntryIds: lastResult ? [lastResult.sourceEntry.id] : [],
      entries,
      continue: false,
      outcome: "completed",
      context: {
        contextEntries: projection.entries,
        contextMessages: projection.messages,
        llmMessages: convertToLlm(projection.messages),
        pendingMessages: [],
        canContinue: false,
      },
    };
    const handler = handlers.get("turn_end");
    if (typeof handler !== "function") throw Error("Missing turn_end registration");
    return (handler as Handler)(event, ctx);
  }
  function commit(result: TurnEndEventResult | undefined) {
    for (const entry of result?.entries ?? []) appendDraft(manager, entry);
  }
  async function reload() {
    const handler = handlers.get("session_start");
    if (typeof handler !== "function") throw Error("Missing lifecycle registration");
    const event: SessionStartEvent = { type: "session_start", reason: "reload" };
    await handler(event, ctx);
  }
  return {
    root, artifactRoot, calls, controller, run, commit, reload,
    get manager() { return manager; },
    resultIds: fixture.resultIds,
    switchSession() { manager = SessionManager.inMemory("/other"); },
  };
}

test("default-off and sub-4k boundaries do not invoke the rolling classifier", async () => {
  const disabled = await harness({ settings: { rollingEnabled: false } });
  expect(await disabled.run()).toBeUndefined();
  expect(disabled.calls).toEqual([]);
  const below = await harness({ bodies: ["æ".repeat(7_998)] });
  expect(await below.run()).toBeUndefined();
  expect(below.calls).toEqual([]);
});

test("the 4k boundary archives current projected bytes and preserves metadata and earlier drafts", async () => {
  const exact = "æ".repeat(8_000);
  const f = await harness({ bodies: [exact] });
  const earlier: SessionBoundaryDraft = { type: "custom", customType: "other", data: { ok: true } };
  const result = await f.run([earlier]);
  expect(f.calls).toHaveLength(1);
  expect(result?.entries?.[0]).toBe(earlier);
  expect(edits(result)).toHaveLength(1);
  const data = customData(result, CUSTOM_TYPE);
  if (!Array.isArray(data.items) || !isRecord(data.items[0])) throw Error("Missing catalog item");
  const item = data.items[0];
  if (typeof item.path !== "string") throw Error("Missing catalog path");
  expect(item.toolName).toBe("read");
  expect(item).not.toHaveProperty("text");
  expect(await readFile(item.path, "utf8")).toBe(exact);
  expect((await stat(item.path)).mode & 0o777).toBe(0o600);
  expect(customData(result)).toMatchObject({
    eligibleTokens: 4_000, pendingTokens: 0, maskedCount: 1, assessedCount: 1,
    usage: { status: "unavailable" },
  });
  f.commit(result);
  const projected = f.manager.buildSessionProjection().entries.find(entry =>
    entry.sourceEntry.id === f.resultIds[0]
  );
  const message = projected?.messages[0];
  expect(message?.role).toBe("toolResult");
  if (message?.role !== "toolResult") throw Error("Masked result lost its role");
  expect(message.toolCallId).toBe("call0");
  expect(message.toolName).toBe("read");
  expect(message.isError).toBe(false);
  expect(message.content[0]?.type === "text" && message.content[0].text.startsWith(MARKER)).toBe(true);
  expect(buildIndex(f.manager.getBranch(), new Set(), () => true)).toContain(item.path);
  expect(f.calls.every(request => Buffer.byteLength(JSON.stringify(request)) <= ROLLING_LIMITS.requestBytes)).toBe(true);
});

test("superseded and old oversized results are masked without classifier calls", async () => {
  const repeated = await harness({
    bodies: ["first listing ".repeat(600), "second listing ".repeat(600)],
    args: [{ command: "ls" }, { command: "ls" }],
    classify: async (_ctx, request) => response(request, 1),
  });
  const superseded = await repeated.run();
  expect(customData(superseded)).toMatchObject({ supersededMaskedCount: 1, maskedCount: 1 });
  expect(repeated.calls.every(request => !(String(repeated.resultIds[0]) in request.questions))).toBe(true);

  const oversizedBody = "oversized log line\n".repeat(ROLLING_LIMITS.requestBytes / 10);
  const turns = ROLLING_LIMITS.oversizedMaskAfterTurns;
  // Each fixture body adds one assistant turn, and the harness appends one final turn.
  const old = await harness({ bodies: [oversizedBody, ...Array.from({ length: turns - 1 }, () => "short")] });
  const masked = await old.run();
  expect(customData(masked)).toMatchObject({ oversizedMaskedCount: 1, maskedCount: 1 });
  expect(old.calls).toEqual([]);

  const young = await harness({ bodies: [oversizedBody, ...Array.from({ length: turns - 2 }, () => "short")] });
  const kept = await young.run();
  expect(edits(kept)).toEqual([]);
  expect(young.calls).toEqual([]);
});

function legacyRollingResult(result: TurnEndEventResult | undefined): TurnEndEventResult {
  if (!result?.entries) throw Error("Missing rolling result");
  return {
    ...result,
    entries: result.entries.map(entry => {
      if (entry.type !== "custom" || entry.customType !== CUSTOM_TYPE) return entry;
      if (!isRecord(entry.data) || !Array.isArray(entry.data.items)) throw Error("Missing catalog");
      return {
        ...entry,
        data: {
          ...entry.data,
          items: entry.data.items.map((item: unknown) => {
            if (!isRecord(item) || typeof item.path !== "string" || typeof item.toolName !== "string")
              throw Error("Missing archive identity");
            return { entryId: basename(item.path, ".txt"), toolName: item.toolName, path: item.path };
          }),
        },
      };
    }),
  };
}

async function assertRecovered(f: Awaited<ReturnType<typeof harness>>, marker: string) {
  const before = JSON.stringify(f.manager.getBranch());
  const record = recallableTextArchiveRecords(f.manager.getBranch()).find(item => item.entryId === f.resultIds[0]);
  expect(record).toBeDefined();
  if (!record) throw Error("Rolling archive lost its source");
  const original = await readFile(record.path, "utf8");
  const metadata = await stat(record.path);
  expect((await recallSaved(f.manager.getBranch(), f.root, "approved audit receipt")).text).toContain(marker);
  expect([...savedItems(f.manager.getBranch())]).toEqual([...savedItems(f.manager.getBranch())]);

  type Prefetch = (event: BeforeAgentStartEvent, ctx: ExtensionContext) => Promise<BeforeAgentStartEventResult | undefined>;
  let prefetch: unknown;
  registerRecallPrefetch({
    on: (_name: string, callback: unknown) => { prefetch = callback; return () => { prefetch = undefined; }; },
  } satisfies Pick<ExtensionAPI, "on">, () => f.root);
  if (typeof prefetch !== "function") throw Error("Missing prefetch registration");
  const prefetched = await (prefetch as Prefetch)(
    userStartEvent("What was the approved audit receipt?"),
    { sessionManager: f.manager } as unknown as ExtensionContext,
  );
  expect(prefetched?.message?.content).toContain(marker);

  const input = {
    sessionId: f.manager.getSessionId(),
    branch: f.manager.getBranch(),
    messages: f.manager.buildSessionProjection().messages,
  };
  // Exercise default bounded recovery and full-content classification of the 4k-token fixture.
  for (const { maxRequestBytes, maxArtifactBytes } of [
    { maxRequestBytes: CLASSIFIER_DEFAULTS.maxRequestBytes, maxArtifactBytes: CLASSIFIER_DEFAULTS.maxArtifactBytes },
    { maxRequestBytes: 64_000, maxArtifactBytes: 64_000 },
  ]) {
    const states: string[] = [];
    const compacted = await classifyCompaction(input, {
      ...CLASSIFIER_DEFAULTS, enabled: true, minFreedRatio: 0, maxRequestBytes, maxArtifactBytes,
    }, {
      artifactRoot: f.root,
      deferReduction: true,
      classify: async request => {
        states.push(JSON.stringify(request.state));
        return response(request);
      },
    });
    expect(compacted.kind).toBe("retained");
    expect(compacted.artifactBytes).toBeGreaterThanOrEqual(Math.min(Buffer.byteLength(original), maxArtifactBytes));
    expect(compacted.decisions.some(decision => decision.path === record.path)).toBe(true);
    if (maxArtifactBytes >= Buffer.byteLength(original)) expect(states.some(state => state.includes(marker))).toBe(true);
  }
  expect(await readFile(record.path, "utf8")).toBe(original);
  expect((await stat(record.path)).mtimeMs).toBe(metadata.mtimeMs);
  expect(JSON.stringify(f.manager.getBranch())).toBe(before);
}

for (const legacy of [false, true]) {
  test((legacy ? "existing" : "new") + " rolling archives recover through recall, prefetch, and compaction", async () => {
    const marker = "approval_æøå=rolling-original";
    const f = await harness({ bodies: ["Approved audit receipt: " + marker + "\n" + body] });
    const result = await f.run();
    f.commit(legacy ? legacyRollingResult(result) : result);
    await assertRecovered(f, marker);
  });
}

for (const legacy of [false, true]) {
  test((legacy ? "existing" : "new") + " shared archive bytes retain every source identity", async () => {
    const f = await harness({ bodies: [body, body] });
    const result = await f.run();
    f.commit(legacy ? legacyRollingResult(result) : result);
    const ids = f.resultIds.slice(0, 2);
    const records = recallableTextArchiveRecords(f.manager.getBranch()).filter(item => ids.includes(item.entryId));
    expect(records.map(item => item.entryId).sort()).toEqual(ids.sort());
    expect(new Set(records.map(item => item.path)).size).toBe(1);
    expect((await recallSaved(f.manager.getBranch(), f.root, "audit-line")).skipped).toBe(0);
  });
}

for (const missing of ["audit", "mask", "digest", "tool"] as const) {
  test("existing rolling recovery requires matching committed " + missing + " evidence", async () => {
    const f = await harness();
    const result = legacyRollingResult(await f.run());
    if (!result.entries) throw Error("Missing drafts");
    result.entries = result.entries.filter(entry =>
      !(missing === "audit" && entry.type === "custom" && entry.customType === "context-masking-rolling") &&
      !(missing === "mask" && entry.type === "context_edit")
    ).map(entry => {
      if (entry.type !== "custom" || !isRecord(entry.data)) return entry;
      if (missing === "digest" && entry.customType === "context-masking-rolling")
        return { ...entry, data: { ...entry.data, assessments: [{ sourceId: f.resultIds[0], bodyDigest: "0".repeat(64) }] } };
      if (missing === "tool" && entry.customType === CUSTOM_TYPE && Array.isArray(entry.data.items))
        return { ...entry, data: { ...entry.data, items: entry.data.items.map((item: unknown) =>
          isRecord(item) ? { ...item, toolName: "bash" } : item
        ) } };
      return entry;
    });
    f.commit(result);
    expect(recallableTextArchiveRecords(f.manager.getBranch())).toEqual([]);
  });
}

test("earlier context edits select and archive the preview bytes rather than committed bytes", async () => {
  const f = await harness();
  const sourceId = f.resultIds[0];
  if (!sourceId) throw Error("Missing result");
  const exact = "Earlier handler approval: æøå\n" + body;
  const earlier: SessionBoundaryDraft = {
    type: "context_edit", targetId: sourceId, replacement: { content: [{ type: "text", text: exact }] },
  };
  const result = await f.run([earlier]);
  expect(result?.entries?.[0]).toBe(earlier);
  expect(f.calls).toHaveLength(1);
  const item = customData(result, CUSTOM_TYPE).items;
  if (!Array.isArray(item) || !isRecord(item[0]) || typeof item[0].path !== "string")
    throw Error("Missing preview archive");
  expect(await readFile(item[0].path, "utf8")).toBe(exact);
});

test("kept assessments persist only after a boundary commit and are scoped to the body digest", async () => {
  const f = await harness({ classify: async (_ctx, request) => response(request, 1) });
  const first = await f.run();
  expect(edits(first)).toEqual([]);
  const second = await f.run();
  expect(f.calls).toHaveLength(2);
  f.commit(second);
  expect(await f.run()).toBeUndefined();
  expect(f.calls).toHaveLength(2);
  const id = f.resultIds[0];
  if (!id) throw Error("Missing result");
  f.manager.appendContextEdit(id, { content: [{ type: "text", text: body + "changed\n" }] });
  expect(customData(await f.run()).keptCount).toBe(1);
  expect(f.calls).toHaveLength(3);
});

for (const mode of ["missing", "unknown", "invalid", "failed"] as const) {
  test("retains complete text for " + mode + " classifier results", async () => {
    const f = await harness({ classify: async (_ctx, request) => {
      if (mode === "failed") throw Error("Classifier unavailable");
      const result = response(request);
      if (mode === "missing") result.answers = {};
      if (mode === "unknown") result.answers = { unexpected: { type: "bool", probability: 0 } };
      if (mode === "invalid") {
        for (const key of Object.keys(result.answers))
          result.answers[key] = { type: "bool", probability: Number.NaN };
      }
      return result;
    } });
    const result = await f.run();
    expect(edits(result)).toEqual([]);
    expect(customData(result)).toMatchObject({ maskedCount: 0, assessedCount: 0, deferredCount: 1 });
  });
}

test("missing models and unrepresentable latest directions remain deferred", async () => {
  const missing = await harness({ missingModel: true });
  expect(edits(await missing.run())).toEqual([]);
  expect(missing.calls).toEqual([]);
  const image = await harness();
  image.manager.appendMessage({
    role: "user",
    content: [{ type: "image", data: "AA==", mimeType: "image/png" }],
    timestamp: 10,
  });
  const result = await image.run();
  expect(image.calls).toEqual([]);
  expect(customData(result)).toMatchObject({ requestCount: 0, deferredCount: 1 });
});

test("archive failures retain unassessed originals", async () => {
  const f = await harness({ archiveFailure: true });
  const result = await f.run();
  expect(edits(result)).toEqual([]);
  expect(customData(result)).toMatchObject({ maskedCount: 0, assessedCount: 0, deferredCount: 1 });
  expect(await stat(f.artifactRoot).then(info => info.isFile())).toBe(true);
});

test("the overall deadline settles a classifier that ignores its signal", async () => {
  const f = await harness({ deadlineMs: 5, classify: () => new Promise(() => {}) });
  expect(await f.run()).toBeUndefined();
});

for (const mutation of ["leaf", "session", "reload", "abort"] as const) {
  test("late results cannot apply after " + mutation, async () => {
    const started = deferred<RollingClassifierRequest>();
    const completed = deferred<RollingClassifierResponse>();
    const f = await harness({ classify: (_ctx, request) => {
      started.resolve(request);
      return completed.promise;
    } });
    const pending = f.run();
    const request = await started.promise;
    if (mutation === "leaf") f.manager.appendMessage({ role: "user", content: "Changed direction", timestamp: 1 });
    if (mutation === "session") f.switchSession();
    if (mutation === "reload") await f.reload();
    if (mutation === "abort") f.controller.abort();
    completed.resolve(response(request));
    expect(await pending).toBeUndefined();
  });
}

test("minimum savings uses signed net growth across the full proposed batch", async () => {
  const f = await harness({
    bodies: [body, ...Array.from({ length: 20 }, () => "short evidence\n")],
    settings: { minResultChars: 1 },
    longRoot: true,
  });
  const result = await f.run();
  expect(f.calls.length).toBeGreaterThan(0);
  expect(f.calls.length).toBeLessThanOrEqual(ROLLING_LIMITS.maxRequests);
  expect(edits(result)).toEqual([]);
  expect(customData(result).estimatedSavedTokens).toBe(0);
});
