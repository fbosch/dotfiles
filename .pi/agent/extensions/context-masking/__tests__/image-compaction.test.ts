import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, type ContextEvent, type ContextEventResult, type ExtensionAPI, type ExtensionContext, type SessionBeforeCompactEvent, type SessionBeforeCompactResult } from "@earendil-works/pi-coding-agent";
import { CLASSIFIER_DEFAULTS, classifyCompaction, type ClassifierRequest, type ClassifierResponse } from "../classifier-compaction";
import { ClassifierDecisionCache } from "../classifier-cache";
import { registerClassifierCompaction } from "../classifier-hook";
import { IMAGE_ARCHIVE, checkpointImages } from "../evidence-archive";
import { IMAGE_CONTEXT, RETENTION_GOAL, registerImageContext } from "../image-retention";
import { recallImages } from "../image-recall";
import { placeholder } from "../policy";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const pixels = (color = "blue") => execFileSync("/run/current-system/sw/bin/magick", ["-size", "720x131", `xc:${color}`, "png:-"]).toString("base64");
const settings = { ...CLASSIFIER_DEFAULTS, enabled: true };
const usage = { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: { input: 0.001, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.001 } };
function answer(request: ClassifierRequest, probability: (name: string) => number): ClassifierResponse {
  return { api: "typesafe-system-one", provider: "test", model: "test", stopReason: "stop", timestamp: 1, usage,
    answers: Object.fromEntries(Object.keys(request.questions).map(name => [name, { type: "bool", probability: name.startsWith("inline_t") ? 1 : probability(name) }])) };
}
async function fixture(count = 1, mixed = true) {
  const root = await mkdtemp(join(tmpdir(), "image-compaction-")); roots.push(root);
  const manager = SessionManager.inMemory(root);
  const sessionId = manager.getSessionId();
  const originals = Array.from({ length: count }, (_, i) => pixels(["blue", "red", "green"][i % 3]));
  manager.appendMessage({ role: "user", timestamp: 1, content: [{ type: "text", text: "Compare the chart evidence and preserve Danish æøå. The numeric table already describes the red chart." }, ...originals.map(data => ({ type: "image" as const, data, mimeType: "image/png" }))] });
  if (mixed) {
    manager.appendMessage({ role: "assistant", content: [{ type: "toolCall", id: "call1", name: "read", arguments: { path: "routine.txt" } }], api: "openai-responses", provider: "test", model: "test", usage, stopReason: "toolUse", timestamp: 2 });
    const text = "Routine unrelated output.\n".repeat(200);
    const entryId = manager.appendMessage({ role: "toolResult", toolName: "read", toolCallId: "call1", content: [{ type: "text", text }], isError: false, timestamp: 3 });
    const path = join(root, sessionId, `${entryId}.txt`);
    await mkdir(join(root, sessionId), { mode: 0o700 });
    await writeFile(path, text);
    manager.appendContextEdit(entryId, { content: [{ type: "text", text: placeholder({ entryId, toolName: "read", text }, path) }] });
    manager.appendCustomEntry("context-masking", { items: [{ entryId, toolName: "read", path }] });
  }
  const keptId = manager.appendMessage({ role: "user", content: "Recent tail", timestamp: 4 });
  const input = { sessionId, branch: manager.getBranch(), messages: manager.buildSessionProjection().messages.slice(0, -1), previousSummary: "Preserve the decision identifiers and æøå.", instructions: "Prioritize chart evidence for the current comparison." };
  return { root, manager, originals, input, keptId };
}

test("images and text share the goal and evidence; keep/reference/prune never delete originals", async () => {
  const f = await fixture(3);
  const requests: ClassifierRequest[] = [];
  const result = await classifyCompaction(f.input, settings, { artifactRoot: f.root, classify: async request => {
    requests.push(request);
    return answer(request, name => name === "inline_i1" || name === "reference_i0" ? 1 : 0);
  } });
  expect(result.kind).toBe("retained");
  expect(requests).toHaveLength(2);
  for (const request of requests) {
    expect(request.state.goal).toBe(RETENTION_GOAL);
    expect(request.images).toHaveLength(3);
    expect(JSON.stringify(request.state)).toContain("Prioritize chart evidence");
  }
  expect(result.images?.map(image => image.action)).toEqual(["reference", "inline", "omit"]);
  expect(result.text).toContain("æøå");
  for (const [index, image] of (result.images ?? []).entries()) {
    expect(f.originals[index]).toBe((await readFile(image.path)).toString("base64"));
    if (image.action === "omit") expect(result.text).not.toContain(image.path);
    else expect(result.text).toContain(image.path);
  }
  expect(result.requestBytes.every(size => size <= 1_000_000)).toBe(true);
  expect(result.usage?.input).toBe(20);
});

