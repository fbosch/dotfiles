import type { Usage } from "@earendil-works/pi-ai";
import type { CaseId, Verdict } from "./browser-comparison-fixture";

export type Arm = "raw" | "deterministic" | "orchestrated";
export interface TokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  reportedCostUsd: number;
  missingUsageCalls: number;
}
export function tokenTotals(): TokenTotals {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
    reportedCostUsd: 0,
    missingUsageCalls: 0,
  };
}
export function addUsage(total: TokenTotals, usage: Usage | undefined): void {
  if (!usage) {
    total.missingUsageCalls++;
    return;
  }
  total.input += usage.input;
  total.output += usage.output;
  total.cacheRead += usage.cacheRead;
  total.cacheWrite += usage.cacheWrite;
  total.total += usage.totalTokens;
  total.reportedCostUsd += usage.cost.total;
}
export interface Call {
  id: string;
  name: string;
  parent?: string;
  durationMs: number;
  error: boolean;
}
export interface Sample {
  phase: "scripted" | "agent";
  arm: Arm;
  caseId: CaseId;
  repetition: number;
  warmup: boolean;
  durationMs: number;
  success: boolean;
  verdict: Verdict;
  error?: string;
  calls: Call[];
  modelTurns: number;
  classifierCalls: number;
  classifierAttempts: number;
  classifierModels: string[];
  primaryUsage: TokenTotals;
  classifierUsage: TokenTotals;
  stopReasons: string[];
}
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("Cannot summarize an empty sample");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const high = sorted[middle];
  if (high === undefined) throw new Error("Missing median sample");
  if (sorted.length % 2) return high;
  const low = sorted[middle - 1];
  if (low === undefined) throw new Error("Missing lower median sample");
  return (low + high) / 2;
}
export function orderedArms(arms: readonly Arm[], pair: number): Arm[] {
  const offset = pair % arms.length;
  return [...arms.slice(offset), ...arms.slice(0, offset)];
}
export function summarize(samples: readonly Sample[]) {
  const measured = samples.filter((sample) => !sample.warmup);
  const keys = [...new Set(measured.map((s) => `${s.phase}/${s.caseId}/${s.arm}`))];
  const groups = keys.map((key) => {
    const group = measured.filter((s) => `${s.phase}/${s.caseId}/${s.arm}` === key);
    const durations = group.map((s) => s.durationMs).sort((a, b) => a - b);
    return {
      key,
      samples: group.length,
      successful: group.filter((s) => s.success).length,
      medianMs: median(durations),
      p95Ms: durations[Math.ceil(durations.length * 0.95) - 1],
      minMs: durations[0],
      maxMs: durations.at(-1),
      medianNativeCalls: median(
        group.map((s) => s.calls.filter((c) => c.name.startsWith("mcp__")).length),
      ),
      medianModelTurns: median(group.map((s) => s.modelTurns)),
      classifierCalls: group.reduce((n, s) => n + s.classifierCalls, 0),
      primaryTokens: group.reduce((n, s) => n + s.primaryUsage.total, 0),
      classifierTokens: group.reduce((n, s) => n + s.classifierUsage.total, 0),
      reportedCostUsd: group.reduce(
        (n, s) => n + s.primaryUsage.reportedCostUsd + s.classifierUsage.reportedCostUsd,
        0,
      ),
      missingUsageCalls: group.reduce(
        (n, s) => n + s.primaryUsage.missingUsageCalls + s.classifierUsage.missingUsageCalls,
        0,
      ),
      unsafeActions: group.reduce((n, s) => n + s.verdict.unsafeActions, 0),
      wrongTargetTrials: group.filter((s) => s.verdict.wrongTarget).length,
      duplicateSaves: group.reduce((n, s) => n + s.verdict.duplicateSaves, 0),
      nativeFallbackCalls: group.reduce(
        (n, s) =>
          n +
          (s.arm === "raw"
            ? 0
            : s.calls.filter((c) => c.name.startsWith("mcp__") && c.parent === undefined).length),
        0,
      ),
    };
  });
  const paired = measured
    .filter((s) => s.arm !== "raw")
    .flatMap((s) => {
      const raw = measured.find(
        (r) =>
          r.arm === "raw" &&
          r.phase === s.phase &&
          r.caseId === s.caseId &&
          r.repetition === s.repetition,
      );
      return raw
        ? [
            {
              phase: s.phase,
              caseId: s.caseId,
              repetition: s.repetition,
              arm: s.arm,
              deltaMs: s.durationMs - raw.durationMs,
              deltaPercent: 100 * (s.durationMs / raw.durationMs - 1),
              rawSuccess: raw.success,
              candidateSuccess: s.success,
            },
          ]
        : [];
    });
  return {
    groups,
    paired,
    conclusion:
      "Exploratory paired samples, not a significance test. Judge correctness before latency; failures are retained, not excluded.",
  };
}
