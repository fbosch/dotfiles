import { afterEach, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { largeRecallCorpus } from "../../../benchmarks/context-recall-large-corpus";
import {
  meterClassifier,
  recallSession,
  runLiveRecallEval,
  runRecallEval,
  summarizeLiveRecallEval,
  summarizeRecallEval,
} from "../../../benchmarks/context-recall-offline";
import { userStartEvent } from "../../shared/__tests__/agent-start-events";
import { RECALL_LIMITS, recallSavedBatch, recallUnified, registerRecallPrefetch } from "../recall";
import { approveEveryCandidate } from "./fixtures";

const sessions: Awaited<ReturnType<typeof recallSession>>[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.cleanup();
});

async function setup() {
  const corpus = largeRecallCorpus();
  const session = await recallSession(corpus.archives);
  sessions.push(session);
  return { ...corpus, ...session };
}

test("large corpus has 1,000 distinct facts, chronological revisions, and source-free probes", () => {
  const corpus = largeRecallCorpus();
  expect(corpus.facts).toHaveLength(1_000);
  expect(new Set(corpus.facts.map((fact) => fact.entity)).size).toBe(1_000);
  expect(new Set(corpus.facts.map((fact) => fact.value)).size).toBe(1_000);
  expect(corpus.archives).toHaveLength(102);
  expect(corpus.probes).toHaveLength(10);
  expect(corpus).toEqual(largeRecallCorpus());
  expect(corpus.facts[0]?.value).not.toBe(largeRecallCorpus("another-seed").facts[0]?.value);
  const metadata = JSON.stringify(corpus.archives.map((archive) => archive.args));
  const questions = corpus.probes.map((probe) => probe.question).join("\n");
  for (const fact of corpus.facts) {
    expect(metadata).not.toContain(fact.value);
    expect(questions).not.toContain(fact.value);
    expect(questions).not.toContain(fact.source);
    expect(corpus.archives.some((archive) => archive.text.includes(fact.value))).toBe(true);
  }
  for (const probe of corpus.probes) {
    const { stale, expected } = probe;
    if (stale === undefined) continue;
    if (expected === null) throw new Error("Revised probe needs a current value");
    const old = corpus.archives.findIndex((archive) => archive.text.includes(stale));
    const current = corpus.archives.findIndex((archive) => archive.text.includes(expected));
    expect(old).toBeGreaterThanOrEqual(0);
    expect(current).toBeGreaterThan(old);
  }
});

test("source-free batch retrieves eight old, middle, and recent facts with exact saved citations", async () => {
  const f = await setup();
  const probes = f.probes.filter((probe) => probe.expected !== null);
  const report = await recallSavedBatch(
    f.manager.getBranch(),
    f.root,
    probes.map((probe) => probe.question),
    1,
  );
  expect(report.queries).toHaveLength(8);
  expect(report.scanned).toBe(f.archives.length);
  expect(report.bytes).toBe(
    2 * f.archives.reduce((sum, archive) => sum + Buffer.byteLength(archive.text), 0),
  );
  expect(report.skipped).toBe(0);
  expect(report.limited).toBe(false);
  expect(report.text.length).toBeLessThanOrEqual(RECALL_LIMITS.outputChars);
  for (const [index, target] of f.targets.entries()) {
    const passage = report.queries[index]?.passages[0];
    if (!passage) throw new Error(`Missing passage for ${target.entity}`);
    expect(passage.text).toContain(target.value);
    expect(passage.call).toContain(target.source);
    expect(passage.from).toBeLessThanOrEqual(target.line);
    expect(passage.to).toBeGreaterThanOrEqual(target.line);
    const saved = await readFile(passage.path, "utf8");
    expect(saved.split("\n")[target.line - 1]).toBe(
      `Service ${target.entity} approved receipt: ${target.value}.`,
    );
    expect(report.text).toContain(`Saved path: ${passage.path}`);
    expect(report.text).toContain(
      `${target.line}│Service ${target.entity} approved receipt: ${target.value}.`,
    );
    const stale = probes[index]?.stale;
    if (stale) expect(passage.text).not.toContain(stale);
  }
});