test("a malformed image between valid originals does not prevent later image decisions", async () => {
  const f = await fixture(3, false);
  const messages = f.input.messages.map(message => {
    if (message.role !== "user" || typeof message.content === "string") return message;
    return { ...message, content: [...message.content.slice(0, 2),
      { type: "image" as const, data: "AA==", mimeType: "image/png" },
      ...message.content.slice(2)] };
  });
  const requests: ClassifierRequest[] = [];
  const result = await classifyCompaction({ ...f.input, messages }, settings, { artifactRoot: f.root, classify: async request => {
    requests.push(request);
    return answer(request, name => name === "inline_i1" || name === "reference_i0" ? 1 : 0);
  } });
  expect(result.kind).toBe("retained");
  const first = result.images?.[0];
  if (!first) throw Error("Missing retained image");
  expect(result.skippedImages).toEqual([{ entryId: first.entryId, blockIndex: 2 }]);
  expect(result.images?.map(image => image.blockIndex)).toEqual([1, 3, 4]);
  expect(result.images?.map(image => image.action)).toEqual(["reference", "inline", "omit"]);
  expect(requests.every(request => request.images?.length === 3)).toBe(true);
  for (const [index, image] of (result.images ?? []).entries()) {
    const original = f.originals[index];
    if (!original) throw Error("Missing original pixels");
    expect((await readFile(image.path)).toString("base64")).toBe(original);
  }
});

test("more than four images stay inline while text compaction avoids unsupported image input", async () => {
  const f = await fixture(5);
  const requests: ClassifierRequest[] = [];
  const result = await classifyCompaction(f.input, settings, { artifactRoot: f.root, classify: async request => {
    requests.push(request);
    if ((request.images?.length ?? 0) > 4) return { ...answer(request, () => 0), stopReason: "error", errorMessage: "Invalid classifier image input" };
    return answer(request, () => 0);
  } });

  expect(result.kind).toBe("retained");
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every(request => request.images === undefined)).toBe(true);
  expect(result.images).toHaveLength(5);
  for (const [index, image] of (result.images ?? []).entries()) {
    expect(image).toMatchObject({ action: "inline", forced: true });
    const original = f.originals[index];
    if (original === undefined) throw Error("Missing original image");
    expect((await readFile(image.path)).toString("base64")).toBe(original);
  }
});

test("four images still receive shared text and pixel decisions", async () => {
  const f = await fixture(4);
  const requests: ClassifierRequest[] = [];
  const result = await classifyCompaction(f.input, settings, { artifactRoot: f.root, classify: async request => {
    requests.push(request);
    return answer(request, name => name === "inline_i3" || name.startsWith("reference_i") ? 1 : 0);
  } });

  expect(result.kind).toBe("retained");
  expect(requests).toHaveLength(2);
  expect(requests.every(request => request.images?.length === 4)).toBe(true);
  expect(result.images?.map(image => image.action)).toEqual(["reference", "reference", "reference", "inline"]);
});

test("later referenced images stay inline once older pixels are kept; omitted images stay omitted", async () => {
  const f = await fixture(4);
  const result = await classifyCompaction(f.input, settings, { artifactRoot: f.root, classify: async request =>
    answer(request, name => name === "inline_i1" || name === "reference_i0" || name === "reference_i2" ? 1 : 0) });

  expect(result.kind).toBe("retained");
  expect(result.images?.map(image => [image.action, image.forced])).toEqual([
    ["reference", false], ["inline", false], ["inline", true], ["omit", false],
  ]);
  expect(result.text).not.toContain(result.images?.[3]?.path ?? "missing");
});

