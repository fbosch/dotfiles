import { createHash } from "node:crypto";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { lstat, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  PREFLIGHT_ROOT,
  FOUR_WAY_SEEDS,
  DIVERSE_SEEDS,
  assertManifestRead,
  classifierCallKind,
  buildPreflight,
  finalProbeRequest,
  registerSavedArtifacts,
} from "../context-native-comparison";
import { diverseStages } from "../context-classifier-diverse-history";
import { RECALL_CLASSIFIER_TASK } from "../../extensions/context-masking/recall";

test("probe recall inference stays separate from classifier compaction", () => {
  const recall = { state: { task: RECALL_CLASSIFIER_TASK } };
  const compaction = { state: { goal: "retain relevant evidence" } };
  for (const arm of ["native-recall", "enabled-classifier", "hybrid-summary"] as const)
    expect(classifierCallKind(arm, true, recall)).toBe("recall");
  for (const arm of ["enabled-classifier", "hybrid-summary"] as const) {
    expect(classifierCallKind(arm, false, compaction)).toBe("classifier");
    expect(() => classifierCallKind(arm, false, recall)).toThrow("outside an enabled probe");
  }
  expect(() => classifierCallKind("native-recall", false, compaction)).toThrow("disabled");
  expect(() => classifierCallKind("native-recall", true, compaction)).toThrow("disabled");
  expect(() => classifierCallKind("native-pi-summary", true, recall)).toThrow("outside an enabled probe");
});

const scratch = join(PREFLIGHT_ROOT, "unit");
const roots: string[] = [];
beforeAll(async () => { await mkdir(scratch, { recursive: true }); });

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});
test("the last probe request requires an answer without offering more tools", () => {
  const context = { systemPrompt: "Keep exact evidence", messages: [] };
  const request = finalProbeRequest(context, {});
  expect(request.context.messages).toBe(context.messages);
  expect(request.context.tools).toEqual([]);
  expect(request.context.systemPrompt).toContain("Keep exact evidence");
  expect(request.context.systemPrompt).toContain("answer the requested IDs");
  expect(request.options.toolChoice).toBe("none");
  expect(context.systemPrompt).toBe("Keep exact evidence");
});

