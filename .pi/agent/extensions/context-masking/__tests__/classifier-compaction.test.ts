import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  compact,
  ExtensionAPI,
  ExtensionContext,
  SessionBeforeCompactEvent,
  SessionBeforeCompactResult,
} from "@earendil-works/pi-coding-agent";
import {
  CLASSIFIER_DEFAULTS,
  type ClassifierRequest,
  type ClassifierResponse,
  type CompactionInput,
  classifyCompaction,
} from "../classifier-compaction";
import {
  CLASSIFIER_CHECKPOINT,
  parseClassifierSettings,
  registerClassifierCompaction,
} from "../classifier-hook";
import { placeholder } from "../policy";
import { sessionWith } from "./fixtures";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const settings = { ...CLASSIFIER_DEFAULTS, enabled: true, minFreedRatio: 0 };
const USAGE = {
  input: 100,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 100,
  cost: { input: 0.001, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.001 },
};

function answer(
  request: ClassifierRequest,
  probabilities: (name: string) => number,
): ClassifierResponse {
  return {
    api: "typesafe-system-one",
    provider: "test",
    model: "test",
    stopReason: "stop",
    timestamp: 0,
    usage: USAGE,
    answers: Object.fromEntries(
      Object.keys(request.questions).map((name) => [
        name,
        { type: "bool", probability: probabilities(name) },
      ]),
    ),
  };
}
async function fixture(texts = ["approved value: æøå-123", "obsolete result", "background check"]) {
  const root = await mkdtemp(join(tmpdir(), "classifier-compaction-test-"));
  roots.push(root);
  const session = sessionWith(
    texts.map((_, i) => ({ resultChars: 1_000, args: { path: `source-${i}.txt` } })),
  );
  const { manager, resultIds } = session;
  const dir = join(root, manager.getSessionId());
  await mkdir(dir);
  const paths: string[] = [];
  for (const [i, text] of texts.entries()) {
    const entryId = resultIds[i];
    if (!entryId) throw new Error("Missing fixture result");
    const path = join(dir, `${entryId}.txt`);
    paths.push(path);
    await writeFile(path, text);
    manager.appendContextEdit(entryId, {
      content: [{ type: "text", text: placeholder({ entryId, toolName: "read", text }, path) }],
    });
  }
  manager.appendCustomEntry("context-masking", {
    items: paths.map((path, i) => ({ path, entryId: resultIds[i], toolName: "read" })),
  });
  manager.appendMessage({
    role: "user",
    content: "Continue after preserving Danish exactly; never change current constraints.",
    timestamp: 1,
  });
  const input: CompactionInput = {
    branch: manager.getBranch(),
    messages: manager.buildSessionProjection().messages,
  };
  return { root, manager, paths, input };
}
const omitAll = async (request: ClassifierRequest) => answer(request, () => 0);

test("disabled candidate does not read artifacts or call the classifier", async () => {
  const f = await fixture();
  let calls = 0;
  const result = await classifyCompaction(f.input, CLASSIFIER_DEFAULTS, {
    artifactRoot: "/missing",
    classify: async (r) => {
      calls++;
      return answer(r, () => 1);
    },
  });
  expect(result.reason).toBe("disabled");
  expect(result.artifactsRead).toBe(0);
  expect(calls).toBe(0);
});

test("content-aware packet contains actual output, original call, mask, and exact artifact address", async () => {
  const f = await fixture();
  const requests: ClassifierRequest[] = [];
  const result = await classifyCompaction(f.input, settings, {
    artifactRoot: f.root,
    classify: async (r) => {
      requests.push(r);
      return answer(r, () => 0);
    },
  });
  const json = JSON.stringify(requests[0]);
  expect(json).toContain("approved value: æøå-123");
  expect(json).toContain("source-0.txt");
  expect(json).toContain("[context-masking]");
  expect(json).toContain(f.paths[0] ?? "");
  expect(Object.keys(requests[0]?.questions ?? {})).toHaveLength(6);
  expect(result.kind).toBe("retained");
  expect(result.text).toContain("never change current constraints");
  expect(result.text).not.toContain("source-0.txt");
  expect(result.decisions.map((d) => d.action)).toEqual(["omit", "omit", "omit"]);
  for (const path of f.paths) expect(await readFile(path, "utf8")).toBeTruthy();
});

test("metadata-only requests exclude output contents but still include masks and addresses", async () => {
  const f = await fixture();
  let sent = "";
  await classifyCompaction(
    f.input,
    { ...settings, includeContent: false },
    {
      artifactRoot: f.root,
      classify: async (r) => {
        sent = JSON.stringify(r);
        return answer(r, () => 0);
      },
    },
  );
  expect(sent).not.toContain("approved value");
  expect(sent).toContain(f.paths[0] ?? "");
});

