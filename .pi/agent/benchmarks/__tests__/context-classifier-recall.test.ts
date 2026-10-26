import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLASSIFIER_DEFAULTS,
  type ClassifierResponse,
  classifyCompaction,
} from "../../extensions/context-masking/classifier-compaction";
import { recallSaved } from "../../extensions/context-masking/recall";
import { answerPrompt, hydrateHistory, prepareRecallHistory } from "../context-classifier-recall";
import { factCoverage, recallFixture, scoreRecall } from "../context-classifier-recall-fixtures";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function prepared(seed = "unit-1") {
  const root = await mkdtemp(join(tmpdir(), "classifier-recall-test-"));
  roots.push(root);
  const fixture = recallFixture(seed);
  return { fixture, history: await prepareRecallHistory(fixture, root) };
}
test("seeded facts differ, remain confined to saved outputs, and opaque calls do not disclose them", async () => {
  const { fixture, history } = await prepared();
  const other = recallFixture("unit-2");
  expect(fixture.outputs).toEqual(recallFixture("unit-1").outputs);
  expect(fixture.probes[0]?.expected).not.toBe(other.probes[0]?.expected);
  const hydrated = await hydrateHistory(history);
  for (const probe of fixture.probes) {
    expect(history.visible).not.toContain(probe.question);
    if (probe.expected !== null && !/^\d+$/u.test(probe.expected)) {
      expect(history.visible).not.toContain(probe.expected);
      expect(JSON.stringify(history.input.messages)).not.toContain(probe.expected);
      expect(hydrated).toContain(probe.expected);
    }
  }
  expect(factCoverage(fixture.probes, hydrated)).toEqual({ present: 5, total: 5 });
});
test("future questions and expected answers cannot leak through answer prompts", () => {
  const fixture = recallFixture("score");
  const prompt = answerPrompt(fixture, "memory", "");
  for (const probe of fixture.probes) {
    expect(prompt).toContain(probe.question);
    if (probe.expected !== null && !/^\d+$/u.test(probe.expected))
      expect(prompt).not.toContain(probe.expected);
  }
});
test("exact scoring separates current, unexpected, unknown and stale facts", () => {
  const f = recallFixture("score");
  const correct = Object.fromEntries(f.probes.map((p) => [p.id, p.expected]));
  let score = scoreRecall(f.probes, JSON.stringify(correct));
  expect(score.positiveCorrect).toBe(6);
  expect(score.currentCorrect).toBe(4);
  expect(score.surpriseCorrect).toBe(2);
  expect(score.unknownCorrect).toBe(1);
  score = scoreRecall(f.probes, JSON.stringify({ ...correct, schema: f.probes[0]?.rejected }));
  expect(score.positiveCorrect).toBe(5);
  expect(score.staleAnswers).toBe(1);
  expect(scoreRecall(f.probes, "{}").valid).toBe(false);
  expect(scoreRecall(f.probes, "not JSON").positiveCorrect).toBe(0);
  expect(scoreRecall(f.probes, JSON.stringify({ ...correct, extra: "invented" })).valid).toBe(
    false,
  );
});
test("bounded shared retrieval recovers actual facts without oracle values or paths in the query", async () => {
  const { fixture, history } = await prepared();
  for (const probe of fixture.probes.filter((p) => p.expected !== null)) {
    const result = await recallSaved(history.input.branch, history.artifactRoot, probe.question, 3);
    expect(result.limited).toBe(false);
    expect(result.skipped).toBe(0);
    expect(result.text).toContain(probe.expected ?? "");
    expect(probe.question).not.toContain(history.artifactRoot);
    if (probe.expected !== null && !/^\d+$/u.test(probe.expected))
      expect(probe.question).not.toContain(probe.expected);
  }
});
test("actual candidate packets include artifact bodies only for the content-aware arm and never future questions", async () => {
  const { fixture, history } = await prepared();
  const original = await hydrateHistory(history);
  for (const includeContent of [false, true]) {
    let requests = 0;
    const outcome = await classifyCompaction(
      history.input,
      {
        ...CLASSIFIER_DEFAULTS,
        enabled: true,
        includeContent,
        maxOutputBytes: 4_000,
      },
      {
        artifactRoot: history.artifactRoot,
        classify: async (request): Promise<ClassifierResponse> => {
          requests++;
          const serialized = JSON.stringify(request);
          for (const p of fixture.probes) expect(serialized).not.toContain(p.question);
          expect(serialized.includes("actualToolOutput")).toBe(includeContent);
          return {
            api: "typesafe-system-one",
            provider: "test",
            model: "test",
            timestamp: 0,
            stopReason: "stop",
            answers: Object.fromEntries(
              Object.keys(request.questions).map((name) => [
                name,
                { type: "bool", probability: 0 },
              ]),
            ),
          };
        },
      },
    );
    expect(requests).toBeGreaterThan(0);
    expect(outcome.kind).toBe("retained");
    expect(outcome.text).toContain(fixture.goal);
    expect(await hydrateHistory(history)).toBe(original);
  }
});
