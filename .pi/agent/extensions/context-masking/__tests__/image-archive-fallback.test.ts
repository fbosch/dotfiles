import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SessionManager,
  type ContextEvent,
  type ContextEventResult,
  type ExtensionAPI,
  type ExtensionContext,
  type SessionBeforeCompactEvent,
  type SessionBeforeCompactResult,
} from "@earendil-works/pi-coding-agent";
import { CLASSIFIER_DEFAULTS, type ClassifierRequest, type ClassifierResponse } from "../classifier-compaction";
import { registerClassifierCompaction } from "../classifier-hook";
import { type ImageArchiveRecord } from "../evidence-archive";
import { writeArchiveBytes } from "../image-artifact";
import { IMAGE_CONTEXT, registerImageContext } from "../image-retention";

const roots: string[] = [];
const pixels = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1kAAAAASUVORK5CYII=";
const usage = { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function archivedImage(root: string, sessionId: string, entryId: string, persist = true): Promise<ImageArchiveRecord> {
  const bytes = Buffer.from(pixels, "base64");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const mimeType = "image/png";
  const id = createHash("sha256").update([sessionId, entryId, 0, mimeType, bytes.length, sha256].join("\0")).digest("hex");
  const name = `image-${id}.png`;
  const path = persist ? await writeArchiveBytes(root, sessionId, name, bytes) : join(await realpath(root), sessionId, name);
  return { id, entryId, blockIndex: 0, sessionId, path, mimeType, sha256, bytes: bytes.length, action: "inline", forced: true };
}

async function fixture(mode: "extractive" | "hybrid", previousImage = false, goodImages = 0) {
  const root = await mkdtemp(join(tmpdir(), "image-archive-fallback-"));
  roots.push(root);
  const manager = SessionManager.inMemory(root);
  const sourceId = manager.appendMessage({
    role: "user", timestamp: 1,
    content: [{ type: "text", text: "Preserve the decision and æøå." },
      ...(previousImage ? [] : [{ type: "image" as const, data: "AA==", mimeType: "image/png" }])],
  });
  const messages = manager.buildSessionProjection().messages;
  const keptId = manager.appendMessage({ role: "user", content: "Recent tail", timestamp: 2 });
  // Replay persisted originals through the real archive reader. Six valid images exercise
  // Jev's metadata-only transport without requiring the NixOS-only image normalizer.
  const images: ImageArchiveRecord[] = [];
  for (let i = 0; i < goodImages; i++) images.push(await archivedImage(root, manager.getSessionId(), `source_${i}`));
  const previous = [...images];
  if (previousImage) previous.splice(2, 0, await archivedImage(root, manager.getSessionId(), "missing", false));
  if (previous.length) manager.appendCompaction("Previous visual evidence", keptId, 20_000, { images: previous });

  type Handler = (event: SessionBeforeCompactEvent, ctx: ExtensionContext) =>
    Promise<SessionBeforeCompactResult | undefined>;
  let handler: Handler | undefined;
  const calls: SessionBeforeCompactEvent["preparation"][] = [];
  const requests: ClassifierRequest[] = [];
  const notices: Array<{ message: string; level: string }> = [];
  let summaryFails = false;
  const controller = new AbortController();
  registerClassifierCompaction({
    on: (_event: string, fn: Handler) => { handler = fn; },
    appendEntry: (type: string, data: unknown) => { manager.appendCustomEntry(type, data); },
  } as unknown as Pick<ExtensionAPI, "on" | "appendEntry">, {
    settings: () => ({ ...CLASSIFIER_DEFAULTS, enabled: true, mode }),
    artifactRoot: () => root,
    globalSettings: () => ({ compactionModel: { model: "test/summary", thinkingLevel: "off" } }),
    compact: async preparation => {
      calls.push(preparation);
      if (summaryFails) throw Error("Synthetic summary failure");
      return { summary: "Native selected-text summary", firstKeptEntryId: keptId, tokensBefore: 20_000,
        details: { readFiles: ["read-only.ts"], modifiedFiles: ["edited.ts"] } };
    },
  });
  const event = {
    type: "session_before_compact", reason: "manual", willRetry: false,
    signal: controller.signal, branchEntries: manager.getBranch(),
    customInstructions: "Keep the current decision.",
    preparation: {
      firstKeptEntryId: keptId, messagesToSummarize: messages, turnPrefixMessages: [],
      isSplitTurn: false, tokensBefore: 20_000, previousSummary: "Prior constraints",
      fileOps: { read: new Set(["read-only.ts"]), written: new Set<string>(), edited: new Set(["edited.ts"]) },
      settings: { enabled: true, reserveTokens: 1_000, keepRecentTokens: 10 },
    },
  } satisfies SessionBeforeCompactEvent;
  const ctx = {
    hasUI: true,
    ui: { notify: (message: string, level: string) => notices.push({ message, level }) },
    sessionManager: manager,
    modelRegistry: {
      find: () => ({ id: "summary" }),
      getModelOfType: () => ({ id: "classifier" }),
      classify: async (_model: unknown, request: ClassifierRequest): Promise<ClassifierResponse> => {
        requests.push(request);
        return { api: "typesafe-system-one", provider: "test", model: "test", stopReason: "stop", timestamp: 1, usage,
          answers: Object.fromEntries(Object.keys(request.questions).map(name => [name, { type: "bool", probability: name.startsWith("inline_") ? 1 : 0 }])) };
      },
    },
  } as unknown as ExtensionContext;
  if (!handler) throw Error("Missing compaction hook");
  const run = handler;
  return { event, controller, calls, notices, requests, images, manager, root, keptId, ctx, sourceId,
    run: () => run(event, ctx), failSummary: () => { summaryFails = true; } };
}

for (const mode of ["extractive", "hybrid"] as const) {
  for (const previousImage of [false, true]) {
    for (const goodImages of [0, 6]) {
      test(`${mode}: skip ${previousImage ? "unavailable previous" : "malformed new"} image and retain ${goodImages} originals`, async () => {
        const f = await fixture(mode, previousImage, goodImages);
        const result = await f.run();
        expect(result?.compaction).toMatchObject({
          firstKeptEntryId: f.keptId, tokensBefore: 20_000,
          details: { outcome: "retained", skippedImageCount: 1, images: f.images },
        });
        expect(f.requests.length).toBeGreaterThan(0);
        expect(f.requests.every(request => Object.keys(request.questions).length > 0)).toBe(true);
        expect(f.calls).toHaveLength(mode === "hybrid" ? 1 : 0);
        expect(JSON.stringify(f.calls)).not.toContain('"type":"image"');
        expect(f.notices).toHaveLength(1);
        expect(f.notices[0]?.level).toBe("warning");
        expect(f.notices[0]?.message).toContain("Skipped 1 image");
        expect(f.notices[0]?.message).toContain(previousImage ? '"missing":0' : `${JSON.stringify(f.sourceId)}:1`);
        if (!result?.compaction) throw Error("Missing compaction");
        if (mode === "extractive") expect(result.compaction.summary).toContain("æøå");
        f.manager.appendCompaction(result.compaction.summary, f.keptId, 20_000, result.compaction.details);
        type ImageHandler = (event: ContextEvent, ctx: ExtensionContext) => Promise<ContextEventResult | undefined>;
        let restore: ImageHandler | undefined;
        registerImageContext({ on: (_event: string, fn: ImageHandler) => { restore = fn; } } as unknown as Pick<ExtensionAPI, "on">, () => f.root);
        if (!restore) throw Error("Missing image context handler");
        const restored = await restore({ type: "context", messages: f.manager.buildSessionProjection().messages }, f.ctx);
        const custom = restored?.messages?.find(message => message.role === "custom" && message.customType === IMAGE_CONTEXT);
        const content = custom?.role === "custom" && Array.isArray(custom.content) ? custom.content : [];
        expect(content.filter(block => block.type === "image").map(block => block.data)).toEqual(Array(goodImages).fill(pixels));
      });
    }
  }
}

test("hybrid summary failure still cancels after skipping an unarchivable image", async () => {
  const f = await fixture("hybrid");
  f.failSummary();
  expect(await f.run()).toEqual({ cancel: true });
  expect(f.calls).toHaveLength(1);
  expect(f.notices.at(-1)?.message).toContain("Synthetic summary failure");
});

test("user cancellation does not start image archival or classification", async () => {
  const f = await fixture("extractive");
  f.controller.abort();
  expect(await f.run()).toEqual({ cancel: true });
  expect(f.calls).toHaveLength(0);
  expect(f.requests).toHaveLength(0);
});

test("image count overflow skips excess images without losing the bounded verified set", async () => {
  const f = await fixture("extractive", false, 33);
  const result = await f.run();
  expect(result?.compaction?.details).toMatchObject({
    outcome: "retained", skippedImageCount: 2, images: f.images.slice(0, 32),
  });
  expect(f.calls).toHaveLength(0);
  expect(f.notices[0]?.message).toContain("Skipped 2 images");
});

test("a forged previous-image path is skipped without publishing it or losing verified originals", async () => {
  const f = await fixture("extractive", true, 6);
  const first = f.images[0];
  if (!first) throw Error("Missing verified original");
  f.manager.appendCompaction("Previous visual evidence", f.keptId, 20_000, {
    images: [{ ...first, path: "/etc/passwd" }, ...f.images],
  });
  f.event.branchEntries = f.manager.getBranch();
  const result = await f.run();
  expect(result?.compaction?.details).toMatchObject({
    outcome: "retained", skippedImageCount: 1, images: f.images,
  });
  expect(result?.compaction?.summary).not.toContain("/etc/passwd");
  expect(JSON.stringify(f.requests)).not.toContain("/etc/passwd");
});