test("keeps coherent call/result pairs inline or as references without accepting fabricated addresses", async () => {
  const f = await fixture();
  let result = await classifyCompaction(f.input, settings, {
    artifactRoot: f.root,
    classify: async (r) => answer(r, (name) => (name === "inline_r0" ? 1 : 0)),
  });
  expect(result.kind).toBe("retained");
  expect(result.text).toContain("approved value: æøå-123");
  expect(result.text).toContain("source-0.txt");
  expect(result.text).not.toContain("source-1.txt");
  result = await classifyCompaction(f.input, settings, {
    artifactRoot: f.root,
    classify: async (r) => ({
      ...answer(r, (name) => (name === "reference_r0" ? 1 : 0)),
      answers: {
        ...answer(r, (name) => (name === "reference_r0" ? 1 : 0)).answers,
        invented_address: { type: "bool", probability: 1 },
      },
    }),
  });
  expect(result.kind).toBe("retained");
  expect(result.text).toContain(f.paths[0] ?? "");
  expect(result.text).not.toContain("approved value");
});

test("batches within the byte ceiling and resends the shared conversation", async () => {
  const f = await fixture(["one ".repeat(400), "two ".repeat(400), "three ".repeat(400)]);
  const requests: ClassifierRequest[] = [];
  const result = await classifyCompaction(
    f.input,
    { ...settings, maxRequestBytes: 5_500 },
    {
      artifactRoot: f.root,
      classify: async (r) => {
        requests.push(r);
        return answer(r, () => 0);
      },
    },
  );
  expect(requests.length).toBeGreaterThan(1);
  expect(result.requestBytes.every((n) => n <= 5_500)).toBe(true);
  for (const request of requests)
    expect(JSON.stringify(request.state)).toContain("never change current constraints");
});

test("pins pointers for partial reads and enforces total read and request limits", async () => {
  const f = await fixture(["large".repeat(500), "other", "unused"]);
  let result = await classifyCompaction(
    f.input,
    { ...settings, maxArtifactBytes: 16 },
    {
      artifactRoot: f.root,
      classify: async (r) => {
        return answer(r, () => 0);
      },
    },
  );
  expect(result.decisions[0]).toMatchObject({ action: "reference", forced: true });
  expect(result.artifactBytes).toBeLessThanOrEqual(48);
  result = await classifyCompaction(
    f.input,
    { ...settings, maxTotalArtifactBytes: 1 },
    { artifactRoot: f.root, classify: omitAll },
  );
  expect(result.reason).toBe("artifact-read-budget");
  result = await classifyCompaction(
    f.input,
    { ...settings, maxRequestBytes: 100 },
    { artifactRoot: f.root, classify: omitAll },
  );
  expect(result.reason).toBe("conversation-request-limit");
});

test("unreadable, forged, and symlinked artifacts never reach the classifier", async () => {
  const f = await fixture();
  const path = f.paths[0];
  if (!path) throw new Error("Missing artifact");
  const secret = join(f.root, "secret.txt");
  await writeFile(secret, "forbidden external data");
  await rm(path);
  await symlink(secret, path);
  let calls = 0;
  const result = await classifyCompaction(f.input, settings, {
    artifactRoot: f.root,
    classify: async (r) => {
      calls++;
      return answer(r, () => 0);
    },
  });
  expect(result.reason).toBe("artifact-unreadable");
  expect(calls).toBe(0);
});

test("invalid probabilities, API failures, cancellation and insufficient savings fall back", async () => {
  const f = await fixture();
  let result = await classifyCompaction(f.input, settings, {
    artifactRoot: f.root,
    classify: async (r) => answer(r, () => 2),
  });
  expect(result.reason).toBe("invalid-classifier-answer");
  result = await classifyCompaction(f.input, settings, {
    artifactRoot: f.root,
    classify: async () => {
      throw new Error("API unavailable");
    },
  });
  expect(result.reason).toBe("classifier-request-failed");
  expect(result.usageComplete).toBe(false);
  result = await classifyCompaction(
    f.input,
    settings,
    { artifactRoot: f.root, classify: omitAll },
    AbortSignal.abort(),
  );
  expect(result.reason).toBe("aborted");
  result = await classifyCompaction(
    f.input,
    { ...settings, minFreedRatio: 0.99 },
    { artifactRoot: f.root, classify: omitAll },
  );
  expect(result.reason).toBe("insufficient-reduction");
  result = await classifyCompaction(
    f.input,
    { ...settings, maxOutputBytes: 10 },
    { artifactRoot: f.root, classify: omitAll },
  );
  expect(result.reason).toBe("output-byte-limit");
});

