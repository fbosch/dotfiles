import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_SKILL_SELECTION_CONFIG,
  type SkillSelectionFailure,
  selectSkillsWithJevDetailed,
} from "../extensions/skill-selection";
import { VERCEL_GATEWAY_MODEL, type VercelGatewayFailureReason } from "../lib/vercel-gateway";
import {
  SKILL_SELECTION_BENCHMARK_CASES,
  SKILL_SELECTION_BENCHMARK_CATALOG,
  type SkillSelectionBenchmarkCase,
} from "./skill-selection-fixtures";
import {
  type BenchmarkFailureStage,
  type BenchmarkMetrics,
  type BenchmarkPrediction,
  calculateBenchmarkMetrics,
} from "./skill-selection-metrics";

const HOSTED_COMPARE_TIMEOUTS_MS = [600, 2_000] as const;
const BENCHMARK_SCHEMA_VERSION = 1;
const BENCHMARK_QUESTION_IDS = [
  "skill_0",
  "skill_1",
  "skill_2",
  "skill_3",
  "skill_4",
  "skill_5",
  "skill_6",
  "skill_7",
  "skill_8",
  "skill_9",
  "none_relevant",
] as const;

type Prediction = BenchmarkPrediction;
type SavedFailureReason =
  | VercelGatewayFailureReason
  | "invalid-evaluation-response"
  | "prediction-mismatch";

const SAVED_FAILURE_REASONS: Readonly<Record<string, SavedFailureReason>> = {
  "missing-credentials": "missing-credentials",
  "auth-failure": "auth-failure",
  timeout: "timeout",
  "caller-cancellation": "caller-cancellation",
  "request-failure": "request-failure",
  "http-status": "http-status",
  "invalid-json": "invalid-json",
  "oversized-body": "oversized-body",
  "body-failure": "body-failure",
  "invalid-evaluation-response": "invalid-evaluation-response",
  "prediction-mismatch": "prediction-mismatch",
};

function safeSavedFailureReason(stage: BenchmarkFailureStage, reason: string): SavedFailureReason {
  return (
    SAVED_FAILURE_REASONS[reason] ??
    (stage === "evaluation" ? "invalid-evaluation-response" : "request-failure")
  );
}

interface SavedCaseReport {
  readonly fixture_id: string;
  readonly outcome: "correct" | "incorrect" | "unavailable" | "explicit-bypass";
  readonly expected: readonly string[];
  readonly predictions: readonly string[];
  readonly elapsed_ms: number | null;
  readonly failure: {
    readonly stage: BenchmarkFailureStage;
    readonly reason: SavedFailureReason;
    readonly http_status?: number;
  } | null;
  readonly usage: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
  } | null;
}

interface SavedRunReport {
  readonly timeout_ms: number;
  readonly api_calls: number;
  readonly responses: number;
  readonly metrics: ReturnType<typeof savedMetrics>;
  readonly usage: {
    readonly responses: number;
    readonly input_tokens: number;
    readonly output_tokens: number;
  };
  readonly unavailable_fixture_ids: readonly string[];
  readonly cases: readonly SavedCaseReport[];
}

interface SavedBenchmarkReport {
  readonly schema_version: number;
  readonly generated_at: string;
  readonly benchmark: {
    readonly mode: "hosted-synthetic";
    readonly fixture_count: number;
    readonly semantic_fixture_count: number;
    readonly catalog_fingerprint: string;
    readonly catalog_count: number;
    readonly model: string;
    readonly questions: readonly string[];
    readonly threshold: number;
    readonly max_recommendations: number;
    readonly retries: number;
    readonly budgets_ms: readonly number[];
  };
  readonly lexical_baseline: ReturnType<typeof savedMetrics>;
  readonly runs: readonly SavedRunReport[];
}

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

