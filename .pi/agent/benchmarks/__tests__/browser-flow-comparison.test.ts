import { describe, expect, test } from "bun:test";
import { tokenTotals } from "../browser-comparison-metrics";
import {
  type FlowSample,
  infrastructureFailure,
  parseFlowOptions,
  summarizeFlows,
} from "../browser-flow-comparison";

function sample(overrides: Partial<FlowSample> = {}): FlowSample {
  return {
    warmup: false,
    commitMs: 8,
    flowId: "onboarding",
    controller: "classifier",
    repetition: 0,
    initialFingerprint: "same",
    success: true,
    invalidEnvironment: false,
    durationMs: 10,
    verdict: {
      success: true,
      completed: true,
      effects: 7,
      violations: [],
      submissions: 1,
      validationFailures: 0,
      reviewAttempts: 0,
    },
    finalView: "done",
    calls: [],
    primaryResponses: 0,
    primaryUsage: tokenTotals(),
    classifierUsage: tokenTotals(),
    classifierCalls: 2,
    classifierAttempts: 2,
    classifierModels: ["openrouter/typesafe/jev-1.14"],
    classifierFailures: [],
    stopReasons: ["no_action"],
    runDetails: [],
    ...overrides,
  };
}
describe("matched browser-flow comparison", () => {
  test("requires an explicit SDK and bounds the hosted workload", () => {
    expect(() => parseFlowOptions([])).toThrow("--sdk-root");
    const options = parseFlowOptions(["--sdk-root", "/installed-sdk"]);
    expect(options).toMatchObject({
      model: "openai-codex/gpt-6-luna",
      runs: 1,
      maxTurns: 32,
      mode: "measure",
    });
    expect(() => parseFlowOptions(["--sdk-root", "/sdk", "--runs", "0"])).toThrow();
    expect(() => parseFlowOptions(["--sdk-root", "/sdk", "--runs", "6"])).toThrow();
    expect(() =>
      parseFlowOptions(["--sdk-root", "/sdk", "--flows", "onboarding,onboarding"]),
    ).toThrow();
    expect(() => parseFlowOptions(["--sdk-root", "/sdk", "--flows", "unknown"])).toThrow();
    expect(() => parseFlowOptions(["--sdk-root", "/sdk", "--model", "unqualified"])).toThrow();
    expect(() => parseFlowOptions(["--sdk-root", "/sdk", "--mode", "unknown"])).toThrow();
    expect(() => parseFlowOptions(["--sdk-root", "/sdk", "--timeout-ms", "999999"])).toThrow();
  });

  test("separates unavailable infrastructure from controller decisions or deadline failures", () => {
    expect(infrastructureFailure([{ reason: "model-unavailable", stage: "config" }])).toBe(true);
    expect(infrastructureFailure([{ reason: "auth-failure", stage: "auth" }])).toBe(true);
    expect(infrastructureFailure([{ reason: "timeout", stage: "request" }])).toBe(false);
    expect(infrastructureFailure([])).toBe(false);
  });

  test("pairs only the same flow, repetition and independently matched initial state", () => {
    const report = summarizeFlows([
      sample(),
      sample({ controller: "luna", durationMs: 30 }),
      sample({ flowId: "recovery", controller: "classifier", initialFingerprint: "one" }),
      sample({ flowId: "recovery", controller: "luna", initialFingerprint: "different" }),
    ]);
    expect(report.paired).toEqual([
      {
        flowId: "onboarding",
        repetition: 0,
        primaryController: "luna",
        classifierCommitMs: 8,
        primaryCommitMs: 8,
        classifierSuccess: true,
        primarySuccess: true,
        classifierMs: 10,
        primaryMs: 30,
      },
    ]);
  });

  test("retains task failures and missing cost records while excluding invalid environment samples", () => {
    const usage = tokenTotals();
    usage.missingUsageCalls = 1;
    const report = summarizeFlows([
      sample({ success: false, classifierUsage: usage }),
      sample({ invalidEnvironment: true, success: false, durationMs: 999 }),
      sample({ controller: "luna", primaryResponses: 8 }),
    ]);
    expect(report.groups[0]).toMatchObject({
      samples: 1,
      successful: 0,
      medianMs: 10,
      missingUsageCalls: 1,
    });
    expect(report.groups[1]).toMatchObject({ samples: 1, successful: 1, primaryResponses: 8 });
    expect(report.invalidSamples).toBe(1);
    expect(report.paired[0]).toMatchObject({ classifierSuccess: false, primarySuccess: true });
  });

  test("excludes successful preflight runs from completion timing and pairs the codemode baseline", () => {
    const report = summarizeFlows([
      sample({ warmup: true, commitMs: 999, durationMs: 1000 }),
      sample({ controller: "codemode", warmup: true, commitMs: 888, durationMs: 900 }),
      sample({ commitMs: 4, durationMs: 10 }),
      sample({ controller: "codemode", commitMs: 8, durationMs: 12 }),
    ]);
    expect(report.groups[0]).toMatchObject({
      samples: 1,
      successful: 1,
      medianCommitMs: 4,
      medianMs: 10,
    });
    expect(report.groups[1]).toMatchObject({
      controller: "codemode",
      samples: 1,
      successful: 1,
      medianCommitMs: 8,
      medianMs: 12,
    });
    expect(report.warmups).toHaveLength(2);
    expect(report.paired[0]).toMatchObject({
      primaryController: "codemode",
      classifierCommitMs: 4,
      primaryCommitMs: 8,
    });
  });

  test("reports no completion latency for an unsuccessful flow", () => {
    const report = summarizeFlows([sample({ success: false, commitMs: null })]);
    expect(report.groups[0]).toMatchObject({ successful: 0, medianCommitMs: null, medianMs: 10 });
  });
});