describe("native versus enabled-classifier comparison preflight", () => {
  test("pairs identical evidence and proves a native-default fact prefix plus retained trace tail", async () => {
    const root = await mkdtemp(join(scratch, "cohort-"));
    roots.push(root);
    const report = await buildPreflight({ root, answerContextWindow: 272_000, classifierContextWindow: 32_000 });

    expect(report.config.seeds).toHaveLength(3);
    expect(report.config.stages).toBe(3);
    expect(report.config.compaction).toEqual({
      enabled: true,
      reserveTokens: 16_384,
      keepRecentTokens: 20_000,
    });
    expect(report.arms).toHaveLength(6);

    for (const seed of report.config.seeds) {
      const native = report.arms.find((arm) => arm.seed === seed && arm.arm === "native-pi-summary");
      const classifier = report.arms.find((arm) => arm.seed === seed && arm.arm === "enabled-classifier");
      expect(native).toBeDefined();
      expect(classifier).toBeDefined();
      if (!native || !classifier) throw Error("Missing paired arm");
      expect(native?.workspaceHash).toBe(classifier?.workspaceHash);
      for (const arm of [native, classifier]) {
        expect(arm?.compactions).toHaveLength(3);
        expect(arm?.compactions.every((row) => row.tailContainsTraceBatch)).toBe(true);
        expect(arm?.compactions.every((row) => row.prefixFactEvidence > 0)).toBe(true);
        expect(arm?.compactions.every((row) => row.inputTokens + report.config.compaction.reserveTokens < arm.contextWindow)).toBe(true);
      }
      expect(classifier?.compactions.every((row) => row.classifierRequests.length > 0)).toBe(true);
    }
    expect(report.networkCalls).toBe(0);
    expect(report.lifecycle).toContain("prepared-masked-history");
  });

  test("hybrid uses the same paired evidence and request caps without provider calls", async () => {
    const root = await mkdtemp(join(scratch, "hybrid-"));
    roots.push(root);
    const report = await buildPreflight({ root, hybrid: true });
    expect(report.networkCalls).toBe(0);
    expect(report.arms).toHaveLength(6);
    expect(report.config.classifier.mode).toBe("hybrid");
    expect(report.config.classifier.maxSummaryInputBytes).toBe(48000);
    expect(report.config.limits.modelPerProbe).toBe(16);
    expect(report.config.limits.toolOverheadPerProbe).toBe(12);
    for (const seed of report.config.seeds) {
      const native = report.arms.find(r => r.seed === seed && r.arm === "native-pi-summary");
      const hybrid = report.arms.find(r => r.seed === seed && r.arm === "hybrid-summary");
      if (!native || !hybrid) throw Error("Missing hybrid pair");
      expect(native.workspaceHash).toBe(hybrid.workspaceHash);
      for (const arm of [native, hybrid]) {
        expect(arm.compactions).toHaveLength(3);
        expect(arm.compactions.every(c => c.retainedTailTokens === 20001)).toBe(true);
        expect(arm.compactions.every(c => c.classifierRequests.every(r => r.bytes <= 24000))).toBe(true);
      }
      expect(hybrid.compactions.every(c => c.classifierRequests.length > 0)).toBe(true);
    }
  });

  test("native recall ablation shares masking and bounds with hybrid on fresh synthetic seeds", async () => {
    const root = await mkdtemp(join(scratch, "recall-ablation-"));
    roots.push(root);
    const report = await buildPreflight({ root, recallAblation: true });
    expect(report.networkCalls).toBe(0);
    expect(report.config.seeds).toEqual(["recall-holdout-1", "recall-holdout-2", "recall-holdout-3"]);
    expect(report.arms).toHaveLength(6);
    expect(report.config.limits).toEqual({
      modelPerCompaction: 2, classifierPerCompaction: 40, classifierPerProbe: 40, modelPerProbe: 16,
      toolOverheadPerProbe: 12, operationMs: 180_000, campaignMs: 900_000,
    });
    const nativeConfig = report.config.armSettings["native-recall"];
    const hybridConfig = report.config.armSettings["hybrid-summary"];
    if (!nativeConfig || !hybridConfig) throw Error("Missing ablation settings");
    expect(nativeConfig.contextMasking).toEqual(hybridConfig.contextMasking);
    expect(nativeConfig.contextMasking.enabled).toBe(true);
    expect(nativeConfig.contextMasking.prefetchRecall).toBe(true);
    expect(nativeConfig.contextClassifierCompaction.enabled).toBe(false);
    expect(hybridConfig.contextClassifierCompaction.enabled).toBe(true);
    expect(nativeConfig.compaction).toEqual(hybridConfig.compaction);
    expect(nativeConfig.compactionModel).toEqual(hybridConfig.compactionModel);
    for (const seed of report.config.seeds) {
      const native = report.arms.find(r => r.seed === seed && r.arm === "native-recall");
      const hybrid = report.arms.find(r => r.seed === seed && r.arm === "hybrid-summary");
      if (!native || !hybrid) throw Error("Missing recall pair");
      expect(native.workspaceHash).toBe(hybrid.workspaceHash);
      expect(native.artifactCount).toBeGreaterThan(0);
      expect(native.artifactCount).toBe(hybrid.artifactCount);
      expect(native.compactions.every(c => c.classifierRequests.length === 0)).toBe(true);
      expect(hybrid.compactions.every(c => c.classifierRequests.length > 0)).toBe(true);
      for (const arm of [native, hybrid]) {
        expect(arm.compactions).toHaveLength(3);
        expect(arm.compactions.every(c => c.retainedTailTokens === 20001)).toBe(true);
        expect(arm.compactions.every(c => c.classifierRequests.every(r => r.bytes <= 24000))).toBe(true);
      }
    }
  });

  test("four-way preflight isolates all configurations on identical fresh evidence and rotates order", async () => {
    const root = await mkdtemp(join(scratch, "four-way-"));
    roots.push(root);
    const report = await buildPreflight({ root, fourWay: true });
    const arms = ["native-pi-summary", "native-recall", "enabled-classifier", "hybrid-summary"] as const;
    expect(report.networkCalls).toBe(0);
    expect(report.config.seeds).toEqual(["fourway-holdout-1", "fourway-holdout-2", "fourway-holdout-3"]);
    expect(report.arms).toHaveLength(12);
    expect(report.config.maximumRequests).toEqual({ model: 264, classifier: 720, recall: 360 });
    expect(report.config.limits).toEqual({
      modelPerCompaction: 2, classifierPerCompaction: 40, classifierPerProbe: 40, modelPerProbe: 16,
      toolOverheadPerProbe: 12, operationMs: 180_000, campaignMs: 900_000,
    });
    for (const [index, seed] of report.config.seeds.entries()) {
      const paired = report.arms.filter(row => row.seed === seed);
      expect(new Set(paired.map(row => row.workspaceHash)).size).toBe(1);
      expect(report.config.order[index]?.arms).toEqual([...arms.slice(index), ...arms.slice(0, index)]);
      for (const arm of arms) {
        const row = paired.find(row => row.arm === arm);
        const config = report.config.armSettings[arm];
        if (!row || !config) throw Error("Missing four-way arm");
        const masked = arm !== "native-pi-summary";
        const classified = arm === "enabled-classifier" || arm === "hybrid-summary";
        expect(config.contextMasking.enabled).toBe(masked);
        expect(config.contextMasking.prefetchRecall).toBe(masked);
        expect(config.contextClassifierCompaction.enabled).toBe(classified);
        expect(config.contextClassifierCompaction.mode).toBe(arm === "hybrid-summary" ? "hybrid" : "extractive");
        expect(row.artifactCount > 0).toBe(masked);
        expect(row.compactions).toHaveLength(3);
        expect(row.compactions.every(c => c.retainedTailTokens === 20001)).toBe(true);
        expect(row.compactions.every(c => (c.classifierRequests.length > 0) === classified)).toBe(true);
        expect(row.compactions.every(c => c.classifierRequests.every(r => r.bytes <= 24000))).toBe(true);
      }
    }
  });

  test("multi-source image cohort tests fifteen facts per seed on paired masked histories", async () => {
    const root = await mkdtemp(join(scratch, "diverse-"));
    roots.push(root);
    for (const seed of DIVERSE_SEEDS) {
      const stages = diverseStages(seed);
      expect(stages[2]?.probes.filter(probe => probe.expected !== null)).toHaveLength(15);
      const positives = stages[2]?.probes.filter(probe => probe.expected !== null) ?? [];
      expect(Object.fromEntries(["read", "conversation", "bash", "image"].map(source =>
        [source, positives.filter(probe => probe.source === source).length]))).toEqual({
        read: 9, conversation: 2, bash: 2, image: 2,
      });
      expect(stages[0]?.tools.filter(tool => tool === "bash")).toHaveLength(2);
      expect(stages[0]?.images).toHaveLength(1);
      expect(stages[2]?.images).toHaveLength(1);
      for (const stage of [stages[0], stages[2]]) {
        if (!stage) throw Error("Missing image stage");
        const bytes = Buffer.from(stage.images[0]?.data ?? "", "base64");
        expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        expect(bytes.readUInt32BE(16)).toBe(640);
        expect(bytes.readUInt32BE(20)).toBe(320);
        for (const probe of stage.probes.filter(item => item.source === "image")) {
          if (probe.expected) expect(stage.goal + stage.images[0]?.label).not.toContain(probe.expected);
        }
      }
    }
    const report = await buildPreflight({ root, diverse: true });
    expect(report.networkCalls).toBe(0);
    expect(report.config.seeds).toEqual(DIVERSE_SEEDS);
    expect(report.arms).toHaveLength(12);
    expect(report.config.classifier.maxRequestBytes).toBe(28_000);
    expect(report.config.classifier.maxConcurrentAssessments).toBe(2);
    for (const seed of DIVERSE_SEEDS) {
      const paired = report.arms.filter(arm => arm.seed === seed);
      const bashIndices = diverseStages(seed)[0]?.tools.flatMap((tool, i) => tool === "bash" ? [i] : []) ?? [];
      expect(new Set(paired.map(arm => arm.workspaceHash)).size).toBe(1);
      for (const arm of paired) {
        expect(arm.compactions[0]?.imageFactEvidence).toBeGreaterThan(0);
        expect(arm.compactions[2]?.imageFactEvidence).toBeGreaterThan(0);
        expect(arm.compactions.every(c => c.classifierRequests.every(r => r.textBytes <= 28_000 && r.bytes <= 1_000_000))).toBe(true);
        expect(arm.compactions.every(c => c.tailContainsTraceBatch)).toBe(true);
        for (const index of bashIndices) await expect(lstat(join(root, seed, arm.arm, "workspace", "reports", "phase-0", `scan-${index}.txt`))).rejects.toThrow();
      }
    }
  }, 20_000);

  test("rejects symlinked and unlisted workspace reads", async () => {
    const root = await mkdtemp(join(scratch, "manifest-"));
    roots.push(root);
    const workspace = join(root, "workspace");
    await mkdir(join(workspace, "reports"), { recursive: true });
    await writeFile(join(workspace, "reports", "safe.txt"), "synthetic evidence", { mode: 0o400 });
    await writeFile(join(root, "outside.txt"), "outside", { mode: 0o400 });
    await symlink(join(root, "outside.txt"), join(workspace, "reports", "linked.txt"));

    const manifest = new Set(["reports/safe.txt", "reports/linked.txt"]);
    await expect(assertManifestRead(workspace, manifest, "reports/safe.txt")).resolves.toBeUndefined();
    await expect(assertManifestRead(workspace, manifest, "../outside.txt")).rejects.toThrow();
    await expect(assertManifestRead(workspace, manifest, "reports/linked.txt")).rejects.toThrow();
    await expect(assertManifestRead(workspace, manifest, "not-listed.txt")).rejects.toThrow();
  });
});

