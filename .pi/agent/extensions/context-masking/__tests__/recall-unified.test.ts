import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClassifierAnswer } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionToolContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ClassifierRequestResult } from "../../../lib/classifier";
import { IMAGE_ARCHIVE, type ImageArchiveRecord } from "../evidence-archive";
import { writeArchiveBytes } from "../image-artifact";
import {
  RECALL_CLASSIFIER_TASK,
  RECALL_LIMITS,
  recallUnified,
  registerRecall,
  type RecallClassifier,
} from "../recall";
import { sessionWith } from "./fixtures";

const roots: string[] = [];
const pixels = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1kAAAAASUVORK5CYII=";
const usage = {
  input: 17, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 20,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(texts: string[]) {
  const root = await mkdtemp(join(tmpdir(), "unified-recall-"));
  roots.push(root);
  const { manager, resultIds } = sessionWith(texts.map(() => ({ resultChars: 1_000 })));
  const dir = join(root, manager.getSessionId());
  await mkdir(dir);
  const paths: string[] = [];
  for (const [index, text] of texts.entries()) {
    const path = join(dir, `${resultIds[index]}.txt`);
    await writeFile(path, text);
    paths.push(path);
  }
  manager.appendCustomEntry("context-masking", {
    items: paths.map((path, index) => ({
      path, entryId: resultIds[index] ?? "", toolName: "read",
    })),
  });
  return { root, manager, resultIds, paths };
}

async function imageRecord(
  root: string,
  sessionId: string,
  entryId: string,
  label: string,
  bytes = Buffer.from(pixels, "base64"),
): Promise<ImageArchiveRecord> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const mimeType = "image/png";
  const id = createHash("sha256")
    .update([sessionId, entryId, 0, mimeType, bytes.length, sha256].join("\0"))
    .digest("hex");
  const path = await writeArchiveBytes(root, sessionId, `image-${id}.png`, bytes);
  return {
    id, entryId, blockIndex: 0, sessionId, path, mimeType, sha256, bytes: bytes.length,
    action: "inline", forced: true, label,
  };
}

function classifierChoosing(
  choose: (name: string) => string,
): RecallClassifier {
  return async (input) => {
    expect(input.state.task).toBe(RECALL_CLASSIFIER_TASK);
    const answers: Record<string, ClassifierAnswer> = {};
    for (const name of Object.keys(input.questions)) {
      const choice = choose(name);
      answers[name] = {
        type: "choice",
        choice,
        probabilities: { [choice]: 0.9 },
        confidence: 0.9,
      };
    }
    return { ok: true, value: { answers }, usage };
  };
}

test("explicit recall selects no-overlap text and image metadata together across batch queries", async () => {
  const f = await fixture(["Mira owns the migration plan."]);
  const image = await imageRecord(
    f.root, f.manager.getSessionId(), f.resultIds[0] ?? "", "System topology diagram",
  );
  f.manager.appendCustomEntry(IMAGE_ARCHIVE, { images: [image] });

  const report = await recallUnified(
    f.manager.getBranch(),
    f.root,
    f.manager.getSessionId(),
    ["Which person coordinates this move?", "When was release timing noted?"],
    1,
    {
      classifier: classifierChoosing((name) =>
        name.startsWith("query_1_") ? "no_match" :
          name.endsWith("_text") ? "text_0" : "image_0"
      ),
    },
  );

  expect(report.rankingSource).toBe("classifier");
  expect(report.fallbackReason).toBeUndefined();
  expect(report.usage).toEqual(usage);
  expect(report.noMatchQueries).toEqual(["When was release timing noted?"]);
  expect(report.content.some((block) => block.type === "image" && block.data === pixels)).toBe(true);
  const text = report.content.find((block) => block.type === "text");
  expect(text?.type === "text" ? text.text : "").toContain("Mira owns the migration plan.");
  expect(text?.type === "text" ? text.text : "").toContain("Saved path:");
});

test("disabled, unavailable, invalid, and malformed classifiers report lexical fallback and usage", async () => {
  const f = await fixture(["Deployment architecture was approved."]);
  const image = await imageRecord(
    f.root, f.manager.getSessionId(), f.resultIds[0] ?? "", "Deployment architecture",
  );
  f.manager.appendCustomEntry(IMAGE_ARCHIVE, { images: [image] });
  const failures = [
    ["disabled", "config"],
    ["model-unavailable", "config"],
    ["invalid-config", "config"],
  ] as const;

  for (const [reason, stage] of failures) {
    const classifier: RecallClassifier = async () => ({ ok: false, reason, stage, usage });
    const report = await recallUnified(
      f.manager.getBranch(), f.root, f.manager.getSessionId(), ["deployment architecture"], 1,
      { classifier },
    );
    expect(report.rankingSource).toBe("lexical");
    expect(report.fallbackReason).toBe(reason);
    expect(report.usage).toEqual(usage);
    expect(report.textMatches).toBeGreaterThan(0);
    expect(report.imageMatches).toBe(1);
  }

  const malformed: RecallClassifier = async (): Promise<ClassifierRequestResult> => ({
    ok: true, value: { answers: {} }, usage,
  });
  const report = await recallUnified(
    f.manager.getBranch(), f.root, f.manager.getSessionId(), ["deployment architecture"], 1,
    { classifier: malformed },
  );
  expect(report.rankingSource).toBe("lexical");
  expect(report.fallbackReason).toBe("invalid-response");
  expect(report.usage).toEqual(usage);
});

