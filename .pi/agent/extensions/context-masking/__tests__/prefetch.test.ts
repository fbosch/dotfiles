import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClassifierAnswer } from "@earendil-works/pi-ai";
import type { BeforeAgentStartEvent, BeforeAgentStartEventResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { RECALL_PREFETCH_TASK, prefetchTuning, type RecallClassifier, recallSaved, registerRecallPrefetch } from "../recall";
import { approveEveryCandidate, sessionWith } from "./fixtures";
import { userStartEvent } from "../../shared/__tests__/agent-start-events";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function setup(texts: string[], options: { classifier?: RecallClassifier } = {}) {
  const root = await mkdtemp(join(tmpdir(), "prefetch-evidence-"));
  roots.push(root);
  const { manager, resultIds } = sessionWith(texts.map(() => ({ resultChars: 1000 })));
  const dir = join(root, manager.getSessionId());
  await mkdir(dir);
  const paths: string[] = [];
  for (const [index, content] of texts.entries()) {
    const path = join(dir, `${resultIds[index]}.txt`);
    await writeFile(path, content);
    paths.push(path);
  }
  manager.appendCustomEntry("context-masking", { items: paths.map((path, index) => ({ path, entryId: resultIds[index]!, toolName: "read" })) });
  type Handler = (event: BeforeAgentStartEvent, ctx: ExtensionContext) => Promise<BeforeAgentStartEventResult | undefined>;
  let handler: Handler | undefined;
  registerRecallPrefetch({ on: (_name: string, callback: Handler) => { handler = callback; } } as unknown as Pick<ExtensionAPI, "on">, () => root, () => true, {
    classifier: options.classifier ?? approveEveryCandidate,
  });
  const invoke = async (prompt: string) => {
    if (!handler) throw Error("Missing prefetch handler");
    return handler(userStartEvent(prompt), { sessionManager: manager } as unknown as ExtensionContext);
  };
  return { manager, root, paths, invoke };
}

test("query echo and search framing cannot outrank nested evidence; manual recall remains literal", async () => {
  const f = await setup([
    'Saved-result search: 2 artifacts\nQuery: What was the archived audit receipt?\noutput: What was the archived audit receipt?',
    'Saved-result search: 1 artifact\nQuery: What was the archived audit receipt?\n5│Archived audit receipt: actual-314',
  ]);
  const result = await f.invoke("What was the archived audit receipt?");
  expect(result?.message?.content).toContain("actual-314");
  expect(result?.message?.content).not.toContain(f.paths[0]);
  expect(result?.message?.content).toContain(f.paths[1]);
  expect((await recallSaved(f.manager.getBranch(), f.root, "archived audit receipt")).passages.length).toBeGreaterThan(0);
});

test("structured data and neighboring lines remain evidence; exact identifier needs one term", async () => {
  const f = await setup([
    '{\n"output": "Archived audit receipt: structured-11"\n}',
    'Archived audit\nreceipt: adjacent-22',
    '"path": "audit-æøå-314"',
  ]);
  expect((await f.invoke("What was the archived audit receipt?"))?.message?.content).toContain("structured-11");
  expect((await f.invoke("What was the archived audit receipt?"))?.message?.content).toContain("adjacent-22");
  expect((await f.invoke("audit-æøå-314"))?.message?.content).toContain("audit-æøå-314");
});

test("common words matching a minority of the question do not trigger prefetch", async () => {
  let calls = 0;
  const f = await setup(
    ["Adapt the tool to your workflows, not the other way around.\nImprove the wording without changing any behavior."],
    {
      classifier: async (input, options) => {
        calls++;
        return approveEveryCandidate(input, options);
      },
    },
  );
  expect(await f.invoke("any way we can improve retrieval quality?")).toBeUndefined();
  expect(calls).toBe(0);
});

test("prefetch finds facts inside JSON-encoded saved output", async () => {
  const output = [
    ...Array.from({ length: 30 }, (_, i) => `routine step ${i}: passed`),
    "Archived audit receipt: encoded-417",
    ...Array.from({ length: 30 }, (_, i) => `trailing step ${i}: passed`),
  ].join("\n");
  const f = await setup([JSON.stringify({ result: output })]);
  const content = String((await f.invoke("What was the archived audit receipt?"))?.message?.content);
  expect(content).toContain("1│Archived audit receipt: encoded-417");
  expect(content).not.toContain("routine step 29: passed\\n");
});

test("deduplicates nested artifacts and balances distinct answers across questions", async () => {
  const f = await setup([
    'Archived audit receipt: shared-314',
    '5│Archived audit receipt: shared-314',
    'Archived audit receipt: alternate-315',
    'Archived audit receipt: audit-only-316\nApproved schema version: schema-7',
  ]);
  const result = await f.invoke("What was the archived audit receipt? Which schema version was approved?");
  const content = String(result?.message?.content);
  expect(content).toContain("schema-7");
  expect(content.split("shared-314").length - 1).toBeLessThanOrEqual(1);
});

test("visible passages are not reinjected when the batch changes; sessions remain isolated", async () => {
  const f = await setup(['Archived audit receipt: visible-314', 'Approved schema version: unseen-7']);
  const first = await f.invoke("What was the archived audit receipt?");
  if (!first?.message) throw Error("Missing prefetch");
  f.manager.appendCustomMessageEntry(first.message.customType, first.message.content, false);
  const next = await f.invoke("What was the archived audit receipt? Which schema version was approved?");
  expect(next?.message?.content).toContain("unseen-7");
  expect(next?.message?.content).not.toContain("visible-314");
  const other = await setup(['Archived audit receipt: visible-314']);
  expect((await other.invoke("What was the archived audit receipt?"))?.message?.content).toContain("visible-314");
});

for (const withImage of [false, true]) {
  test(`deduplicates structured recall passages (${withImage ? "text and image" : "text only"})`, async () => {
    const f = await setup(['Archived audit receipt: visible-314', 'Approved schema version: unseen-7']);
    const first = await f.invoke("What was the archived audit receipt?");
    if (!first?.message || typeof first.message.content !== "string") throw Error("Missing text prefetch");
    f.manager.appendCustomMessageEntry(first.message.customType, [
      { type: "text", text: first.message.content },
      ...(withImage ? [{ type: "image" as const, data: "AA==", mimeType: "image/png" }] : []),
    ], false);

    const next = await f.invoke("What was the archived audit receipt? Which schema version was approved?");
    expect(next?.message?.content).toContain("unseen-7");
    expect(next?.message?.content).not.toContain("visible-314");
  });
}

test("prefetch injects only the passage the classifier says answers the question", async () => {
  const seen: { task?: unknown; candidates: number } = { candidates: 0 };
  const chooseSecond: RecallClassifier = async (input) => {
    seen.task = input.state.task;
    const answers: Record<string, ClassifierAnswer> = {};
    for (const [name, question] of Object.entries(input.questions)) {
      if (question.type !== "choice") continue;
      const choices = Object.keys(question.criteria);
      seen.candidates += choices.length - 1;
      const choice = choices[1] ?? "no_match";
      answers[name] = {
        type: "choice",
        choice,
        probabilities: Object.fromEntries(choices.map((key) => [key, key === choice ? 1 : 0])),
        confidence: 1,
      };
    }
    return { ok: true, value: { answers } };
  };
  const f = await setup(
    ["Archived audit receipt: first-101", "Archived audit receipt: second-202"],
    { classifier: chooseSecond },
  );
  const content = String((await f.invoke("What was the archived audit receipt?"))?.message?.content);
  expect(seen.task).toBe(RECALL_PREFETCH_TASK);
  expect(seen.candidates).toBe(2);
  expect(content.split("Archived audit receipt:").length - 1).toBe(1);
});

test("prefetch injects nothing when the classifier rejects every candidate or fails", async () => {
  const texts = ["Archived audit receipt: gated-314"];
  const noMatch: RecallClassifier = async (input) => ({
    ok: true,
    value: {
      answers: Object.fromEntries(Object.keys(input.questions).map((name) => [name, {
        type: "choice" as const, choice: "no_match", probabilities: { no_match: 1 }, confidence: 1,
      }])),
    },
  });
  const failure: RecallClassifier = async () => ({ ok: false, reason: "timeout", stage: "request" });
  const throwing: RecallClassifier = async () => { throw new Error("transport down"); };
  for (const classifier of [noMatch, failure, throwing]) {
    const f = await setup(texts, { classifier });
    expect(await f.invoke("What was the archived audit receipt?")).toBeUndefined();
  }
});

test("prefetch skips the classifier when no lexical match passes the gate", async () => {
  let calls = 0;
  const counting: RecallClassifier = async (input, options) => {
    calls++;
    return approveEveryCandidate(input, options);
  };
  const f = await setup(["Archived audit receipt: idle-314"], { classifier: counting });
  expect(await f.invoke("go ahead")).toBeUndefined();
  expect(calls).toBe(0);
});

test("prefetch injects only candidates that beat no_match by the tuned margin", async () => {
  const scored = (probability: number): RecallClassifier => async (input) => {
    const answers: Record<string, ClassifierAnswer> = {};
    for (const [name, question] of Object.entries(input.questions)) {
      if (question.type !== "choice") continue;
      const candidate = Object.keys(question.criteria).find((key) => key !== "no_match") ?? "no_match";
      answers[name] = {
        type: "choice",
        choice: candidate,
        probabilities: { [candidate]: probability, no_match: 1 - probability },
        confidence: probability,
      };
    }
    return { ok: true, value: { answers } };
  };
  const saved = prefetchTuning.margin;
  prefetchTuning.margin = 0.1;
  try {
    const texts = ["Archived audit receipt: margin-314"];
    const nearTie = await setup(texts, { classifier: scored(0.52) });
    expect(await nearTie.invoke("What was the archived audit receipt?")).toBeUndefined();
    const clear = await setup(texts, { classifier: scored(0.7) });
    expect(String((await clear.invoke("What was the archived audit receipt?"))?.message?.content)).toContain(
      "margin-314",
    );
  } finally {
    prefetchTuning.margin = saved;
  }
});