test("every one of the 1,000 facts is reachable through explicit recall and prefetch without source hints", async () => {
  const f = await setup();
  type Handler = (
    event: BeforeAgentStartEvent,
    ctx: ExtensionContext,
  ) => Promise<BeforeAgentStartEventResult | undefined>;
  let handler: Handler | undefined;
  registerRecallPrefetch(
    {
      on: (_name: string, callback: Handler) => {
        handler = callback;
      },
    } as unknown as Pick<ExtensionAPI, "on">,
    () => f.root,
    () => true,
    { classifier: approveEveryCandidate },
  );
  if (!handler) throw new Error("Missing prefetch hook");
  const ctx = { sessionManager: f.manager } as unknown as ExtensionContext;
  const branch = f.manager.getBranch();
  for (let start = 0; start < f.facts.length; start += 8) {
    const facts = f.facts.slice(start, start + 8);
    const questions = facts.map(
      (fact) => `What is the approved receipt for service ${fact.entity}?`,
    );
    const report = await recallUnified(branch, f.root, f.manager.getSessionId(), questions, 1, {
      classifier: async () => ({ ok: false, reason: "disabled", stage: "config" }),
    });
    const explicit = report.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n");
    // The stub isolates retrieval and lexical admission; the hosted evaluation measures model selection.
    const prefetched = await handler(userStartEvent(questions.join("\n")), ctx);
    const content = prefetched?.message?.content;
    if (typeof content !== "string")
      throw new Error(`Missing prefetch for facts ${start}–${start + 7}`);
    for (const fact of facts) {
      expect(explicit).toContain(fact.value);
      expect(content).toContain(fact.value);
    }
    expect(report.scanned).toBe(f.archives.length);
    expect(report.skipped).toBe(0);
    expect(report.candidateCount.text).toBeLessThanOrEqual(RECALL_LIMITS.textCandidates);
    expect(explicit.length).toBeLessThanOrEqual(RECALL_LIMITS.outputChars);
    expect(content.length).toBeLessThanOrEqual(RECALL_LIMITS.outputChars);
  }
}, 120_000);

test("source-free recall and prefetch recover the oldest fact across the former 80-archive boundary", async () => {
  const corpus = largeRecallCorpus();
  const probe = corpus.probes[0];
  if (!probe) throw new Error("Missing oldest probe");
  for (const size of [1, 80, 81, 102]) {
    const result = await runRecallEval(corpus.archives.slice(0, size), [probe]);
    expect(result.explicit[0]?.hit1).toBe(true);
    expect(result.explicit[0]?.pool12).toBe(true);
    expect(summarizeRecallEval(result).prefetchAnswered).toBe(1);
  }
});

test("live evaluation reports classifier failure separately from retrieval success", async () => {
  const corpus = largeRecallCorpus();
  const meter = meterClassifier(async () => ({ ok: false, reason: "timeout", stage: "request" }));
  const probes = corpus.probes.filter(
    (probe) => probe.id === "fact-5" || probe.id === "unknown-field",
  );
  expect(probes).toHaveLength(2);
  const result = await runLiveRecallEval(meter.classify, corpus.archives, probes);
  const summary = summarizeLiveRecallEval(result, meter);
  expect(summary.explicitLexicalFallbacks).toBe(2);
  expect(summary.classifierFailures.timeout).toBeGreaterThan(0);
  expect(summary.explicitAnswered).toBe(1);
  expect(summary.maxScanned).toBe(corpus.archives.length);
  expect(summary.maxOutputChars).toBeLessThanOrEqual(RECALL_LIMITS.outputChars);
  expect(summary.prefetchAnswered).toBe(0);
  expect(summary.prefetchInjectedOnNearMiss).toBe(0);
});