test("other classifier models keep multimodal image decisions beyond four", async () => {
  const f = await fixture(5);
  const requests: ClassifierRequest[] = [];
  const result = await classifyCompaction(f.input, { ...settings, model: "another-model" }, {
    artifactRoot: f.root,
    classify: async request => { requests.push(request); return answer(request, () => 0); },
  });

  expect(result.kind).toBe("retained");
  expect(requests).toHaveLength(2);
  expect(requests.every(request => request.images?.length === 5)).toBe(true);
});

test("image-only sessions compact and uncertain evidence keeps a recoverable reference", async () => {
  const f = await fixture(1, false);
  const result = await classifyCompaction(f.input, settings, { artifactRoot: f.root, classify: async request => answer(request, () => 0.4) });
  expect(result.kind).toBe("retained");
  expect(result.images?.[0]).toMatchObject({ action: "reference", forced: true });
  expect(result.text).toContain("reference; use read");
});

test("identical mixed evidence reuses both decision stages; focus and pixels invalidate reuse", async () => {
  const f = await fixture();
  const cache = new ClassifierDecisionCache();
  let calls = 0;
  const dependencies = { artifactRoot: f.root, cache, classify: async (request: ClassifierRequest) => { calls++; return answer(request, () => 0); } };
  const first = await classifyCompaction(f.input, settings, dependencies);
  const again = await classifyCompaction(f.input, settings, dependencies);
  expect(first.kind).toBe("retained"); expect(again.kind).toBe("retained");
  expect(calls).toBe(2); expect(again.cacheHits).toBe(2); expect(again.usage).toBeUndefined();
  await classifyCompaction({ ...f.input, instructions: "Preserve all diagrams for a visual review." }, settings, dependencies);
  expect(calls).toBe(4);
  const messages = f.input.messages.map(message => message.role === "user" && Array.isArray(message.content)
    ? { ...message, content: message.content.map(block => block.type === "image" ? { ...block, data: pixels("yellow") } : block) } : message);
  await classifyCompaction({ ...f.input, messages }, settings, dependencies);
  expect(calls).toBe(6);
});

test("invalid answers and cancellation preserve files and do not cache image decisions", async () => {
  const f = await fixture(1, false), cache = new ClassifierDecisionCache();
  let calls = 0;
  const dependencies = { artifactRoot: f.root, cache, classify: async (request: ClassifierRequest) => { calls++; return answer(request, () => NaN); } };
  const invalid = await classifyCompaction(f.input, settings, dependencies);
  expect(invalid.reason).toBe("invalid-classifier-answer");
  expect(invalid.images?.[0]).toMatchObject({ action: "inline", forced: true });
  await classifyCompaction(f.input, settings, dependencies); expect(calls).toBe(2);
  const controller = new AbortController();
  const aborted = await classifyCompaction(f.input, settings, { artifactRoot: f.root, classify: async request => { controller.abort(); return answer(request, () => 0); } }, controller.signal);
  expect(aborted.reason).toBe("aborted"); expect(aborted.usage?.input).toBe(10);
  expect(await readFile(aborted.images?.[0]?.path ?? "missing")).toBeDefined();
});

test("bash executions require native fallback rather than losing command output", async () => {
  const f = await fixture(1, false);
  f.input.messages.push({ role: "bashExecution", command: "printf synthetic", output: "Approved flag: blue", exitCode: 0, cancelled: false, truncated: false, timestamp: 5 });
  let calls = 0;
  const result = await classifyCompaction(f.input, settings, { artifactRoot: f.root, classify: async request => { calls++; return answer(request, () => 0); } });
  expect(result.reason).toBe("unsupported-content"); expect(calls).toBe(0);
  expect(result.images?.[0]).toMatchObject({ action: "inline", forced: true });
});

