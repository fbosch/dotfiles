import { expect, test } from "bun:test";
import { recallProbes, runRecallEval, summarizeRecallEval } from "../context-recall-offline";

test("offline recall evaluation covers every probe category", () => {
  const probes = recallProbes();
  expect(new Set(probes.map((probe) => probe.id)).size).toBe(probes.length);
  expect(new Set(probes.map((probe) => probe.category))).toEqual(
    new Set([
      "identifier",
      "escaped-json",
      "duplicate",
      "superseded",
      "log",
      "path",
      "danish",
      "distractor",
      "near-miss",
    ]),
  );
  expect(probes.filter((probe) => probe.expected === null).every((probe) => probe.prefetch)).toBe(
    true,
  );
});

test("explicit recall and prefetch stay at or above the recorded offline floor", async () => {
  const summary = summarizeRecallEval(await runRecallEval());
  expect(summary.hit3).toBe(1);
  expect(summary.hit1).toBeGreaterThanOrEqual(0.9);
  expect(summary.candidateRecall12).toBeGreaterThanOrEqual(0.9);
  expect(summary.stale1).toBe(0);
  expect(summary.clippedPassages).toBe(0);
  expect(summary.redundantSlots).toBe(0);
  expect(summary.prefetchAnswered).toBeGreaterThanOrEqual(0.8);
  // Coverage 0.3 lets one distractor reach the classifier; more means the lexical gate regressed.
  expect(summary.distractorsPastLexicalGate).toBeLessThanOrEqual(1);
  // Near-misses exist to exercise the classifier; most must get past the lexical gate.
  expect(summary.nearMissesPastLexicalGate).toBeGreaterThanOrEqual(2);
});
