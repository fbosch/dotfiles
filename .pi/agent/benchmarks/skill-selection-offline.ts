import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_SKILL_SELECTION_CONFIG,
  type SkillCandidate,
  selectSkillsWithJev,
} from "../extensions/skill-selection";
import {
  SKILL_SELECTION_BENCHMARK_CASES,
  SKILL_SELECTION_BENCHMARK_CATALOG,
  type SkillSelectionBenchmarkCase,
} from "./skill-selection-fixtures";
import {
  type BenchmarkMetrics,
  type BenchmarkPrediction,
  calculateBenchmarkMetrics,
} from "./skill-selection-metrics";

type Prediction = BenchmarkPrediction;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "but",
  "for",
  "from",
  "in",
  "is",
  "me",
  "of",
  "on",
  "the",
  "this",
  "to",
  "with",
]);

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((term) => term.length > 2 && !STOP_WORDS.has(term)),
  );
}

function candidatesForCase(testCase: SkillSelectionBenchmarkCase): SkillCandidate[] {
  const denied = new Set(testCase.denied ?? []);
  return SKILL_SELECTION_BENCHMARK_CATALOG.filter((candidate) => !denied.has(candidate.name));
}

function lexicalPrediction(testCase: SkillSelectionBenchmarkCase): Prediction {
  if (testCase.explicitSkillInvocation === true) return { names: [] };

  const requestTerms = tokenize(testCase.request);
  const ranked = candidatesForCase(testCase)
    .map((candidate) => {
      const terms = tokenize(`${candidate.name} ${candidate.description}`);
      const overlap = [...terms].filter((term) => requestTerms.has(term)).length;
      return { name: candidate.name, score: overlap / Math.max(1, terms.size) };
    })
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
    );

  return {
    names: ranked
      .slice(0, DEFAULT_SKILL_SELECTION_CONFIG.maxRecommendations)
      .map(({ name }) => name),
  };
}

async function jevPrediction(
  testCase: SkillSelectionBenchmarkCase,
  modelRegistry: ModelRegistry,
): Promise<Prediction> {
  if (testCase.explicitSkillInvocation === true) return { names: [] };

  const startedAt = performance.now();
  const result = await selectSkillsWithJev(
    testCase.request,
    candidatesForCase(testCase),
    DEFAULT_SKILL_SELECTION_CONFIG,
    { modelRegistry },
  );
  const prediction: Prediction = {
    names: result?.recommendations.map(({ name }) => name) ?? [],
    latencyMs: performance.now() - startedAt,
    ...(result?.usage === undefined ? {} : { usage: result.usage }),
    ...(result === undefined ? { unavailable: true } : {}),
  };
  return prediction;
}

function reportSummary(metrics: BenchmarkMetrics): Record<string, unknown> {
  return {
    accounting: {
      totalCases: metrics.totalCases,
      semanticDenominator: metrics.semanticDenominator,
      explicitBypassCases: metrics.explicitBypassCases,
      unavailableCases: metrics.unavailableCases,
      unavailableSemanticCases: metrics.unavailableSemanticCases,
      unavailableBypassCases: metrics.unavailableBypassCases,
      evaluatedSemanticCases: metrics.evaluatedSemanticCases,
      semanticCoverage: metrics.semanticCoverage,
    },
    metrics: metrics.semantic,
    endToEnd: metrics.endToEnd,
    failures: metrics.failures,
    unavailableFixtureNames: metrics.unavailableFixtureNames,
    explicitBypassFixtureNames: metrics.explicitBypassFixtureNames,
  };
}

function printReport(
  mode: "lexical" | "jev",
  predictions: readonly Prediction[],
  lexicalBaseline?: readonly Prediction[],
): void {
  const metrics = calculateBenchmarkMetrics(SKILL_SELECTION_BENCHMARK_CASES, predictions);
  const baselineMetrics =
    lexicalBaseline === undefined
      ? undefined
      : calculateBenchmarkMetrics(SKILL_SELECTION_BENCHMARK_CASES, lexicalBaseline);
  const latencies = predictions.flatMap(({ latencyMs }) =>
    latencyMs === undefined ? [] : [latencyMs],
  );
  const usage = predictions.flatMap(({ usage }) => (usage === undefined ? [] : [usage]));
  const inputTokens = usage.flatMap(({ inputTokens }) =>
    inputTokens === undefined ? [] : [inputTokens],
  );
  const outputTokens = usage.flatMap(({ outputTokens }) =>
    outputTokens === undefined ? [] : [outputTokens],
  );

  console.log(
    JSON.stringify(
      {
        mode,
        syntheticFixtureCount: SKILL_SELECTION_BENCHMARK_CASES.length,
        ...reportSummary(metrics),
        ...(baselineMetrics === undefined
          ? {}
          : { lexicalBaseline: reportSummary(baselineMetrics) }),
        ...(latencies.length === 0
          ? {}
          : {
              latencyMs: {
                samples: latencies.length,
                average: latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
                maximum: Math.max(...latencies),
              },
            }),
        ...(inputTokens.length === 0 && outputTokens.length === 0
          ? {}
          : {
              returnedUsage: {
                responses: usage.length,
                inputTokens: inputTokens.reduce((sum, value) => sum + value, 0),
                outputTokens: outputTokens.reduce((sum, value) => sum + value, 0),
              },
            }),
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  if (args.has("--help")) {
    console.log("Usage: bun run benchmark:skill-selection [--jev]");
    console.log(
      "Default: frozen synthetic lexical baseline; --jev explicitly permits hosted Jev calls.",
    );
    return;
  }

  const jev = args.has("--jev");
  if (jev === false) {
    printReport("lexical", SKILL_SELECTION_BENCHMARK_CASES.map(lexicalPrediction));
    return;
  }

  // This path is opt-in and sends only the frozen synthetic fixtures above.
  let modelRegistry: ModelRegistry;
  try {
    const runtime = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
    modelRegistry = new ModelRegistry(runtime);
  } catch {
    printReport(
      "jev",
      SKILL_SELECTION_BENCHMARK_CASES.map((testCase) =>
        testCase.explicitSkillInvocation === true
          ? { names: [] }
          : { names: [], unavailable: true },
      ),
    );
    return;
  }

  const predictions: Prediction[] = [];
  for (const testCase of SKILL_SELECTION_BENCHMARK_CASES) {
    try {
      predictions.push(await jevPrediction(testCase, modelRegistry));
    } catch {
      predictions.push(
        testCase.explicitSkillInvocation === true
          ? { names: [] }
          : { names: [], unavailable: true },
      );
    }
  }
  printReport("jev", predictions, SKILL_SELECTION_BENCHMARK_CASES.map(lexicalPrediction));
}

await main();