function candidatesForCase(testCase: SkillSelectionBenchmarkCase) {
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

function safeFailure(failure: SkillSelectionFailure): Prediction["failure"] {
  return {
    stage: failure.stage === "evaluation" ? "evaluation" : failure.stage,
    reason: failure.reason,
    ...(failure.kind === "gateway-failure" && failure.httpStatus === undefined
      ? {}
      : failure.kind === "gateway-failure"
        ? { httpStatus: failure.httpStatus }
        : {}),
  };
}

function unexpectedFailure(): Prediction["failure"] {
  return { stage: "request", reason: "request-failure" satisfies VercelGatewayFailureReason };
}

async function jevPrediction(
  testCase: SkillSelectionBenchmarkCase,
  modelRegistry: ModelRegistry,
  timeoutMs: number,
): Promise<Prediction> {
  if (testCase.explicitSkillInvocation === true) return { names: [] };

  const startedAt = performance.now();
  try {
    const attempt = await selectSkillsWithJevDetailed(
      testCase.request,
      candidatesForCase(testCase),
      {
        threshold: DEFAULT_SKILL_SELECTION_CONFIG.threshold,
        maxRecommendations: DEFAULT_SKILL_SELECTION_CONFIG.maxRecommendations,
        timeoutMs,
      },
      { modelRegistry },
    );
    const latencyMs = performance.now() - startedAt;
    if (!attempt.ok) {
      return { names: [], latencyMs, unavailable: true, failure: safeFailure(attempt.failure) };
    }
    return {
      names: attempt.value.recommendations.map(({ name }) => name),
      latencyMs,
      ...(attempt.value.usage === undefined
        ? {}
        : {
            usage: {
              ...(attempt.value.usage.inputTokens === undefined
                ? {}
                : { inputTokens: attempt.value.usage.inputTokens }),
              ...(attempt.value.usage.outputTokens === undefined
                ? {}
                : { outputTokens: attempt.value.usage.outputTokens }),
            },
          }),
    };
  } catch {
    return {
      names: [],
      latencyMs: performance.now() - startedAt,
      unavailable: true,
      failure: unexpectedFailure(),
    };
  }
}

function exactMatch(expected: readonly string[], predicted: readonly string[]): boolean {
  const expectedSet = new Set(expected);
  const predictedSet = new Set(predicted);
  return (
    expectedSet.size === predictedSet.size &&
    [...expectedSet].every((name) => predictedSet.has(name))
  );
}

function savedCaseReport(
  testCase: SkillSelectionBenchmarkCase,
  prediction: Prediction,
): SavedCaseReport {
  const explicitBypass = testCase.explicitSkillInvocation === true;
  const unavailable = prediction.unavailable === true;
  const correct = !unavailable && exactMatch(testCase.relevant, prediction.names);
  const failureSource = unavailable
    ? (prediction.failure ?? { stage: "request" as const, reason: "request-failure" })
    : correct
      ? null
      : { stage: "evaluation" as const, reason: "prediction-mismatch" };
  const failure =
    failureSource === null
      ? null
      : {
          stage: failureSource.stage,
          reason: safeSavedFailureReason(failureSource.stage, failureSource.reason),
          ...(failureSource.httpStatus === undefined
            ? {}
            : { http_status: failureSource.httpStatus }),
        };

  return {
    fixture_id: testCase.name,
    outcome:
      explicitBypass && correct
        ? "explicit-bypass"
        : unavailable
          ? "unavailable"
          : correct
            ? "correct"
            : "incorrect",
    expected: testCase.relevant,
    predictions: prediction.names,
    elapsed_ms: prediction.latencyMs ?? null,
    failure,
    usage:
      prediction.usage === undefined
        ? null
        : {
            ...(prediction.usage.inputTokens === undefined
              ? {}
              : { input_tokens: prediction.usage.inputTokens }),
            ...(prediction.usage.outputTokens === undefined
              ? {}
              : { output_tokens: prediction.usage.outputTokens }),
          },
  };
}

function savedMetrics(metrics: BenchmarkMetrics) {
  return {
    coverage: metrics.semanticCoverage,
    quality: {
      usable: metrics.semantic,
      all_attempted: metrics.semanticAllAttempted,
    },
    end_to_end: metrics.endToEnd,
    latency_ms: metrics.latency,
    unavailable_cases: metrics.unavailableCases,
    unavailable_semantic_cases: metrics.unavailableSemanticCases,
    unavailable_bypass_cases: metrics.unavailableBypassCases,
    failures: metrics.failures,
  };
}

function usageSummary(predictions: readonly Prediction[]) {
  const withUsage = predictions.filter((prediction) => prediction.usage !== undefined);
  return {
    responses: withUsage.length,
    input_tokens: withUsage.reduce(
      (sum, prediction) => sum + (prediction.usage?.inputTokens ?? 0),
      0,
    ),
    output_tokens: withUsage.reduce(
      (sum, prediction) => sum + (prediction.usage?.outputTokens ?? 0),
      0,
    ),
  };
}

function createRunReport(timeoutMs: number, predictions: readonly Prediction[]): SavedRunReport {
  const metrics = calculateBenchmarkMetrics(SKILL_SELECTION_BENCHMARK_CASES, predictions);
  const cases = SKILL_SELECTION_BENCHMARK_CASES.map((testCase, index) =>
    savedCaseReport(
      testCase,
      predictions[index] ?? { names: [], unavailable: true, failure: unexpectedFailure() },
    ),
  );
  return {
    timeout_ms: timeoutMs,
    api_calls: SKILL_SELECTION_BENCHMARK_CASES.filter(
      ({ explicitSkillInvocation }) => explicitSkillInvocation !== true,
    ).length,
    responses: metrics.evaluatedSemanticCases,
    metrics: savedMetrics(metrics),
    usage: usageSummary(predictions),
    unavailable_fixture_ids: metrics.unavailableFixtureNames,
    cases,
  };
}

function catalogFingerprint(): string {
  return createHash("sha256")
    .update(JSON.stringify(SKILL_SELECTION_BENCHMARK_CATALOG))
    .digest("hex");
}

function createReport(runs: readonly SavedRunReport[]): SavedBenchmarkReport {
  const lexicalMetrics = calculateBenchmarkMetrics(
    SKILL_SELECTION_BENCHMARK_CASES,
    SKILL_SELECTION_BENCHMARK_CASES.map(lexicalPrediction),
  );
  return {
    schema_version: BENCHMARK_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    benchmark: {
      mode: "hosted-synthetic",
      fixture_count: SKILL_SELECTION_BENCHMARK_CASES.length,
      semantic_fixture_count: SKILL_SELECTION_BENCHMARK_CASES.filter(
        ({ explicitSkillInvocation }) => explicitSkillInvocation !== true,
      ).length,
      catalog_fingerprint: catalogFingerprint(),
      catalog_count: SKILL_SELECTION_BENCHMARK_CATALOG.length,
      model: VERCEL_GATEWAY_MODEL,
      questions: BENCHMARK_QUESTION_IDS,
      threshold: DEFAULT_SKILL_SELECTION_CONFIG.threshold,
      max_recommendations: DEFAULT_SKILL_SELECTION_CONFIG.maxRecommendations,
      retries: 0,
      budgets_ms: runs.map(({ timeout_ms }) => timeout_ms),
    },
    lexical_baseline: savedMetrics(lexicalMetrics),
    runs,
  };
}

function defaultOutputPath(): string {
  const stateHome = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(stateHome, "dotfiles", "skill-selection-benchmarks", `hosted-${stamp}.json`);
}

function isInsideRepository(path: string): boolean {
  const root = resolve(process.cwd());
  const candidate = resolve(path);
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function assertOutputIsIgnoredOrExternal(path: string): void {
  if (!isInsideRepository(path)) return;
  const relativePath = relative(resolve(process.cwd()), resolve(path));
  const result = spawnSync("git", ["check-ignore", "--no-index", "-q", "--", relativePath], {
    cwd: process.cwd(),
    stdio: "ignore",
  });
  if (result.status !== 0) {
    throw new Error("Benchmark output must be outside the repository or git-ignored");
  }
}

async function writeReport(outputPath: string, report: SavedBenchmarkReport): Promise<string> {
  const resolvedPath = resolve(outputPath);
  assertOutputIsIgnoredOrExternal(resolvedPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  const temporaryPath = join(
    dirname(resolvedPath),
    `.${basename(resolvedPath)}.${process.pid}.tmp`,
  );
  try {
    await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await rename(temporaryPath, resolvedPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return resolvedPath;
}

function optionValue(args: readonly string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline !== undefined) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseTimeout(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function printOfflineReport(): void {
  const metrics = calculateBenchmarkMetrics(
    SKILL_SELECTION_BENCHMARK_CASES,
    SKILL_SELECTION_BENCHMARK_CASES.map(lexicalPrediction),
  );
  console.log(
    JSON.stringify(
      {
        mode: "lexical",
        syntheticFixtureCount: SKILL_SELECTION_BENCHMARK_CASES.length,
        coverage: metrics.semanticCoverage,
        quality: { usable: metrics.semantic, all_attempted: metrics.semanticAllAttempted },
        end_to_end: metrics.endToEnd,
        latency_ms: metrics.latency,
      },
      null,
      2,
    ),
  );
}

async function runHosted(
  timeouts: readonly number[],
  outputPath: string | undefined,
): Promise<void> {
  if (outputPath !== undefined) assertOutputIsIgnoredOrExternal(resolve(outputPath));
  const runtime = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
  const modelRegistry = new ModelRegistry(runtime);
  const runs: SavedRunReport[] = [];
  for (const timeoutMs of timeouts) {
    const predictions: Prediction[] = [];
    for (const testCase of SKILL_SELECTION_BENCHMARK_CASES) {
      predictions.push(await jevPrediction(testCase, modelRegistry, timeoutMs));
    }
    runs.push(createRunReport(timeoutMs, predictions));
  }

  const report = createReport(runs);
  const resolvedOutput =
    outputPath === undefined ? undefined : await writeReport(outputPath, report);
  console.log(
    JSON.stringify(
      {
        mode: "hosted-synthetic",
        ...(resolvedOutput === undefined ? {} : { output: resolvedOutput }),
        budgets_ms: report.benchmark.budgets_ms,
        runs: report.runs.map(({ timeout_ms, metrics, usage, unavailable_fixture_ids }) => ({
          timeout_ms,
          metrics,
          usage,
          unavailable_fixture_ids,
        })),
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "Usage: bun run benchmark:skill-selection [--jev [--timeout-ms N]] [--hosted-compare] [--output PATH]",
    );
    console.log(
      "Default: frozen synthetic lexical baseline; hosted calls require explicit --jev or --hosted-compare.",
    );
    return;
  }

  const hostedCompare = args.includes("--hosted-compare");
  const hosted = hostedCompare || args.includes("--jev");
  const timeoutValue = optionValue(args, "--timeout-ms");
  const timeoutMs = parseTimeout(timeoutValue);
  if (args.includes("--timeout-ms") && (timeoutValue === undefined || timeoutMs === undefined)) {
    throw new Error("--timeout-ms must be a positive integer");
  }
  if (hostedCompare && timeoutMs !== undefined) {
    throw new Error("--timeout-ms cannot be combined with --hosted-compare");
  }

  if (!hosted) {
    printOfflineReport();
    return;
  }

  const output = optionValue(args, "--output");
  if (args.includes("--output") && (output === undefined || output.trim() === "")) {
    throw new Error("--output must not be empty");
  }
  const timeouts: readonly number[] = hostedCompare
    ? HOSTED_COMPARE_TIMEOUTS_MS
    : [timeoutMs ?? DEFAULT_SKILL_SELECTION_CONFIG.timeoutMs];
  await runHosted(timeouts, output ?? defaultOutputPath());
}

if (import.meta.main) {
  try {
    await main();
  } catch {
    console.error("Skill-selection benchmark failed before producing a report");
    process.exitCode = 1;
  }
}
