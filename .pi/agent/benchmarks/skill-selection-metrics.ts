import type { SkillSelectionBenchmarkCase } from "./skill-selection-fixtures";

export type BenchmarkFailureStage = "auth" | "request" | "body" | "evaluation";

export interface BenchmarkPredictionFailure {
  readonly stage: BenchmarkFailureStage;
  readonly reason: string;
  readonly httpStatus?: number;
  readonly retryAfterMs?: number;
}

export interface BenchmarkPrediction {
  readonly names: readonly string[];
  readonly latencyMs?: number;
  readonly usage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
  };
  readonly unavailable?: boolean;
  readonly failure?: BenchmarkPredictionFailure;
}

export interface BenchmarkFailure {
  readonly fixture: string;
  readonly scope: "semantic" | "explicit-bypass";
  readonly expected: readonly string[];
  readonly predicted: readonly string[];
}

export interface BenchmarkQualityMetrics {
  readonly caseAccuracy: number | null;
  readonly precision: number | null;
  readonly requiredRecall: number | null;
  readonly noMatchAccuracy: number | null;
  readonly multiLabelAccuracy: number | null;
  readonly expectedLabelCount: number;
  readonly predictedLabelCount: number;
  readonly truePositiveLabelCount: number;
}

export interface BenchmarkAttemptMetrics {
  readonly correctCases: number;
  readonly denominator: number;
  readonly caseAccuracy: number | null;
}

export interface BenchmarkEndToEndMetrics {
  /** Semantic cases with a returned prediction; unavailable cases are excluded. */
  readonly availableOnly: BenchmarkAttemptMetrics;
  /** Every attempted semantic case; unavailable cases count as unsuccessful attempts. */
  readonly allAttempted: BenchmarkAttemptMetrics;
  /** Explicit skill invocations are deterministic control-flow checks, reported separately. */
  readonly explicitBypass: BenchmarkAttemptMetrics;
}

export interface BenchmarkLatencyMetrics {
  readonly samples: number;
  readonly p50: number | null;
  readonly p95: number | null;
}

export interface BenchmarkMetrics {
  readonly totalCases: number;
  readonly explicitBypassCases: number;
  readonly semanticDenominator: number;
  readonly unavailableCases: number;
  readonly unavailableSemanticCases: number;
  readonly unavailableBypassCases: number;
  readonly notAttemptedCases: number;
  readonly notAttemptedSemanticCases: number;
  readonly notAttemptedBypassCases: number;
  readonly evaluatedSemanticCases: number;
  readonly semanticCoverage: number | null;
  /** Quality over responses that passed availability and semantic validation. */
  readonly semantic: BenchmarkQualityMetrics;
  /** Quality with unavailable semantic cases counted as empty unsuccessful predictions. */
  readonly semanticAllAttempted: BenchmarkQualityMetrics;
  readonly endToEnd: BenchmarkEndToEndMetrics;
  readonly latency: BenchmarkLatencyMetrics;
  readonly failures: readonly BenchmarkFailure[];
  readonly unavailableFixtureNames: readonly string[];
  readonly explicitBypassFixtureNames: readonly string[];
}

function fraction(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function exactMatch(expected: ReadonlySet<string>, predicted: ReadonlySet<string>): boolean {
  return expected.size === predicted.size && [...expected].every((name) => predicted.has(name));
}

function percentile(values: readonly number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(sorted.length * percentileValue));
  return sorted[rank - 1] ?? null;
}

function qualityMetrics(
  cases: readonly SkillSelectionBenchmarkCase[],
  predictions: readonly (BenchmarkPrediction | undefined)[],
  includeUnavailable: boolean,
): BenchmarkQualityMetrics {
  let exactMatches = 0;
  let evaluatedCases = 0;
  let expectedLabelCount = 0;
  let predictedLabelCount = 0;
  let truePositiveLabelCount = 0;
  let noMatchCases = 0;
  let noMatchCorrect = 0;
  let multiLabelCases = 0;
  let multiLabelCorrect = 0;

  cases.forEach((testCase, index) => {
    if (testCase.explicitSkillInvocation === true) return;
    const prediction = predictions[index];
    if (prediction === undefined) return;
    const unavailable = prediction.unavailable === true;
    if (unavailable && !includeUnavailable) return;

    const expected = new Set(testCase.relevant);
    const predicted = new Set(unavailable ? [] : prediction.names);
    const accepted = !unavailable && exactMatch(expected, predicted);
    evaluatedCases += 1;
    if (accepted) exactMatches += 1;
    expectedLabelCount += expected.size;
    predictedLabelCount += predicted.size;
    truePositiveLabelCount += [...predicted].filter((name) => expected.has(name)).length;

    if (expected.size === 0) {
      noMatchCases += 1;
      if (accepted) noMatchCorrect += 1;
    }
    if (expected.size > 1) {
      multiLabelCases += 1;
      if (accepted) multiLabelCorrect += 1;
    }
  });

  return {
    caseAccuracy: fraction(exactMatches, evaluatedCases),
    precision: fraction(truePositiveLabelCount, predictedLabelCount),
    requiredRecall: fraction(truePositiveLabelCount, expectedLabelCount),
    noMatchAccuracy: fraction(noMatchCorrect, noMatchCases),
    multiLabelAccuracy: fraction(multiLabelCorrect, multiLabelCases),
    expectedLabelCount,
    predictedLabelCount,
    truePositiveLabelCount,
  };
}