test("image assessment repacks a batch when multimodal context crosses the text cap", async () => {
  const f = await fixture();
  const initial: ClassifierRequest[] = [];
  await classifyCompaction(f.input, settings, { artifactRoot: f.root, classify: async request => {
    initial.push(request);
    return answer(request, () => 1);
  } });
  const assessment = initial[0];
  if (!assessment) throw Error("Missing assessment packet");
  const { images: _images, state: fullState, ...fields } = assessment;
  const { imageContext: _imageContext, ...state } = fullState;
  const coreBytes = Buffer.byteLength(JSON.stringify({ ...fields, state }));
  const textBytes = Buffer.byteLength(JSON.stringify({ ...assessment, images: [] }));
  expect(textBytes).toBeGreaterThan(coreBytes);
  const maxRequestBytes = coreBytes + Math.floor((textBytes - coreBytes) / 2);
  const sent: ClassifierRequest[] = [];
  const result = await classifyCompaction(f.input, { ...settings, maxRequestBytes }, { artifactRoot: f.root, classify: async request => {
    sent.push(request);
    expect(Buffer.byteLength(JSON.stringify({ ...request, images: [] }))).toBeLessThanOrEqual(maxRequestBytes);
    expect(Buffer.byteLength(JSON.stringify(request))).toBeLessThanOrEqual(1_000_000);
    return answer(request, () => 1);
  } });
  expect({ kind: result.kind, reason: result.reason }).toEqual({ kind: "retained", reason: "accepted" });
  expect(sent.length).toBeGreaterThan(initial.length);
  expect(result.images?.[0]?.action).toBe("inline");
  const original = f.originals[0];
  if (!original) throw Error("Missing image source");
  expect((await readFile(result.images?.[0]?.path ?? "missing")).toString("base64")).toBe(original);
});

test("oversized image decision keeps pixels inline without discarding selected hybrid evidence", async () => {
  const f = await fixture();
  const messages = [...f.input.messages, ...[0, 1, 2].map(index => ({
    role: "user" as const, content: `Approved note ${index}: ${"evidence ".repeat(760)}`, timestamp: 10 + index,
  }))];
  const sent: ClassifierRequest[] = [];
  const result = await classifyCompaction({ ...f.input, messages }, { ...settings, mode: "hybrid" }, {
    artifactRoot: f.root, classify: async request => { sent.push(request); return answer(request, () => 1); },
  });
  expect(result.reason).toBe("accepted");
  expect(result.kind).toBe("retained");
  expect(result.text).toContain("Approved note 2");
  expect(result.evidence.length).toBeGreaterThan(0);
  expect(result.imageRequestLimit?.phase).toBe("image-decision");
  expect(result.imageRequestLimit?.textBytes).toBeGreaterThan(settings.maxRequestBytes);
  expect(sent.some(request => Object.hasOwn(request.questions, "inline_i0"))).toBe(false);
  expect(result.images?.[0]?.action).toBe("inline");
  expect(result.images?.[0]?.forced).toBe(true);
  const original = f.originals[0];
  if (!original) throw Error("Missing image source");
  expect((await readFile(result.images?.[0]?.path ?? "missing")).toString("base64")).toBe(original);
});

test("image request and output bounds preserve originals before any lossy checkpoint", async () => {
  const f = await fixture(1, false);
  let calls = 0;
  const bounded = await classifyCompaction(f.input, { ...settings, maxRequestBytes: 100 }, { artifactRoot: f.root, classify: async request => { calls++; return answer(request, () => 1); } });
  expect(bounded.reason).toBe("conversation-request-limit"); expect(calls).toBe(0);
  const output = await classifyCompaction(f.input, { ...settings, maxOutputBytes: 32 }, { artifactRoot: f.root, classify: async request => answer(request, () => 1) });
  expect(output.reason).toBe("output-byte-limit");
  expect(f.originals[0]).toBe((await readFile(output.images?.[0]?.path ?? "missing")).toString("base64"));
});

async function retainedFixture() {
  const f = await fixture(3);
  const result = await classifyCompaction(f.input, settings, { artifactRoot: f.root, classify: async request => answer(request, name => name === "inline_i1" || name === "reference_i0" ? 1 : 0) });
  f.manager.appendCustomEntry(IMAGE_ARCHIVE, { images: result.images });
  f.manager.appendCompaction(result.text, f.keptId, 20_000, { images: result.images });
  return { ...f, result };
}