test("generated manifests require matching snapshots and safe files before probe reads", async () => {
  const root = await mkdtemp(join(scratch, "generated-"));
  roots.push(root);
  const text = "Retained synthetic references: æøå";
  const id = createHash("sha256").update(text).digest("hex");
  await mkdir(join(root, "session"));
  const path = join(root, "session", id + ".txt");
  await writeFile(path, text);
  const manager = SessionManager.inMemory(root);
  manager.appendCustomEntry("context-masking", { items: [{ entryId: id, toolName: "compaction:references", path, text }] });
  const artifacts = new Map<string, string>();
  await registerSavedArtifacts(root, manager, artifacts);
  expect(artifacts.get(path)).toBe(id);
  await assertManifestRead(root, new Set(["session/" + id + ".txt"]), path);
  await writeFile(path, "changed");
  await expect(registerSavedArtifacts(root, manager, new Map())).rejects.toThrow("changed");
  await rm(path);
  const outside = join(root, "outside.txt");
  await writeFile(outside, text);
  await symlink(outside, path);
  await expect(registerSavedArtifacts(root, manager, new Map())).rejects.toThrow();
  manager.appendCustomEntry("context-masking", { items: [{ entryId: id, toolName: "compaction:references", path: outside, text }] });
  await expect(registerSavedArtifacts(root, manager, new Map())).rejects.toThrow();
});