test("configuration defaults to disabled and rejects malformed fields", () => {
  expect(parseClassifierSettings({}).enabled).toBe(false);
  expect(
    parseClassifierSettings({ contextClassifierCompaction: { enabled: true } }).includeContent,
  ).toBe(true);
  for (const value of [
    { enabled: "yes" },
    { maxRequestBytes: 100_000 },
    { threshold: -1 },
    { unknown: true },
  ])
    expect(() => parseClassifierSettings({ contextClassifierCompaction: value })).toThrow();
});

test("compaction hook uses real session projection and preserves cut boundary, usage, and files", async () => {
  const f = await fixture();
  const kept = f.manager.getBranch().at(-1);
  if (!kept) throw new Error("Missing kept entry");
  const preparation: SessionBeforeCompactEvent["preparation"] = {
    firstKeptEntryId: kept.id,
    messagesToSummarize: f.input.messages.slice(0, -1),
    turnPrefixMessages: [],
    isSplitTurn: false,
    tokensBefore: 8_000,
    fileOps: { read: new Set(), written: new Set(), edited: new Set() },
    settings: { enabled: true, reserveTokens: 1_000, keepRecentTokens: 10 },
  };
  preparation.fileOps.read.add("read-only.ts");
  preparation.fileOps.edited.add("edited.ts");
  type Handler = (
    event: SessionBeforeCompactEvent,
    ctx: ExtensionContext,
  ) => Promise<SessionBeforeCompactResult | undefined>;
  let handler: Handler | undefined;
  const records: unknown[] = [];
  let enabled = false;
  let maxTotalArtifactBytes = settings.maxTotalArtifactBytes;
  let fallbackSettings: unknown = {
    compactionModel: {
      enabled: false,
      model: "summary-provider/configured-summary-model",
      thinkingLevel: "xhigh",
    },
  };
  let classifierAvailable = true;
  let summaryFails = false;
  const fallbackCalls: Parameters<typeof compact>[] = [];
  const fallbackModel: Parameters<typeof compact>[1] = {
    id: "configured-summary-model",
    provider: "summary-provider",
    name: "Summary",
    api: "openai-responses",
    baseUrl: "https://example.invalid",
    reasoning: true,
    input: ["text"],
    contextWindow: 100_000,
    maxTokens: 8_000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  let calls = 0;
  const api = {
    on: (_name: string, fn: Handler) => {
      handler = fn;
    },
    appendEntry: (type: string, data: unknown) => {
      records.push({ type, data });
    },
  } as unknown as Pick<ExtensionAPI, "on" | "appendEntry">;
  registerClassifierCompaction(api, {
    settings: () => ({ ...settings, enabled, maxTotalArtifactBytes }),
    globalSettings: () => fallbackSettings,
    compact: async (...args) => {
      fallbackCalls.push(args);
      if (summaryFails) throw new Error("Summary request failed");
      return { summary: "Configured fallback", firstKeptEntryId: kept.id, tokensBefore: 8_000 };
    },
    artifactRoot: () => f.root,
  });
  const ctx = {
    hasUI: false,
    model: { ...fallbackModel, id: "unsupported-active-session-model" },
    modelRegistry: {
      getModelOfType: () => (classifierAvailable ? { id: "test" } : undefined),
      find: (provider: string, id: string) => {
        expect(provider).toBe("summary-provider");
        expect(id).toBe("configured-summary-model");
        return fallbackModel;
      },
      classify: async (_model: unknown, request: ClassifierRequest) => {
        calls++;
        return answer(request, () => 0);
      },
    },
  } as unknown as ExtensionContext;
  const event = {
    type: "session_before_compact",
    preparation,
    branchEntries: f.manager.getBranch(),
    reason: "manual",
    willRetry: false,
    signal: new AbortController().signal,
  } satisfies SessionBeforeCompactEvent;
  if (!handler) throw new Error("Missing hook");
  expect(await handler(event, ctx)).toBeUndefined();
  expect(calls).toBe(0);
  enabled = true;
  const result = await handler(event, ctx);
  expect(result?.compaction?.firstKeptEntryId).toBe(preparation.firstKeptEntryId);
  expect(result?.compaction?.usage?.input).toBe(100);
  expect(result?.compaction?.details).toMatchObject({
    type: CLASSIFIER_CHECKPOINT,
    artifactIndex: "embedded",
    readFiles: ["read-only.ts"],
    modifiedFiles: ["edited.ts"],
  });
  expect(records.length).toBe(1);
  expect(fallbackCalls).toHaveLength(0);
  // Exhaust the read budget after the first artifact, matching the reported fallback.
  maxTotalArtifactBytes = 1;
  const fallback = await handler(event, ctx);
  expect(fallback?.compaction?.summary).toBe("Configured fallback");
  expect(fallbackCalls).toHaveLength(1);
  expect(fallbackCalls[0]?.[0]).toBe(preparation);
  expect(fallbackCalls[0]?.[1]).toBe(fallbackModel);
  expect(fallbackCalls[0]?.[5]).toBe(event.signal);
  expect(fallbackCalls[0]?.[6]).toBe("xhigh");
  expect(fallbackCalls[0]?.[7]).toBeTypeOf("function");
  expect(await handler({ ...event, signal: AbortSignal.abort() }, ctx)).toEqual({ cancel: true });
  expect(fallbackCalls).toHaveLength(1);
  classifierAvailable = false;
  expect((await handler(event, ctx))?.compaction?.summary).toBe("Configured fallback");
  expect(fallbackCalls).toHaveLength(2);
  summaryFails = true;
  expect(await handler(event, ctx)).toEqual({ cancel: true });
  expect(fallbackCalls).toHaveLength(3);
  summaryFails = false;
  for (const invalid of [
    undefined,
    {},
    { compactionModel: { model: "missing-provider" } },
    {
      compactionModel: {
        model: "summary-provider/configured-summary-model",
        thinkingLevel: "invalid",
      },
    },
  ]) {
    fallbackSettings = invalid;
    expect(await handler(event, ctx)).toEqual({ cancel: true });
  }
  expect(fallbackCalls).toHaveLength(3);
});

test("preserves assistant block order around retained tool calls", async () => {
  const f = await fixture();
  let changed = false;
  const messages = f.input.messages.map((message) => {
    if (changed || message.role !== "assistant") return message;
    changed = true;
    return {
      ...message,
      content: [
        { type: "text" as const, text: "Before the call." },
        ...message.content,
        { type: "text" as const, text: "After the call." },
      ],
    };
  });
  const result = await classifyCompaction({ ...f.input, messages }, settings, {
    artifactRoot: f.root,
    classify: async (r) => answer(r, (name) => (name === "inline_r0" ? 1 : 0)),
  });
  expect(result.kind).toBe("retained");
  expect(result.text.indexOf("Before the call.")).toBeLessThan(result.text.indexOf("source-0.txt"));
  expect(result.text.indexOf("source-0.txt")).toBeLessThan(result.text.indexOf("After the call."));
});

test("retains previous summary verbatim and rejects unsupported content without a classifier call", async () => {
  const f = await fixture();
  const previousSummary = "Persistent constraint: preserve æ, ø, å.";
  let result = await classifyCompaction({ ...f.input, previousSummary }, settings, {
    artifactRoot: f.root,
    classify: omitAll,
  });
  expect(result.text).toContain(previousSummary);
  result = await classifyCompaction(
    {
      ...f.input,
      messages: [
        ...f.input.messages,
        {
          role: "user",
          content: [{ type: "image", data: "AA==", mimeType: "image/png" }],
          timestamp: 1,
        },
      ],
    },
    settings,
    {
      artifactRoot: f.root,
      classify: async () => {
        throw new Error("Classifier must not run");
      },
    },
  );
  expect(result.reason).toBe("unsupported-content");
  expect(result.requestBytes).toHaveLength(0);
});

test("cancellation after a paid response preserves usage and returns no proposed checkpoint", async () => {
  const f = await fixture();
  const controller = new AbortController();
  const result = await classifyCompaction(
    f.input,
    settings,
    {
      artifactRoot: f.root,
      classify: async (r) => {
        controller.abort();
        return answer(r, () => 0);
      },
    },
    controller.signal,
  );
  expect(result.kind).toBe("fallback");
  expect(result.reason).toBe("aborted");
  expect(result.usage?.input).toBe(100);
  expect(result.text).toBe("");
});

test("ambiguous saved-call identities and mismatched result tools fall back before requests", async () => {
  const f = await fixture();
  const source = f.input.branch.find(
    (entry) => entry.type === "message" && entry.message.role === "toolResult",
  );
  if (!source) throw new Error("Missing fixture result");
  const classify = async () => {
    throw new Error("Classifier must not run");
  };
  const ambiguous = await classifyCompaction(
    {
      ...f.input,
      branch: [...f.input.branch, { ...source, id: "another-result" }],
    },
    settings,
    { artifactRoot: f.root, classify },
  );
  expect(ambiguous.reason).toBe("ambiguous-tool-call");
  expect(ambiguous.requestBytes).toHaveLength(0);
  let changed = false;
  const messages = f.input.messages.map((message) => {
    if (changed || message.role !== "toolResult") return message;
    changed = true;
    return { ...message, toolName: "other-tool" };
  });
  const mismatched = await classifyCompaction({ ...f.input, messages }, settings, {
    artifactRoot: f.root,
    classify,
  });
  expect(mismatched.reason).toBe("orphan-or-mismatched-result");
  expect(mismatched.requestBytes).toHaveLength(0);
});