test("kept images restore after the summary without duplicating or reintroducing pruned images", async () => {
  const f = await retainedFixture();
  type Handler = (event: ContextEvent, ctx: ExtensionContext) => Promise<ContextEventResult | undefined>;
  let handler: Handler | undefined;
  registerImageContext({ on: (_event: string, fn: Handler) => { handler = fn; } } as unknown as Pick<ExtensionAPI, "on">, () => f.root);
  if (!handler) throw Error("Missing image handler");
  const ctx = { hasUI: false, sessionManager: f.manager } as unknown as ExtensionContext;
  const event: ContextEvent = { type: "context", messages: f.manager.buildSessionProjection().messages };
  const restored = await handler(event, ctx);
  const custom = restored?.messages?.find(message => message.role === "custom" && message.customType === IMAGE_CONTEXT);
  if (!custom || custom.role !== "custom" || typeof custom.content === "string") throw Error("Missing restored image message");
  const images = custom.content.filter(block => block.type === "image");
  expect(images).toHaveLength(1); expect(images[0]?.data).toBe(f.originals[1]);
  expect(await handler({ ...event, messages: restored?.messages ?? [] }, ctx)).toBeUndefined();
  const record = checkpointImages(f.manager.getBranch())[1]; if (!record) throw Error("Missing archive");
  await rm(record.path);
  const missing = await handler(event, ctx);
  expect(JSON.stringify(missing?.messages)).toContain("pixels are missing");
  f.manager.appendCompaction("Image metadata checkpoint", f.keptId, 20_000, { images: [{ ...record, path: "/etc/passwd" }] });
  const forged = await handler({ ...event, messages: f.manager.buildSessionProjection().messages }, ctx);
  expect(JSON.stringify(forged?.messages)).not.toContain("/etc/passwd");
});

test("pruned images remain discoverable by source labels through bounded local recall", async () => {
  const f = await retainedFixture();
  const report = await recallImages(f.manager.getBranch(), f.root, f.input.sessionId, "numeric table", 8);
  expect(report.found).toHaveLength(3);
  expect(report.found.some(image => image.action === "omit")).toBe(true);
  const forged = { ...report.found[0], path: "/etc/passwd" };
  f.manager.appendCustomEntry(IMAGE_ARCHIVE, { images: [forged] });
  const guarded = await recallImages(f.manager.getBranch(), f.root, f.input.sessionId, "", 8);
  expect(guarded.text).not.toContain("/etc/passwd"); expect(guarded.skipped).toBe(1);
});

async function runHook(mode: "extractive" | "hybrid", failClassifier = false) {
  const f = await fixture(1, false);
  type Handler = (event: SessionBeforeCompactEvent, ctx: ExtensionContext) => Promise<SessionBeforeCompactResult | undefined>;
  let handler: Handler | undefined;
  let nativeInputHadImages = false, nativeCalls = 0;
  const api = { on: (_event: string, fn: Handler) => { handler = fn; }, appendEntry: (type: string, data: unknown) => { f.manager.appendCustomEntry(type, data); } } as unknown as Pick<ExtensionAPI, "on" | "appendEntry">;
  registerClassifierCompaction(api, { settings: () => ({ ...settings, mode }), artifactRoot: () => f.root, globalSettings: () => ({ compactionModel: { model: "test/summary", thinkingLevel: "off" } }), compact: async preparation => {
    nativeCalls++; nativeInputHadImages = JSON.stringify(preparation).includes('"type":"image"');
    return { summary: "Native working summary", firstKeptEntryId: f.keptId, tokensBefore: 20_000, ...(mode === "hybrid" ? { details: { readFiles: [], modifiedFiles: [] } } : {}) };
  } });
  const messages = f.input.messages;
  const event = { type: "session_before_compact", signal: new AbortController().signal, branchEntries: f.manager.getBranch(), customInstructions: "Keep visual evidence.", preparation: { firstKeptEntryId: f.keptId, messagesToSummarize: messages, turnPrefixMessages: [], isSplitTurn: false, tokensBefore: 20_000, previousSummary: "Prior constraints", fileOps: { read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() } } } as unknown as SessionBeforeCompactEvent;
  const ctx = { hasUI: false, sessionManager: f.manager, modelRegistry: { find: () => ({ id: "summary" }), getModelOfType: () => ({ id: "classifier" }), classify: async (_model: unknown, request: ClassifierRequest) => { if (failClassifier) throw Error("Synthetic failure"); return answer(request, () => 0); } } } as unknown as ExtensionContext;
  if (!handler) throw Error("Missing compaction hook");
  return { ...f, result: await handler(event, ctx), nativeInputHadImages, nativeCalls };
}