test("classifier-only replay keeps the matched four-way seeds and provider limits", async () => {
  const root = await mkdtemp(join(scratch, "classifier-only-"));
  roots.push(root);
  const preflight = await buildPreflight({ root, classifierOnly: true });
  expect(preflight.networkCalls).toBe(0);
  expect(preflight.config.seeds).toEqual(FOUR_WAY_SEEDS);
  expect(Object.keys(preflight.config.armSettings)).toEqual(["enabled-classifier"]);
  expect(preflight.config.classifier.mode).toBe("extractive");
  expect(preflight.config.limits.modelPerProbe).toBe(16);
  expect(preflight.arms).toHaveLength(3);
  await expect(buildPreflight({ root, classifierOnly: true, fourWay: true })).rejects.toThrow("Choose one comparison variant");
});

test("diverse classifier-only replay preserves the four-way evidence and probe limits", async () => {
  const root = await mkdtemp(join(scratch, "diverse-classifier-only-"));
  roots.push(root);
  const preflight = await buildPreflight({ root, diverse: true, classifierOnly: true });
  expect(preflight.networkCalls).toBe(0);
  expect(preflight.config.seeds).toEqual(DIVERSE_SEEDS);
  expect(Object.keys(preflight.config.armSettings)).toEqual(["enabled-classifier"]);
  expect(preflight.config.limits.modelPerProbe).toBe(16);
  expect(preflight.config.classifier.maxRequestBytes).toBe(28_000);
  expect(preflight.arms).toHaveLength(3);
  const one = await buildPreflight({ root: join(root, "seed-3"), diverse: true, classifierOnly: true, diverseSeed: DIVERSE_SEEDS[2] });
  expect(one.config.seeds).toEqual([DIVERSE_SEEDS[2]]);
  expect(one.arms).toHaveLength(1);
  await expect(buildPreflight({ root, diverse: true, diverseSeed: DIVERSE_SEEDS[2] })).rejects.toThrow("Diverse seed requires classifier-only replay");
  const diagnostic = await buildPreflight({ root: join(root, "diagnostic"), diverse: true, classifierOnly: true,
    diverseSeed: DIVERSE_SEEDS[2], diagnoseMisses: true });
  expect(diagnostic.networkCalls).toBe(0);
  expect(diagnostic.config.factDiagnostics).toEqual({ maxMisses: 3, modelCalls: 5 });
  expect(diagnostic.config.maximumRequests.model).toBe(37);
  await expect(buildPreflight({ root, diverse: true, diagnoseMisses: true })).rejects.toThrow("Miss diagnostics require diverse classifier-only replay");
  const selected = await buildPreflight({ root: join(root, "selected"), diverse: true, classifierOnly: true,
    diverseSeed: DIVERSE_SEEDS[0], diagnoseMisses: true, diagnoseIds: ["policy", "panel", "tile"] });
  expect(selected.config.factDiagnostics?.ids).toEqual(["policy", "panel", "tile"]);
  await expect(buildPreflight({ root: join(root, "invalid"), diverse: true, classifierOnly: true, diverseSeed: DIVERSE_SEEDS[0],
    diagnoseMisses: true, diagnoseIds: ["missing"] })).rejects.toThrow("Unknown positive diagnostic ID");
  await expect(buildPreflight({ root, diverse: true, classifierOnly: true, diagnoseMisses: true,
    diagnoseIds: ["panel"] })).rejects.toThrow("Diagnostic IDs require one diverse seed");
}, 20_000);
