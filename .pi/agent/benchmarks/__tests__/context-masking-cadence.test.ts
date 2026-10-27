import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import {
  CADENCE_SETTINGS, argumentKey, eligibleObservations, hash, historySnapshot,
  makeFixture, scoreProbe, shouldAssess,
} from "../context-masking-cadence-policy";
import {
  CADENCE_PROVIDER_OPTIONS, cacheSessionId, classificationInput, packAssessments, retrieveOriginal, runCadenceComparison,
  runCadenceRow, summarizeCadence, validateDecisions, type CadenceAdapters,
} from "../context-masking-cadence";

const roots: string[] = [];
async function temporary() { const root = await mkdtemp(join(tmpdir(), "cadence-test-")); roots.push(root); return root; }
afterAll(async () => { await Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))); });
const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const classify: CadenceAdapters["classify"] = async input => ({ api: "typesafe-system-one", provider: "test", model: "test",
  stopReason: "stop", timestamp: 0, usage,
  answers: Object.fromEntries(Object.keys(input.questions).map(id => [id, { type: "bool", probability: 0 }])) });
const answer: CadenceAdapters["answer"] = async () => ({ role: "assistant", api: "test", provider: "test", model: "test", usage,
  stopReason: "stop", timestamp: 0, content: [{ type: "text", text: '{"migration":null,"schema":null,"route":null,"owner":null}' }] });