test("caller cancellation is propagated instead of becoming lexical fallback", async () => {
  const f = await fixture(["A saved result."]);
  const controller = new AbortController();
  const classifier: RecallClassifier = async (_input, options) => {
    options.signal?.throwIfAborted();
    controller.abort();
    return { ok: false, reason: "caller-cancellation", stage: "request" };
  };
  await expect(recallUnified(
    f.manager.getBranch(), f.root, f.manager.getSessionId(), ["saved result"],
    1, { classifier, signal: controller.signal },
  )).rejects.toThrow();
});

test("candidate, classifier request, output, and image-read budgets stay bounded", async () => {
  const f = await fixture(Array.from({ length: 80 }, (_, index) =>
    `marker-${index} ${"x".repeat(1_000)}`,
  ));
  const queries = Array.from({ length: 8 }, (_, index) => `unrelated topic ${index}`);
  const report = await recallUnified(
    f.manager.getBranch(), f.root, f.manager.getSessionId(), queries, 3,
    { classifier: async (input) => ({
      ok: true,
      value: { answers: Object.fromEntries(Object.keys(input.questions).map((name) => [name, {
        type: "choice" as const,
        choice: "text_0",
        probabilities: { no_match: 0.01, ...Object.fromEntries(
          Array.from({ length: RECALL_LIMITS.textCandidates }, (_,index) => [`text_${index}`, 0.9 - index * 0.03]),
        ) },
        confidence: 0.9,
      }])) },
      usage,
    }) },
  );
  expect(report.candidateCount.text).toBe(RECALL_LIMITS.textCandidates);
  expect(report.requestBytes).toBeLessThanOrEqual(48_000);
  expect(report.content[0]?.type === "text" ? report.content[0].text.length : 0)
    .toBeLessThanOrEqual(RECALL_LIMITS.outputChars);
  expect(report.limited).toBe(true);
  const rendered = report.content[0];
  if (rendered?.type !== "text") throw Error("Missing recall text");
  for (const query of queries) expect(rendered.text).toContain(`Query: ${query}`);
});

test("malicious text paths, out-of-session images, and tampered image bytes are not returned", async () => {
  const f = await fixture(["ordinary note", "second ordinary note"]);
  const secretPath = "/etc/passwd";
  f.manager.appendCustomEntry("context-masking", {
    items: [{ entryId: f.resultIds[1] ?? "", toolName: "read", path: secretPath }],
  });
  const sessionId = f.manager.getSessionId();
  const image = await imageRecord(f.root, sessionId, f.resultIds[0] ?? "", "sensitive image");
  await writeFile(image.path, Buffer.from("tampered"));
  const foreign = await imageRecord(
    f.root, `${sessionId}_foreign`, "foreign-entry", "outside branch image",
  );
  f.manager.appendCustomEntry(IMAGE_ARCHIVE, { images: [image, foreign] });

  let requestState = "";
  const classifier: RecallClassifier = async (input) => {
    requestState = JSON.stringify(input.state);
    const answers: Record<string, ClassifierAnswer> = {};
    for (const name of Object.keys(input.questions)) {
      const choice = name.endsWith("_image") ? "image_0" : "no_match";
      answers[name] = { type: "choice", choice, probabilities: { [choice]: 0.9 }, confidence: 0.9 };
    }
    return { ok: true, value: { answers }, usage };
  };
  const report = await recallUnified(
    f.manager.getBranch(), f.root, sessionId, ["locate stolen credential values"], 1,
    { classifier },
  );
  expect(requestState).not.toContain(secretPath);
  expect(requestState).not.toContain("outside branch image");
  expect(report.imageSkipped).toBe(1);
  expect(report.imageBytes).toBe(image.bytes);
  expect(report.imageMatches).toBe(0);
  expect(report.unavailableQueries).toEqual(["locate stolen credential values"]);
  expect(report.content.some((block) => block.type === "image")).toBe(false);
  const text = report.content.find((block) => block.type === "text");
  expect(text?.type === "text" ? text.text : "").not.toContain(secretPath);
});

function registeredRecall(f: Awaited<ReturnType<typeof fixture>>, classifier: RecallClassifier) {
  const tools: unknown[] = [];
  registerRecall({ registerTool: (tool) => { tools.push(tool); } }, () => f.root, { classifier });
  const tool = tools[0] as Parameters<ExtensionAPI["registerTool"]>[0] | undefined;
  if (!tool) throw Error("Recall tool not registered");
  const ctx = { sessionManager: f.manager } as unknown as ExtensionToolContext;
  return (query: string, signal = new AbortController().signal) =>
    tool.execute("offline-recall", { query, limit: 1 }, signal, undefined, ctx);
}