/**
 * Score only responses that were actually available. Explicit skill invocations are
 * deterministic control-flow checks, not evidence about semantic classification.
 */
export function calculateBenchmarkMetrics(
  cases: readonly SkillSelectionBenchmarkCase[],
  predictions: readonly (BenchmarkPrediction | undefined)[],
): BenchmarkMetrics {
  let explicitBypassCases = 0;
  let unavailableCases = 0;
  let unavailableSemanticCases = 0;
  let unavailableBypassCases = 0;
  let notAttemptedCases = 0;
  let notAttemptedSemanticCases = 0;
  let notAttemptedBypassCases = 0;
  let evaluatedSemanticCases = 0;
  let semanticExactMatches = 0;
  let explicitBypassCorrectCases = 0;
  const failures: BenchmarkFailure[] = [];
  const unavailableFixtureNames: string[] = [];
  const explicitBypassFixtureNames: string[] = [];

  cases.forEach((testCase, index) => {
    const prediction = predictions[index];
    const notAttempted = prediction === undefined;
    const unavailable = prediction?.unavailable === true;
    const expected = new Set(testCase.relevant);
    const predicted = new Set(notAttempted || unavailable ? [] : (prediction?.names ?? []));
    const predictedNames = [...predicted];

    if (testCase.explicitSkillInvocation === true) {
      explicitBypassCases += 1;
      explicitBypassFixtureNames.push(testCase.name);
      if (notAttempted) {
        notAttemptedCases += 1;
        notAttemptedBypassCases += 1;
        return;
      }
      if (unavailable) {
        unavailableCases += 1;
        unavailableBypassCases += 1;
        unavailableFixtureNames.push(testCase.name);
        return;
      }

      if (predicted.size === 0) {
        explicitBypassCorrectCases += 1;
      } else {
        failures.push({
          fixture: testCase.name,
          scope: "explicit-bypass",
          expected: [],
          predicted: predictedNames,
        });
      }
      return;
    }

    if (notAttempted) {
      notAttemptedCases += 1;
      notAttemptedSemanticCases += 1;
      return;
    }
    if (unavailable) {
      unavailableCases += 1;
      unavailableSemanticCases += 1;
      unavailableFixtureNames.push(testCase.name);
      return;
    }

    evaluatedSemanticCases += 1;
    const accepted = exactMatch(expected, predicted);
    if (accepted) {
      semanticExactMatches += 1;
    } else {
      failures.push({
        fixture: testCase.name,
        scope: "semantic",
        expected: [...expected],
        predicted: predictedNames,
      });
    }
  });

  const semanticDenominator = cases.length - explicitBypassCases;
  const semantic: BenchmarkQualityMetrics = qualityMetrics(cases, predictions, false);
  const semanticAllAttempted: BenchmarkQualityMetrics = qualityMetrics(cases, predictions, true);
  const latencySamples = cases.flatMap((testCase, index) => {
    if (testCase.explicitSkillInvocation === true) return [];
    const latency = predictions[index]?.latencyMs;
    return latency !== undefined && Number.isFinite(latency) && latency >= 0 ? [latency] : [];
  });

  return {
    totalCases: cases.length,
    explicitBypassCases,
    semanticDenominator,
    unavailableCases,
    unavailableSemanticCases,
    unavailableBypassCases,
    notAttemptedCases,
    notAttemptedSemanticCases,
    notAttemptedBypassCases,
    evaluatedSemanticCases,
    semanticCoverage: fraction(evaluatedSemanticCases, semanticDenominator),
    semantic,
    semanticAllAttempted,
    endToEnd: {
      availableOnly: {
        correctCases: semanticExactMatches,
        denominator: evaluatedSemanticCases,
        caseAccuracy: fraction(semanticExactMatches, evaluatedSemanticCases),
      },
      allAttempted: {
        correctCases: semanticExactMatches,
        denominator: semanticDenominator - notAttemptedSemanticCases,
        caseAccuracy: fraction(
          semanticExactMatches,
          semanticDenominator - notAttemptedSemanticCases,
        ),
      },
      explicitBypass: {
        correctCases: explicitBypassCorrectCases,
        denominator: explicitBypassCases - notAttemptedBypassCases,
        caseAccuracy: fraction(
          explicitBypassCorrectCases,
          explicitBypassCases - notAttemptedBypassCases,
        ),
      },
    },
    latency: {
      samples: latencySamples.length,
      p50: percentile(latencySamples, 0.5),
      p95: percentile(latencySamples, 0.95),
    },
    failures,
    unavailableFixtureNames,
    explicitBypassFixtureNames,
  };
}