test("native fallback keeps all archived images", async () => {
  const fallback = await runHook("extractive", true);
  expect(fallback.nativeCalls).toBe(1);
  expect(fallback.result?.compaction?.summary).toContain("kept in active image context");
  expect(fallback.result?.compaction?.details).toMatchObject({ images: [{ action: "inline", forced: true }] });
});

test("hybrid native summary excludes image payloads and respects image pruning decisions", async () => {
  const f = await runHook("hybrid");
  expect(f.nativeCalls).toBe(1); expect(f.nativeInputHadImages).toBe(false);
  expect(f.result?.compaction?.details).toMatchObject({ images: [{ action: "omit" }] });
  expect(f.result?.compaction?.summary).not.toContain("saved image");
});

test("ordinary prose can be pruned while image decisions use the same goal and retained text", async () => {
  const f = await fixture(1, false), requests: ClassifierRequest[] = [];
  const result = await classifyCompaction({ ...f.input, taskContext: "Current shared comparison task: æøå" }, settings, { artifactRoot: f.root, classify: async request => {
    requests.push(request);
    return { ...answer(request, () => 0), answers: Object.fromEntries(Object.keys(request.questions).map(name => [name, { type: "bool" as const, probability: name === "inline_t0" || name === "inline_i0" ? 1 : 0 }])) };
  } });
  expect(result.kind).toBe("retained");
  expect(requests).toHaveLength(2);
  expect(requests.every(request => request.images?.length === 1 && request.state.goal === RETENTION_GOAL)).toBe(true);
  const task: unknown = JSON.parse(String(requests[0]?.state.conversation));
  expect(task).toMatchObject({ currentTask: "Current shared comparison task: æøå" });
  expect(requests[1]?.state.currentTask).toBe("Current shared comparison task: æøå");
  expect(result.text).not.toContain("numeric table");
  expect(result.text).toContain("decision identifiers");
  expect(result.decisions.find(d => d.id === "t1")?.action).toBe("omit");
  expect(result.images?.[0]?.action).toBe("inline");
  const original = result.savedItems?.find(item => item.toolName === "conversation:user");
  if (!original) throw Error("Missing pruned prose archive");
  expect(await readFile(original.path, "utf8")).toContain("numeric table");
});

test("the combined normalized image packet is bounded before provider submission", async () => {
  const f = await fixture(3, false);
  const data = execFileSync("/run/current-system/sw/bin/magick", ["-seed", "7", "-size", "720x720", "xc:gray", "+noise", "Random", "-depth", "8", "-quality", "95", "jpeg:-"], { maxBuffer: 4_000_000 }).toString("base64");
  const messages = f.input.messages.map(message => message.role === "user" && Array.isArray(message.content)
    ? { ...message, content: message.content.map(block => block.type === "image" ? { ...block, data, mimeType: "image/jpeg" } : block) } : message);
  let calls = 0;
  const result = await classifyCompaction({ ...f.input, messages }, settings, { artifactRoot: f.root, classify: async request => { calls++; return answer(request, () => 0); } });
  expect(result.reason).toBe("image-request-limit"); expect(calls).toBe(0);
  expect(result.imageRequestLimit).toBeDefined();
  expect((result.imageRequestLimit?.textBytes ?? 0) > settings.maxRequestBytes ||
    (result.imageRequestLimit?.totalBytes ?? 0) > 1_000_000).toBe(true);
  expect(result.images).toHaveLength(3);
  expect(result.images?.every(image => image.action === "inline" && image.forced)).toBe(true);
});

test("changing pruned prose invalidates image decisions even when the retained text is unchanged", async () => {
  const f = await fixture(1, false), cache = new ClassifierDecisionCache();
  const narrative = (text: string) => ({ role: "assistant" as const, content: [{ type: "text" as const, text }], api: "openai-responses" as const, provider: "test", model: "test", usage, stopReason: "stop" as const, timestamp: 6 });
  const input = { ...f.input, messages: [...f.input.messages, narrative("Obsolete note one")] };
  let calls = 0;
  const dependencies = { artifactRoot: f.root, cache, classify: async (request: ClassifierRequest) => {
    calls++;
    return { ...answer(request, () => 0), answers: Object.fromEntries(Object.keys(request.questions).map(name => [name, { type: "bool" as const, probability: name === "inline_t0" || name === "reference_i0" ? 1 : 0 }])) };
  } };
  const first = await classifyCompaction(input, settings, dependencies);
  const again = await classifyCompaction(input, settings, dependencies);
  expect(first.kind).toBe("retained"); expect(again.cacheHits).toBe(2); expect(calls).toBe(2);
  const changed = await classifyCompaction({ ...f.input, messages: [...f.input.messages, narrative("Obsolete note two")] }, settings, dependencies);
  expect(changed.kind).toBe("retained"); expect(changed.text).toBe(first.text);
  expect(calls).toBe(4);
});

