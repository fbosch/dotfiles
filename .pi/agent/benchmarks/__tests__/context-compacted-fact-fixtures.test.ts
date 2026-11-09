import { expect, test } from "bun:test";
import {
  compactedFactCorpus,
  evidencePresent,
  messageEvidenceText,
  scoreCompactedProbes,
  selectCompactedQuestions,
  summarizeFactDimensions,
} from "../context-compacted-fact-fixtures";

const countBy = (values: readonly string[]) =>
  Object.fromEntries(
    [...new Set(values)].map((value) => [value, values.filter((item) => item === value).length]),
  );

test("diverse histories contain 1,000 entity-bound facts and 200 distinct revisions", () => {
  const corpus = compactedFactCorpus("design-check", "diverse");
  expect(corpus.facts).toHaveLength(1_000);
  expect(new Set(corpus.facts.map((fact) => fact.entity)).size).toBe(1_000);
  expect(corpus.archives).toHaveLength(120);
  expect(countBy(corpus.facts.map((fact) => fact.factType))).toEqual({
    identifier: 200,
    number: 200,
    path: 200,
    date: 200,
    danish: 200,
  });
  expect(corpus.facts.filter((fact) => fact.previous !== undefined)).toHaveLength(200);
  const originals = corpus.archives.map((archive) => archive.text).join("\n");
  for (const fact of corpus.facts) {
    expect(originals).toContain(fact.evidence);
    expect(fact.previous).not.toBe(fact.value);
  }
  expect(corpus).toEqual(compactedFactCorpus("design-check", "diverse"));
  expect(corpus.facts[0]?.value).not.toBe(
    compactedFactCorpus("different-seed", "diverse").facts[0]?.value,
  );
});

test("100 held-out questions balance fact types, wording, and revision status", () => {
  const corpus = compactedFactCorpus("sampling-check", "diverse");
  const selected = selectCompactedQuestions(corpus, "", "sampling-check", 100, "diverse");
  expect(selected.probes).toHaveLength(100);
  expect(new Set(selected.probes.map((probe) => probe.id)).size).toBe(100);
  expect(countBy(selected.probes.map((probe) => String(probe.factType)))).toEqual({
    identifier: 20,
    number: 20,
    path: 20,
    date: 20,
    danish: 20,
  });
  expect(countBy(selected.probes.map((probe) => String(probe.wording)))).toEqual({
    direct: 50,
    paraphrased: 50,
  });
  expect(selected.probes.filter((probe) => probe.rejected !== undefined)).toHaveLength(20);
  const visible = selected.probes.map((probe) => probe.evidence).join("\n");
  const resampled = selectCompactedQuestions(corpus, visible, "sampling-check", 100, "diverse");
  expect(
    resampled.probes.some((probe) => selected.probes.some((prior) => prior.id === probe.id)),
  ).toBe(false);
});

test("evidence coverage does not mistake unrelated numbers or identifier suffixes for an answer", () => {
  const fact = { entity: "svctargetq", value: "2" };
  expect(evidencePresent("Service otherq approved retry_ceiling: 2.", fact)).toBe(false);
  expect(evidencePresent("Service svctargetq approved retry_ceiling: 12.", fact)).toBe(false);
  expect(evidencePresent("2│Service svctargetq approved retry_ceiling: 12.", fact)).toBe(false);
  expect(evidencePresent("fact_2: What is retry_ceiling for service svctargetq?", fact)).toBe(
    false,
  );
  expect(evidencePresent("Service svctargetq approved retry_ceiling: 2.", fact)).toBe(true);
  expect(evidencePresent("svctargetq has two retries.", fact)).toBe(false);
  const question = "What is retry_ceiling for service svctargetq?";
  const content = messageEvidenceText([
    { role: "user", content: question, timestamp: 2 },
    { role: "assistant", content: [{ type: "text", text: "Service svctargetq has 2 retries." }] },
  ]);
  expect(evidencePresent(content, fact)).toBe(false);
});

test("receipt regression remains available and breakdowns preserve exact answer scoring", () => {
  const corpus = compactedFactCorpus("receipt-check", "receipt");
  const selected = selectCompactedQuestions(corpus, "", "receipt-check", 24, "receipt");
  expect(corpus.facts).toHaveLength(1_000);
  expect(corpus.archives).toHaveLength(102);
  expect(selected.probes.filter((probe) => probe.rejected !== undefined)).toHaveLength(2);
  const answers = Object.fromEntries(selected.probes.map((probe) => [probe.id, probe.expected]));
  const score = scoreCompactedProbes(selected.probes, JSON.stringify(answers));
  expect(score.positiveCorrect).toBe(24);
  expect(summarizeFactDimensions(score.checks).byFactType).toEqual([
    { group: "receipt", correct: 24, total: 24, stale: 0, unanswered: 0 },
  ]);
  expect(scoreCompactedProbes(selected.probes, "{}").valid).toBe(false);
});