describe("matched rolling-mask schedules", () => {
  test("ten-turn and token triggers share eligibility but fire at different times", () => {
    const fixture = makeFixture(1), assessed = new Set<string>();
    expect(shouldAssess("ten-turn", 10, eligibleObservations(fixture.turns.slice(0, 10).map(t => t.observation), 10, assessed))).toBe(false);
    const at19 = eligibleObservations(fixture.turns.slice(0, 19).map(t => t.observation), 19, assessed);
    expect(at19.every(observation => observation.turn <= 9)).toBe(true);
    expect(shouldAssess("ten-turn", 19, at19)).toBe(false);
    expect(shouldAssess("token-budget", 19, at19)).toBe(true);
    expect(shouldAssess("ten-turn", 20, at19)).toBe(true);
    expect(shouldAssess("token-budget", 20, [])).toBe(false);
  });

  test("protects pins and unresolved errors; only an exact successful retry releases failure", () => {
    const fixture = makeFixture(0), seen = fixture.turns.slice(0, 15).map(t => t.observation);
    const failure = seen.find(item => item.isError);
    expect(failure).toBeDefined();
    expect(eligibleObservations(seen, 30, new Set()).some(item => item.id === failure?.id || item.pinned)).toBe(false);
    const retry = fixture.turns[15]?.observation;
    if (!retry || !failure) throw Error("Fixture retry missing");
    expect(eligibleObservations([...seen, { ...retry, args: { suite: "other" } }], 30, new Set()).some(item => item.id === failure.id)).toBe(false);
    expect(eligibleObservations([...seen, retry], 30, new Set()).some(item => item.id === failure.id)).toBe(true);
    expect(argumentKey({ ...retry, args: { suite: "migration", mode: "fast" } })).toBe(argumentKey({ ...retry, args: { mode: "fast", suite: "migration" } }));
    expect(eligibleObservations(seen, 30, new Set(["observation-2"])).some(item => item.id === "observation-2")).toBe(false);
  });

  test("snapshot uses only already-observed history with complete bounded exchanges", () => {
    const fixture = makeFixture(1), snapshot = historySnapshot(fixture, 12);
    expect(snapshot.recentTurns.every(item => item.number <= 12)).toBe(true);
    expect(snapshot.recentTurns.length + snapshot.omittedRecentTurns).toBe(10);
    expect(Buffer.byteLength(JSON.stringify(snapshot.recentTurns))).toBeLessThan(CADENCE_SETTINGS.historyBytes + 100);
    expect(JSON.stringify(snapshot)).not.toContain(fixture.probes[30]?.find(fact => fact.key === "route")?.expected);
    expect(snapshot.latestUserDirection).toContain("migration A");
    expect(historySnapshot(fixture, 20).latestUserDirection).toContain("routing incident B");
  });

  test("request packing preserves full candidate bodies and marks oversize candidates", () => {
    const fixture = makeFixture(2), snapshot = historySnapshot(fixture, 30);
    const candidates = fixture.turns.slice(0, 20).map(t => t.observation);
    const oversized = { ...candidates[0], id: "oversized", turn: 1, tool: "read", args: { path: "huge" }, text: "x".repeat(40_000), isError: false, pinned: false };
    const packed = packAssessments(snapshot, [...candidates, oversized]);
    expect(packed.deferred).toEqual(["oversized"]);
    expect(packed.groups.flat().map(candidate => candidate.id)).toEqual(candidates.map(candidate => candidate.id));
    for (const group of packed.groups) {
      const request = classificationInput(snapshot, group);
      expect(Buffer.byteLength(JSON.stringify(request))).toBeLessThanOrEqual(CADENCE_SETTINGS.maxRequestBytes);
      for (const candidate of group) expect(JSON.stringify(request)).toContain(JSON.stringify(candidate.text));
    }
    const contract = fixture.turns[2]?.observation;
    if (!contract) throw Error("Missing contract");
    expect(JSON.stringify(classificationInput(snapshot, [contract]))).toContain("æøå");
  });

  test("uncertain decisions retain evidence; malformed responses cannot authorize masks", async () => {
    const observation = makeFixture(0).turns[0]?.observation;
    if (!observation) throw Error("Missing candidate");
    const input = classificationInput(historySnapshot(makeFixture(0), 20), [observation]);
    const result = await classify(input, new AbortController().signal);
    expect(validateDecisions(result, [observation]).get(observation.id)).toBe(false);
    result.answers[observation.id] = { type: "bool", probability: 0.5 };
    expect(validateDecisions(result, [observation]).get(observation.id)).toBe(true);
    result.answers[observation.id] = { type: "bool", probability: Number.NaN };
    expect(() => validateDecisions(result, [observation])).toThrow("Invalid classifier answer");
  });

  test("offline paired replay preserves originals and does not fabricate live measurements", async () => {
    const result = await runCadenceComparison(await temporary());
    expect(result.rows).toHaveLength(6);
    for (const row of result.rows) {
      expect(row.complete && row.originalsPreserved).toBe(true);
      expect(row.calls).toEqual([]);
      expect(row.probes).toHaveLength(3);
      expect(row.probes.map(probe => probe.turn)).toEqual([...CADENCE_SETTINGS.probeTurns]);
      expect(row.probes.every(probe => probe.score === undefined)).toBe(true);
      expect(row.batches.every(batch => batch.masked.every(id => row.batches.filter(other => other.masked.includes(id)).length === 1))).toBe(true);
    }
    for (const seed of ["cadence-1", "cadence-2", "cadence-3"]) {
      const pair = result.rows.filter(row => row.seed === seed);
      expect(new Set(pair.map(row => row.fixtureHash)).size).toBe(1);
    }
    const fixed = result.rows.find(row => row.seed === "cadence-2" && row.arm === "ten-turn");
    const tokens = result.rows.find(row => row.seed === "cadence-2" && row.arm === "token-budget");
    expect(fixed?.batches.map(batch => batch.turn)).toEqual([20, 30]);
    expect(tokens?.batches.some(batch => batch.turn < 20)).toBe(true);
    expect(result.summary.every(summary => summary.usage === null && summary.total === 0)).toBe(true);
  });

  test("bounded adapters exercise live probes and record usage independently of offline estimates", async () => {
    const row = await runCadenceRow(await temporary(), 0, "ten-turn", { classify, answer });
    expect(row.probes.every(probe => probe.score?.valid)).toBe(true);
    expect(row.probes.every(probe => probe.calls === 1)).toBe(true);
    expect(row.calls.some(call => call.kind === "classifier")).toBe(true);
    expect(row.calls.filter(call => call.kind === "model")).toHaveLength(3);
    expect(summarizeCadence([row])[0]?.usageComplete).toBe(true);
  });

  test("repeated cohorts use different namespaces while each row remains stable", async () => {
    const capture = async () => {
      const prompts: string[] = [];
      await runCadenceRow(await temporary(), 0, "ten-turn", { classify, answer: async (context, signal) => {
        prompts.push(context.systemPrompt ?? "");
        return answer(context, signal);
      } });
      expect(prompts).toHaveLength(3);
      expect(new Set(prompts).size).toBe(1);
      const namespace = prompts[0];
      if (!namespace) throw Error("Missing replay namespace");
      return namespace;
    };
    expect(await capture()).not.toBe(await capture());
  });

  test("cache session keys remain stable within an arm and isolated across arms", () => {
    const context = { systemPrompt: "Independent synthetic replay namespace arm-A", messages: [] };
    expect(cacheSessionId(context)).toBe(cacheSessionId({ ...context, messages: [{ role: "user", content: "new turn", timestamp: 1 }] }));
    expect(cacheSessionId(context)).not.toBe(cacheSessionId({ ...context, systemPrompt: "Independent synthetic replay namespace arm-B" }));
    expect(() => cacheSessionId({ messages: [] })).toThrow("Missing isolated");
  });

  test("probe answers never become evidence for later probes", async () => {
    let requests = 0;
    const laterHistory: string[] = [];
    await runCadenceRow(await temporary(), 0, "ten-turn", {
      classify,
      answer: async (context, signal) => {
        requests++;
        if (requests > 1) laterHistory.push(JSON.stringify(context.messages));
        const response = await answer(context, signal);
        return requests === 1 ? { ...response, content: [{ type: "text", text: '{"migration":"PROBE_ONLY_SENTINEL"}' }] } : response;
      },
    });
    expect(laterHistory).toHaveLength(2);
    expect(laterHistory.every(history => !history.includes("PROBE_ONLY_SENTINEL"))).toBe(true);
    expect(CADENCE_PROVIDER_OPTIONS.maxRetries).toBe(0);
  });

  test("a probe can recover a masked original through the declared recall tool", async () => {
    let requests = 0, recovered = "", laterProbeHistory = "";
    const row = await runCadenceRow(await temporary(), 0, "ten-turn", {
      classify,
      answer: async (context, signal) => {
        requests++;
        if (requests === 4) laterProbeHistory = JSON.stringify(context.messages);
        const last = context.messages.at(-1);
        if (last?.role === "toolResult" && last.toolName === "recall_observation")
          recovered = last.content.filter(block => block.type === "text").map(block => block.text).join("\n");
        const response: AssistantMessage = await answer(context, signal);
        return requests === 2 ? { ...response, stopReason: "toolUse", content: [{ type: "toolCall", id: "recall-test", name: "recall_observation", arguments: { id: "observation-2" } }] } : response;
      },
    });
    expect(row.probes.reduce((sum, probe) => sum + probe.recalls, 0)).toBe(1);
    expect(row.calls.filter(call => call.kind === "model")).toHaveLength(4);
    expect(recovered).toContain("Migration A checksum:");
    const migration = makeFixture(0).probes[30]?.find(fact => fact.key === "migration");
    if (!migration) throw Error("Missing migration fixture");
    expect(laterProbeHistory).not.toContain(migration.expected);
  });

  test("a recall-limit violation fails only its probe, not the paired campaign", async () => {
    let requests = 0;
    const row = await runCadenceRow(await temporary(), 0, "ten-turn", {
      classify,
      answer: async (context, signal) => {
        const response = await answer(context, signal);
        if (++requests !== 1) return response;
        return { ...response, stopReason: "toolUse", content: ["observation-1", "observation-2", "observation-4"].map((id, index) => ({ type: "toolCall" as const, id: "excess-" + index, name: "recall_observation", arguments: { id } })) };
      },
    });
    expect(row.complete && row.originalsPreserved).toBe(true);
    expect(row.probes).toHaveLength(3);
    expect(row.probes[0]?.failure).toBe("Probe exceeded its exact-ID recall allowance");
    expect(row.probes[0]?.score?.correct).toBe(0);
    expect(row.probes[0]?.score?.total).toBe(2);
    expect(row.probes[0]?.recalls).toBe(3);
    expect(row.probes[0]?.recallsServed).toBe(0);
    expect(summarizeCadence([row])[0]?.failedProbes).toBe(1);
    expect(row.calls.filter(call => call.kind === "model")).toHaveLength(3);
  });

  test("classification failure leaves a partial row and exact originals for diagnosis", async () => {
    const root = await temporary();
    await expect(runCadenceRow(root, 0, "ten-turn", { answer, classify: async () => { throw Error("simulated provider failure"); } })).rejects.toThrow("simulated provider failure");
    const partial = JSON.parse(await readFile(join(root, "cadence-1", "ten-turn", "row.json"), "utf8"));
    expect(partial.complete).toBe(false);
    expect(partial.calls.some((call: { error?: string }) => call.error === "simulated provider failure")).toBe(true);
    expect(hash(await readFile(join(root, "cadence-1", "ten-turn", "observation-2.txt"), "utf8"))).toBe(hash(makeFixture(0).turns[1]?.observation.text ?? ""));
  });

  test("recall only opens registered masked IDs and verifies exact original bytes", async () => {
    const root = await temporary(), observation = makeFixture(0).turns[0]?.observation;
    if (!observation) throw Error("Missing candidate");
    const path = join(root, "original.txt"); await writeFile(path, observation.text);
    const archives = new Map([[observation.id, { path, digest: hash(observation.text), observation, entryId: "source" }]]);
    const masked = new Set([observation.id]);
    expect(await retrieveOriginal(archives, masked, observation.id)).toBe(observation.text);
    await expect(retrieveOriginal(archives, masked, "../auth.json")).rejects.toThrow("Unknown masked observation");
    await expect(retrieveOriginal(archives, new Set(), observation.id)).rejects.toThrow("Unknown masked observation");
    await writeFile(path, "changed");
    await expect(retrieveOriginal(archives, masked, observation.id)).rejects.toThrow("Archive content changed");
    const link = join(root, "link.txt"); await symlink(path, link);
    archives.set(observation.id, { path: link, digest: hash("changed"), observation, entryId: "source" });
    await expect(retrieveOriginal(archives, masked, observation.id)).rejects.toThrow("symlinked");
  });

  test("fact scoring rejects invalid and stale answers and preserves Danish strings", () => {
    const facts = makeFixture(0).probes[30] ?? [];
    const expected = Object.fromEntries(facts.map(fact => [fact.key, fact.expected]));
    expect(scoreProbe(facts, JSON.stringify(expected)).correct).toBe(3);
    expect(scoreProbe(facts, "not json").valid).toBe(false);
    expect(scoreProbe(facts, JSON.stringify({ ...expected, route: "stale" })).correct).toBe(2);
    expect(scoreProbe([{ key: "danish", question: "field", expected: "æøå" }], '{"danish":"æøå"}').correct).toBe(1);
  });
});
