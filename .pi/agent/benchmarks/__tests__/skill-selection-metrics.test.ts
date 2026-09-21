import { describe, expect, test } from "bun:test";
import {
  SKILL_SELECTION_BENCHMARK_CASES,
  SKILL_SELECTION_BENCHMARK_CATALOG,
} from "../skill-selection-fixtures";
import { type BenchmarkPrediction, calculateBenchmarkMetrics } from "../skill-selection-metrics";

function prediction(names: readonly string[], unavailable = false): BenchmarkPrediction {
  return unavailable ? { names, unavailable: true } : { names };
}

describe("skill-selection benchmark metrics", () => {
  test("keeps explicit bypass and unavailable no-match cases out of semantic quality", () => {
    const cases = [
      { name: "semantic-match", request: "run Bun tests", relevant: ["bun"] },
      { name: "semantic-no-match", request: "answer a fact", relevant: [] },
      { name: "semantic-failure", request: "run Bun tests", relevant: ["bun"] },
      {
        name: "explicit-bypass",
        request: "/skill:writing-clearly shorten this",
        relevant: [],
        explicitSkillInvocation: true,
      },
      { name: "unavailable-no-match", request: "answer a fact", relevant: [] },
    ] as const;
    const predictions = [
      prediction(["bun"]),
      prediction([]),
      prediction(["writing-clearly"]),
      prediction([]),
      prediction([], true),
    ];

    const metrics = calculateBenchmarkMetrics(cases, predictions);

    expect(metrics.totalCases).toBe(5);
    expect(metrics.semanticDenominator).toBe(4);
    expect(metrics.explicitBypassCases).toBe(1);
    expect(metrics.unavailableCases).toBe(1);
    expect(metrics.unavailableSemanticCases).toBe(1);
    expect(metrics.evaluatedSemanticCases).toBe(3);
    expect(metrics.semanticCoverage).toBe(0.75);
    expect(metrics.semantic).toMatchObject({
      caseAccuracy: 2 / 3,
      precision: 0.5,
      requiredRecall: 0.5,
      noMatchAccuracy: 1,
      multiLabelAccuracy: null,
      expectedLabelCount: 2,
      predictedLabelCount: 2,
      truePositiveLabelCount: 1,
    });
    expect(metrics.semanticAllAttempted).toMatchObject({
      caseAccuracy: 0.5,
      noMatchAccuracy: 0.5,
    });
    expect(metrics.endToEnd).toEqual({
      availableOnly: {
        correctCases: 2,
        denominator: 3,
        caseAccuracy: 2 / 3,
      },
      allAttempted: {
        correctCases: 2,
        denominator: 4,
        caseAccuracy: 0.5,
      },
      explicitBypass: {
        correctCases: 1,
        denominator: 1,
        caseAccuracy: 1,
      },
    });
    expect(metrics.failures).toEqual([
      {
        fixture: "semantic-failure",
        scope: "semantic",
        expected: ["bun"],
        predicted: ["writing-clearly"],
      },
    ]);
    expect(metrics.unavailableFixtureNames).toEqual(["unavailable-no-match"]);
    expect(metrics.explicitBypassFixtureNames).toEqual(["explicit-bypass"]);
  });

  test("reports false positives and partial multi-label recall separately", () => {
    const cases = [
      { name: "multi", request: "Bun and security", relevant: ["bun", "security-and-hardening"] },
      { name: "single", request: "Bun", relevant: ["bun"] },
      { name: "none", request: "nothing", relevant: [] },
    ] as const;
    const metrics = calculateBenchmarkMetrics(cases, [
      prediction(["bun"]),
      prediction(["bun", "writing-clearly"]),
      prediction(["bun"]),
    ]);

    expect(metrics.semantic).toMatchObject({
      caseAccuracy: 0,
      precision: 2 / 4,
      requiredRecall: 2 / 3,
      noMatchAccuracy: 0,
      multiLabelAccuracy: 0,
      expectedLabelCount: 3,
      predictedLabelCount: 4,
      truePositiveLabelCount: 2,
    });
    expect(metrics.failures.map(({ fixture, scope }) => ({ fixture, scope }))).toEqual([
      { fixture: "multi", scope: "semantic" },
      { fixture: "single", scope: "semantic" },
      { fixture: "none", scope: "semantic" },
    ]);
  });

  test("keeps a missing prediction separate from an unavailable response", () => {
    const metrics = calculateBenchmarkMetrics(
      [{ name: "missing", request: "no listed skill", relevant: [] }],
      [],
    );

    expect(metrics.unavailableCases).toBe(0);
    expect(metrics.notAttemptedCases).toBe(1);
    expect(metrics.notAttemptedSemanticCases).toBe(1);
    expect(metrics.evaluatedSemanticCases).toBe(0);
    expect(metrics.semantic.noMatchAccuracy).toBeNull();
    expect(metrics.semantic.caseAccuracy).toBeNull();
    expect(metrics.endToEnd).toEqual({
      availableOnly: { correctCases: 0, denominator: 0, caseAccuracy: null },
      allAttempted: { correctCases: 0, denominator: 0, caseAccuracy: null },
      explicitBypass: { correctCases: 0, denominator: 0, caseAccuracy: null },
    });
    expect(metrics.failures).toEqual([]);
  });

  test("reports coverage, usable versus all-attempted quality, and p50/p95 latency", () => {
    const cases = [
      { name: "fast", request: "run Bun tests", relevant: ["bun"] },
      { name: "slow", request: "answer a fact", relevant: [] },
      { name: "unavailable", request: "use XState", relevant: ["xstate"] },
    ] as const;
    const metrics = calculateBenchmarkMetrics(cases, [
      { names: ["bun"], latencyMs: 10 },
      { names: [], latencyMs: 40 },
      {
        names: [],
        latencyMs: 600,
        unavailable: true,
        failure: { stage: "request", reason: "timeout" },
      },
    ]);

    expect(metrics.semanticCoverage).toBe(2 / 3);
    expect(metrics.semantic.caseAccuracy).toBe(1);
    expect(metrics.semanticAllAttempted.caseAccuracy).toBe(2 / 3);
    expect(metrics.endToEnd.allAttempted.caseAccuracy).toBe(2 / 3);
    expect(metrics.latency).toEqual({ samples: 3, p50: 40, p95: 600 });
  });

  test("keeps an explicit bypass control check out of semantic metrics", () => {
    const cases = [
      { name: "bypass", request: "/skill:bun", relevant: [], explicitSkillInvocation: true },
      { name: "semantic", request: "run Bun tests", relevant: ["bun"] },
    ] as const;
    const metrics = calculateBenchmarkMetrics(cases, [prediction(["bun"]), prediction(["bun"])]);

    expect(metrics.semantic).toMatchObject({
      caseAccuracy: 1,
      precision: 1,
      requiredRecall: 1,
    });
    expect(metrics.endToEnd).toEqual({
      availableOnly: { correctCases: 1, denominator: 1, caseAccuracy: 1 },
      allAttempted: { correctCases: 1, denominator: 1, caseAccuracy: 1 },
      explicitBypass: { correctCases: 0, denominator: 1, caseAccuracy: 0 },
    });
    expect(metrics.failures).toEqual([
      { fixture: "bypass", scope: "explicit-bypass", expected: [], predicted: ["bun"] },
    ]);
  });

  test("keeps the expanded labels inside the frozen catalog", () => {
    const catalogNames = new Set(SKILL_SELECTION_BENCHMARK_CATALOG.map(({ name }) => name));
    const fixtureNames = SKILL_SELECTION_BENCHMARK_CASES.map(({ name }) => name);

    expect(SKILL_SELECTION_BENCHMARK_CASES).toHaveLength(40);
    expect(new Set(fixtureNames).size).toBe(fixtureNames.length);
    expect(SKILL_SELECTION_BENCHMARK_CATALOG).toHaveLength(10);
    expect(Object.isFrozen(SKILL_SELECTION_BENCHMARK_CASES)).toBe(true);
    expect(Object.isFrozen(SKILL_SELECTION_BENCHMARK_CATALOG)).toBe(true);

    for (const testCase of SKILL_SELECTION_BENCHMARK_CASES) {
      for (const name of [...testCase.relevant, ...(testCase.denied ?? [])]) {
        expect(catalogNames.has(name)).toBe(true);
      }
    }

    expect(
      SKILL_SELECTION_BENCHMARK_CASES.filter(
        ({ explicitSkillInvocation }) => explicitSkillInvocation,
      ),
    ).toHaveLength(2);
    expect(
      SKILL_SELECTION_BENCHMARK_CASES.filter(({ denied }) => denied !== undefined),
    ).toHaveLength(3);
  });

  test("keeps UI-only labels narrow and denied contracts on actual skills", () => {
    const casesByName = new Map(
      SKILL_SELECTION_BENCHMARK_CASES.map((testCase) => [testCase.name, testCase]),
    );
    const uiOnlyFixtures = [
      "interface-copy-boundary",
      "incidental-security-mention",
      "ui-accessibility-only",
    ];

    for (const name of uiOnlyFixtures) {
      expect(casesByName.get(name)?.relevant).toEqual(["ui-writing"]);
    }
    expect(casesByName.get("docs-ui-overlap")?.relevant).toEqual(["ui-writing", "writing-clearly"]);

    expect(
      SKILL_SELECTION_BENCHMARK_CATALOG.some(({ name }) => name === "internal-administration"),
    ).toBe(false);
    expect(SKILL_SELECTION_BENCHMARK_CASES.flatMap(({ denied }) => denied ?? []).sort()).toEqual(
      ["agent-browser", "security-and-hardening", "writing-clearly"].sort(),
    );
  });
});
