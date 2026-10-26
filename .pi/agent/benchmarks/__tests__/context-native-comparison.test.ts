import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  PREFLIGHT_ROOT,
  assertManifestRead,
  buildPreflight,
} from "../context-native-comparison";

const scratch = join(PREFLIGHT_ROOT, "unit");
const roots: string[] = [];
beforeAll(async () => { await mkdir(scratch, { recursive: true }); });

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
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