test("registered recall returns mixed content and reports billed usage", async () => {
  const f = await fixture(["Mira owns the migration plan."]);
  const image = await imageRecord(f.root, f.manager.getSessionId(), f.resultIds[0] ?? "", "System topology");
  f.manager.appendCustomEntry(IMAGE_ARCHIVE, { images: [image] });
  const invoke = registeredRecall(f, classifierChoosing((name) =>
    name.endsWith("_text") ? "text_0" : "image_0"));
  const result = await invoke("Who coordinates the move?");
  expect(result.usage).toEqual(usage);
  expect(result.content.some((block) => block.type === "image")).toBe(true);
  expect(result.details).toMatchObject({ rankingSource: "classifier", textMatches: 1, imageMatches: 1 });
});

test("registered recall exposes lexical fallback and retains usage", async () => {
  const f = await fixture(["Deployment architecture approved."]);
  const invoke = registeredRecall(f, async () => ({ ok: false, reason: "disabled", stage: "config", usage }));
  const result = await invoke("deployment architecture");
  expect(result.usage).toEqual(usage);
  expect(result.details).toMatchObject({ rankingSource: "lexical", fallbackReason: "disabled" });
  expect(result.content.some((block) =>
    block.type === "text" && block.text.includes("lexical fallback (disabled)"))).toBe(true);
});

test("registered recall preserves billed usage when cancelled after inference", async () => {
  const f = await fixture(["Saved approval."]);
  const controller = new AbortController();
  const invoke = registeredRecall(f, async () => {
    controller.abort(new Error("cancelled after inference"));
    return { ok: false, reason: "caller-cancellation", stage: "request", usage };
  });
  const result = await invoke("saved approval", controller.signal);
  expect(result.isError).toBe(true);
  expect(result.usage).toEqual(usage);
});

test("default limit ranks multiple results from one independent choice question", async () => {
  const f = await fixture(["First saved fact.", "Second saved fact.", "Third saved fact."]);
  let questions = 0;
  const report = await recallUnified(f.manager.getBranch(), f.root, f.manager.getSessionId(), ["Related evidence"], undefined, {
    classifier: async (input) => {
      questions = Object.keys(input.questions).length;
      return { ok: true, value: { answers: Object.fromEntries(Object.keys(input.questions).map((name) => [name, {
        type: "choice" as const, choice: "text_0",
        probabilities: { text_0: 0.6, text_1: 0.25, text_2: 0.1, no_match: 0.05 }, confidence: 0.6,
      }])) }, usage };
    },
  });
  expect(questions).toBe(1);
  expect(report.rankingSource).toBe("classifier");
  expect(report.textMatches).toBe(3);
});

test("selected text must still match the snapshot after inference", async () => {
  const f = await fixture(["Mira owns the migration plan."]);
  const path = f.paths[0];
  if (!path) throw Error("Missing saved archive");
  const select = classifierChoosing(() => "text_0");
  const report = await recallUnified(f.manager.getBranch(), f.root, f.manager.getSessionId(), ["Who coordinates the move?"], 1, {
    classifier: async (input, options) => {
      const result = await select(input, options);
      await writeFile(path, "Changed during classification.");
      return result;
    },
  });
  expect(report.textMatches).toBe(0);
  expect(report.skipped).toBe(1);
  expect(report.unavailableQueries).toEqual(["Who coordinates the move?"]);
});

test("failed image reads are charged once across batched queries", async () => {
  const f = await fixture(["Saved note."]);
  const image = await imageRecord(f.root, f.manager.getSessionId(), f.resultIds[0] ?? "", "Deployment topology");
  f.manager.appendCustomEntry(IMAGE_ARCHIVE, { images: [image] });
  await writeFile(image.path, "corrupted");
  const report = await recallUnified(f.manager.getBranch(), f.root, f.manager.getSessionId(),
    ["Find the deployment diagram", "Find the service topology"], 1, {
      classifier: classifierChoosing((name) => name.endsWith("_image") ? "image_0" : "no_match"),
    });
  expect(report.imageSkipped).toBe(1);
  expect(report.imageBytes).toBe(image.bytes);
  expect(report.unavailableQueries).toHaveLength(2);
});

test("nonlexical candidate pool spans different archived sources", async () => {
  const f = await fixture(Array.from({ length: 8 }, (_, index) =>
    Array.from({ length: 40 }, () => `Observation ${index} Mira owns the migration plan.`).join("\n")));
  let excerpts: string[] = [];
  await recallUnified(f.manager.getBranch(), f.root, f.manager.getSessionId(), ["Who coordinates this move?"], 1, {
    classifier: async (input) => {
      const candidates = input.state.text_candidates;
      if (!Array.isArray(candidates)) throw Error("Missing text candidates");
      excerpts = candidates.flatMap((candidate) =>
        typeof candidate === "object" && candidate !== null && "excerpt" in candidate &&
        typeof candidate.excerpt === "string" ? [candidate.excerpt] : []);
      return classifierChoosing(() => "no_match")(input, {});
    },
  });
  for (let index = 0; index < 8; index++)
    expect(excerpts.some((excerpt) => excerpt.includes(`Observation ${index} `))).toBe(true);
});