test("packed image addresses retain oversized image sets and restore original pixels", async () => {
  const f = await fixture(8);
  const requests: ClassifierRequest[] = [];
  const result = await classifyCompaction(f.input, { ...settings, maxOutputBytes: 1200 }, {
    artifactRoot: f.root,
    classify: async request => { requests.push(request); return answer(request, () => 0); },
  });
  expect({ kind: result.kind, reason: result.reason }).toEqual({ kind: "retained", reason: "accepted" });
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every(request => request.images === undefined)).toBe(true);
  expect(result.checkpointBytes).toBe(Buffer.byteLength(result.text));
  expect(result.checkpointBytes).toBeLessThanOrEqual(1200);
  expect(result.checkpointUnpackedBytes).toBeGreaterThan(1200);
  expect(result.text).toContain("æøå");
  expect(result.images?.map(image => image.action)).toEqual(f.originals.map(() => "inline"));
  const manifest = result.savedItems?.find(item => item.toolName === "compaction:references");
  if (!manifest) throw Error("Missing image-address manifest");
  const text = await readFile(manifest.path, "utf8");
  for (const [i, image] of (result.images ?? []).entries()) {
    expect(text).toContain(image.path);
    const original = f.originals[i];
    if (original === undefined) throw Error("Missing original image");
    expect((await readFile(image.path)).toString("base64")).toBe(original);
  }
  f.manager.appendCompaction(result.text, f.keptId, 20_000, { images: result.images });
  type Handler = (event: ContextEvent, ctx: ExtensionContext) => Promise<ContextEventResult | undefined>;
  let handler: Handler | undefined;
  registerImageContext({ on: (_event: string, fn: Handler) => { handler = fn; } } as unknown as Pick<ExtensionAPI, "on">, () => f.root);
  if (!handler) throw Error("Missing image handler");
  const restored = await handler({ type: "context", messages: f.manager.buildSessionProjection().messages }, { hasUI: false, sessionManager: f.manager } as unknown as ExtensionContext);
  const custom = restored?.messages?.find(message => message.role === "custom" && message.customType === IMAGE_CONTEXT);
  if (!custom || custom.role !== "custom" || typeof custom.content === "string") throw Error("Missing restored pixels");
  expect(custom.content.filter(block => block.type === "image").map(block => block.data)).toEqual(f.originals);
});

test("image references state chronological position so the newest revision is identifiable", async () => {
  const f = await fixture(3, false);
  const result = await classifyCompaction(f.input, settings, { artifactRoot: f.root, classify: async request =>
    answer(request, name => name === "inline_i1" || name === "reference_i0" ? 1 : 0) });

  expect(result.images?.map(image => image.action)).toEqual(["reference", "inline", "omit"]);
  const [first, second, third] = result.images ?? [];
  expect(result.text).toContain(`[saved image ${first?.id}; reference; use read to view; 1 of 3]: ${first?.path}`);
  expect(result.text).toContain(`[saved image ${second?.id}; kept in active image context; 2 of 3]: ${second?.path}`);
  // The newest image was omitted, so no listed image may claim to be newest.
  expect(result.text).not.toContain("newest");
  expect(result.text).not.toContain(third?.path ?? "missing");
  const referenced = await classifyCompaction(f.input, settings, { artifactRoot: f.root, classify: async request =>
    answer(request, name => name.startsWith("reference_i") ? 1 : 0) });
  const newest = referenced.images?.[2];
  expect(referenced.text).toContain(`[saved image ${newest?.id}; reference; use read to view; 3 of 3, newest]: ${newest?.path}`);
});
