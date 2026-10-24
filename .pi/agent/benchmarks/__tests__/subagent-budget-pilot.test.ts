import { describe, expect, test } from "bun:test";
import type { BudgetAdviceInput } from "../../extensions/subagents/budget";
import { buildPilotPlan, type PilotSample, summarizeQuality } from "../subagent-budget-pilot";
import { isTrialOptions } from "../subagent-budget-trial-cli";

const input: BudgetAdviceInput = {
  taskKind: "testing",
  initialTurns: 4,
  grantedTurns: 4,
  hardMaxTurns: 8,
  turnsUsed: 2,
  automaticGrants: 0,
  progress: {
    completedTools: 2,
    verifiedSuccesses: 2,
    failures: 0,
    unknownOutcomes: 0,
    consecutiveFailures: 0,
  },
};
function sample(arm: PilotSample["arm"], overrides: Partial<PilotSample> = {}): PilotSample {
  const reference = arm === "reference";
  return {
    fixtureId: "runner-trace",
    block: 0,
    arm,
    checked: { verifiedFacts: [], invalidClaims: 0, complete: false, blocker: null },
    checkpoint: { verifiedFacts: [], invalidClaims: 0, complete: false, blocker: null },
    label: reference ? "productive" : null,
    outcome: "completed",
    turnsUsed: reference ? 5 : 3,
    waitingForParent: false,
    workerDurationMs: 1,
    totalDurationMs: 2,
    timedOut: false,
    referenceTurns: reference ? 4 : 0,
    cleanupConfirmed: true,
    storageFailed: false,
    workerSdkRequests: reference ? 5 : 3,
    workerObservedFetches: reference ? 5 : 3,
    classifierProviderDispatches: reference ? 0 : 1,
    classifierObservedFetches: reference ? 0 : 1,
    physicalModels: [],
    classifierInputs: [input],
    budget: {
      version: 1,
      initialTurns: 4,
      grantedTurns: reference ? 8 : 4,
      hardMaxTurns: 8,
      mode: reference ? "automatic" : "advisory",
      automaticGrants: reference ? 1 : 0,
      checks: 1,
      revision: reference ? 1 : 0,
      progress: input.progress,
      decisions: [
        {
          revision: 0,
          turnsUsed: 2,
          kind: reference ? "granted" : "advised",
          reason: reference ? "productive" : "advisory",
          proposedTurns: 4,
          grantedTurns: reference ? 4 : 0,
          probability: reference ? 1 : 0.8,
          durationMs: 1,
        },
      ],
    },
    workerUsage: { inputTokens: null, outputTokens: null, reportedCost: null },
    violations: [],
    ...overrides,
  };
}
describe("subagent budget pilot", () => {
  test("counterbalances primary arms within the 26-trial ceiling", () => {
    const plan = buildPilotPlan();
    expect(plan).toHaveLength(26);
    expect(plan.slice(0, 3).map((entry) => entry.arm)).toEqual(["fixed", "advisory", "reference"]);
    expect(plan.slice(13, 16).map((entry) => entry.arm)).toEqual([
      "advisory",
      "fixed",
      "reference",
    ]);
    expect(plan.filter((entry) => entry.arm === "fixed")).toHaveLength(10);
    expect(plan.filter((entry) => entry.arm === "advisory")).toHaveLength(10);
    expect(plan.filter((entry) => entry.arm === "reference")).toHaveLength(6);
  });
  test("scores checked reference outcomes rather than intended fixture labels", () => {
    const positive = summarizeQuality([sample("advisory"), sample("reference")]);
    const negative = summarizeQuality([
      sample("advisory"),
      sample("reference", { label: "stalled" }),
    ]);
    expect(positive.scoredPairs).toBe(1);
    expect(positive.brierScore).toBeCloseTo(0.04);
    expect(negative.stalledPairs).toBe(1);
    expect(negative.brierScore).toBeCloseTo(0.64);
    expect(negative.threshold).toBeNull();
  });
  test("does not score unmatched structural states, blocks, or failed references", () => {
    const references = [
      sample("reference", { block: 1 }),
      sample("reference", {
        classifierInputs: [{ ...input, progress: { ...input.progress, verifiedSuccesses: 1 } }],
      }),
      sample("reference", { outcome: "failed" }),
      sample("reference", { cleanupConfirmed: false }),
      sample("reference", { label: "insufficient-evidence" }),
      sample("reference", { referenceTurns: 0 }),
    ];
    for (const reference of references)
      expect(summarizeQuality([sample("advisory"), reference]).scoredPairs).toBe(0);
  });
  test("keeps absent advice and ground truth unknown", () => {
    const summary = summarizeQuality([]);
    expect(summary.scoredPairs).toBe(0);
    expect(summary.brierScore).toBeNull();
    expect(summary.threshold).toBeNull();
  });
  test("validates private trial bounds before SDK setup", () => {
    const options = {
      sdkRoot: "/sdk",
      cwd: "/work",
      directory: "/result",
      prompt: "Inspect fixture",
      arm: "fixed",
      timeoutMs: 10,
    };
    expect(isTrialOptions(options)).toBe(true);
    for (const invalid of [
      null,
      { ...options, arm: "automatic" },
      { ...options, timeoutMs: 0 },
      { ...options, timeoutMs: 120_001 },
      { ...options, timeoutMs: 1.5 },
      { ...options, prompt: "" },
      { ...options, extra: "unchecked" },
    ])
      expect(isTrialOptions(invalid)).toBe(false);
  });
});
