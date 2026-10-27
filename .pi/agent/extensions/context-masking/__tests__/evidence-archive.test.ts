import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  IMAGE_ARCHIVE,
  checkpointImages,
  imageArchiveRecords,
  readImageArtifact,
  readTextArchiveReference,
  recallableTextArchiveRecords,
  saveConversationArtifact,
  saveImageArtifact,
  saveMaskedTextArtifacts,
  savedItems,
} from "../evidence-archive";
import { CLASSIFIER_DEFAULTS, classifyCompaction, type ClassifierRequest, type ClassifierResponse } from "../classifier-compaction";
import { EXTRACTIVE_HEADER, expandCheckpointSources } from "../checkpoint-sources";
import { placeholder } from "../policy";
import { recallSaved } from "../recall";
import { recallImages } from "../image-recall";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "evidence-archive-"));
  roots.push(root);
  const manager = SessionManager.inMemory(root);
  return { root, manager, sessionId: manager.getSessionId() };
}

const usage = {
  input: 10, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 10,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function answer(request: ClassifierRequest, probability: (name: string) => number): ClassifierResponse {
  return {
    api: "typesafe-system-one", provider: "test", model: "test", stopReason: "stop", timestamp: 1, usage,
    answers: Object.fromEntries(Object.keys(request.questions).map(name => [name, { type: "bool", probability: probability(name) }])),
  };
}

const pixels = () => execFileSync("/run/current-system/sw/bin/magick", ["-size", "720x131", "xc:blue", "png:-"]).toString("base64");

test("text and image recovery uses caller-committed catalogs and preserves omitted originals", async () => {
  const f = await fixture();
  const text = "Approval udtræk_æøå remains recoverable.";
  const entryId = f.manager.appendMessage({ role: "toolResult", toolName: "read", toolCallId: "call", content: [{ type: "text", text }], isError: false, timestamp: 1 });
  const [written] = await saveMaskedTextArtifacts(f.root, f.sessionId, [{ entryId, toolName: "read", text }]);
  if (!written) throw Error("Missing masked original");
  const conversationText = "[user]\nPreserve Danish æøå exactly.";
  const conversation = { ...await saveConversationArtifact(f.root, f.sessionId, conversationText), text: conversationText };
  const imageInput = { data: pixels(), mimeType: "image/png" };
  const image = { ...await saveImageArtifact(f.root, f.sessionId, entryId, 0, imageInput), action: "omit" as const, forced: false };
  expect(savedItems(f.manager.getBranch()).size).toBe(0);

  f.manager.appendCustomEntry("context-masking", { items: [{ entryId, toolName: "read", path: written.path }, conversation] });
  const imageCatalogId = f.manager.appendCustomEntry(IMAGE_ARCHIVE, { images: [image] });
  const catalog = f.manager.getBranch().find(entry => entry.id === imageCatalogId);
  if (!catalog) throw Error("Missing image catalog");
  expect(imageArchiveRecords(catalog)).toEqual([image]);
  const records = savedItems(f.manager.getBranch());
  const recovered = await readTextArchiveReference(f.root, records, written.path, 4000);
  expect(recovered.text).toBe(text);
  expect(recovered.record.entryId).toBe(entryId);
  expect(recallableTextArchiveRecords(f.manager.getBranch())).toHaveLength(2);
  const expanded = await expandCheckpointSources(
    EXTRACTIVE_HEADER + `\n\n[saved conversation; use read or recall]: ${conversation.path}`,
    records, f.root, { windowBytes: 4000, totalBytes: 4000 },
  );
  expect(expanded?.sources).toEqual([{ text: conversationText, archive: conversation, referenceOnly: true }]);
  expect((await recallSaved(f.manager.getBranch(), f.root, "udtræk_æøå")).passages[0]?.path).toBe(written.path);
  expect((await recallImages(f.manager.getBranch(), f.root, f.sessionId)).found).toEqual([image]);
  expect(await readImageArtifact(f.root, f.sessionId, image)).toEqual({ type: "image", ...imageInput });
  expect(await readFile(written.path, "utf8")).toBe(text);
  await expect(readTextArchiveReference(f.root, records, join(f.root, "unregistered.txt"), 4000)).rejects.toThrow("catalogue");
  await expect(readImageArtifact(f.root, f.sessionId, { ...image, blockIndex: 1 })).rejects.toThrow("ID");
});

test("repeated mixed checkpoints keep text references demoted while restoring retained images inline", async () => {
  const f = await fixture();
  f.manager.appendMessage({ role: "assistant", content: [{ type: "toolCall", id: "call", name: "read", arguments: { path: "approval.txt" } }], api: "openai-responses", provider: "test", model: "test", usage, stopReason: "toolUse", timestamp: 1 });
  const text = "Historic approval schema_æøå=old must remain recoverable.";
  const entryId = f.manager.appendMessage({ role: "toolResult", toolName: "read", toolCallId: "call", content: [{ type: "text", text }], isError: false, timestamp: 2 });
  const [written] = await saveMaskedTextArtifacts(f.root, f.sessionId, [{ entryId, toolName: "read", text }]);
  if (!written) throw Error("Missing masked original");
  f.manager.appendContextEdit(entryId, { content: [{ type: "text", text: placeholder(written.candidate, written.path) }] });
  f.manager.appendCustomEntry("context-masking", { items: [{ entryId, toolName: "read", path: written.path }] });
  const imageInput = { type: "image" as const, data: pixels(), mimeType: "image/png" };
  f.manager.appendMessage({ role: "user", timestamp: 3, content: [{ type: "text", text: "Keep the current chart and preserve æøå." }, imageInput] });
  const settings = { ...CLASSIFIER_DEFAULTS, enabled: true, minFreedRatio: 0 };
  let result = await classifyCompaction({ sessionId: f.sessionId, branch: f.manager.getBranch(), messages: f.manager.buildSessionProjection().messages }, settings, {
    artifactRoot: f.root, deferReduction: true,
    classify: async request => answer(request, name => name.startsWith("inline_t") || name === "reference_r0" || name === "reference_i0" ? 1 : 0),
  });
  expect(result.kind).toBe("retained");
  expect(result.decisions.find(decision => decision.path === written.path)?.action).toBe("reference");
  expect(result.images?.[0]?.action).toBe("reference");
  const firstImage = result.images?.[0];
  if (!firstImage) throw Error("Missing archived image");

  for (let round = 0; round < 2; round++) {
    f.manager.appendCustomEntry("context-masking", { items: result.savedItems });
    f.manager.appendCustomEntry(IMAGE_ARCHIVE, { images: result.images });
    const keptId = f.manager.appendMessage({ role: "user", content: "Current independent constraint.", timestamp: round + 4 });
    f.manager.appendCompaction(result.text, keptId, 10000, { images: result.images });
    result = await classifyCompaction({
      sessionId: f.sessionId, branch: f.manager.getBranch(), previousSummary: result.text,
      previousImages: checkpointImages(f.manager.getBranch()),
      messages: [{ role: "user", content: "Current independent constraint.", timestamp: round + 4 }],
    }, settings, {
      artifactRoot: f.root, deferReduction: true,
      classify: async request => answer(request, name => name.startsWith("inline_") ? 1 : 0),
    });
    expect(result.kind).toBe("retained");
    expect(result.decisions.find(decision => decision.path === written.path)?.action).toBe("reference");
    expect(result.images?.[0]).toMatchObject({ id: firstImage.id, action: "inline", forced: false });
    expect((await readImageArtifact(f.root, f.sessionId, firstImage)).data).toBe(imageInput.data);
    expect((await recallSaved(f.manager.getBranch(), f.root, "schema_æøå")).passages[0]?.path).toBe(written.path);
    expect(await readFile(written.path, "utf8")).toBe(text);
  }
});
