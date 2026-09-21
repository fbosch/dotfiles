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
import {
  DEFAULT_HOSTED_MAX_ATTEMPTS,
  DEFAULT_HOSTED_MAX_CASE_WAIT_MS,
  DEFAULT_HOSTED_MAX_RUN_WAIT_MS,
  DEFAULT_HOSTED_RETRY_BASE_MS,
  DEFAULT_HOSTED_RETRY_CAP_MS,
  type HostedAttemptSummary,
  type HostedCaseExecution,
  type HostedRetryOptions,
  type HostedRunStopReason,
  type HostedWait,
  MAX_HOSTED_ATTEMPTS,
  MAX_HOSTED_WAIT_MS,
  runWithHostedRetries,
} from "./skill-selection-retries";

const HOSTED_COMPARE_TIMEOUTS_MS = [600, 2_000] as const;
const DEFAULT_HOSTED_DELAY_MS = 1_000;
const DEFAULT_HOSTED_RETRY_OPTIONS: Omit<HostedRetryOptions, "pacingDelayMs"> = {
  maxAttempts: DEFAULT_HOSTED_MAX_ATTEMPTS,
  retryBaseMs: DEFAULT_HOSTED_RETRY_BASE_MS,
  retryCapMs: DEFAULT_HOSTED_RETRY_CAP_MS,
  maxCaseWaitMs: DEFAULT_HOSTED_MAX_CASE_WAIT_MS,
  maxRunWaitMs: DEFAULT_HOSTED_MAX_RUN_WAIT_MS,
};
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
  | "prediction-mismatch"
  | "retry-budget-exhausted";

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
  "retry-budget-exhausted": "retry-budget-exhausted",
};

function safeSavedFailureReason(stage: BenchmarkFailureStage, reason: string): SavedFailureReason {
  return (
    SAVED_FAILURE_REASONS[reason] ??
    (stage === "evaluation" ? "invalid-evaluation-response" : "request-failure")
  );
}

interface SavedCaseReport {
  readonly fixture_id: string;
  readonly outcome: "correct" | "incorrect" | "unavailable" | "explicit-bypass" | "not-attempted";
  readonly expected: readonly string[];
  readonly predictions: readonly string[];
  readonly elapsed_ms: number | null;
  readonly failure: {
    readonly stage: BenchmarkFailureStage;
    readonly reason: SavedFailureReason;
    readonly http_status?: number;
    readonly retry_after_ms?: number;
  } | null;
  readonly wall_duration_ms: number | null;
  readonly retry_wait_ms: number;
  readonly attempts: readonly SavedAttemptReport[];
  readonly usage: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
  } | null;
}

interface SavedAttemptReport {
  readonly attempt: number;
  readonly status: "success" | "failure";
  readonly stage?: BenchmarkFailureStage;
  readonly reason?: SavedFailureReason;
  readonly http_status?: number;
  readonly retry_after_ms?: number;
  readonly elapsed_ms: number | null;
  readonly retry_wait_ms?: number;
}

interface SavedRunReport {
  readonly timeout_ms: number;
  readonly complete: boolean;
  readonly stop_reason: HostedRunStopReason | null;
  readonly stopped_fixture_id: string | null;
  readonly wall_duration_ms: number;
  readonly retry_wait_ms: number;
  readonly api_calls: number;
  readonly responses: number;
  readonly metrics: ReturnType<typeof savedMetrics>;
  readonly usage: {
    readonly responses: number;
    readonly input_tokens: number;
    readonly output_tokens: number;
  };
  readonly unavailable_fixture_ids: readonly string[];
  readonly not_attempted_fixture_ids: readonly string[];
  readonly cases: readonly SavedCaseReport[];
}

interface SavedBenchmarkReport {
  readonly schema_version: number;
  readonly generated_at: string;
  readonly complete: boolean;
  readonly incomplete_reason: HostedRunStopReason | null;
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
    readonly max_attempts: number;
    readonly delay_ms: number;
    readonly retry_base_ms: number;
    readonly retry_cap_ms: number;
    readonly max_case_wait_ms: number;
    readonly max_run_wait_ms: number;
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

function safeFailure(failure: SkillSelectionFailure): NonNullable<Prediction["failure"]> {
  return {
    stage: failure.stage === "evaluation" ? "evaluation" : failure.stage,
    reason: failure.reason,
    ...(failure.kind === "gateway-failure" && failure.httpStatus === undefined
      ? {}
      : failure.kind === "gateway-failure"
        ? { httpStatus: failure.httpStatus }
        : {}),
    ...(failure.kind === "gateway-failure" && failure.retryAfterMs === undefined
      ? {}
      : failure.kind === "gateway-failure"
        ? { retryAfterMs: failure.retryAfterMs }
        : {}),
  };
}

function unexpectedFailure(): NonNullable<Prediction["failure"]> {
  return { stage: "request", reason: "request-failure" satisfies VercelGatewayFailureReason };
}

async function jevPrediction(
  testCase: SkillSelectionBenchmarkCase,
  modelRegistry: ModelRegistry,
  timeoutMs: number,
  signal?: AbortSignal,
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
      { modelRegistry, ...(signal === undefined ? {} : { signal }) },
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
      failure:
        signal?.aborted === true
          ? { stage: "request", reason: "caller-cancellation" }
          : unexpectedFailure(),
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

function savedAttemptReport(attempt: HostedAttemptSummary): SavedAttemptReport {
  return {
    attempt: attempt.attempt,
    status: attempt.status,
    ...(attempt.stage === undefined ? {} : { stage: attempt.stage }),
    ...(attempt.reason === undefined
      ? {}
      : { reason: safeSavedFailureReason(attempt.stage ?? "request", attempt.reason) }),
    ...(attempt.httpStatus === undefined ? {} : { http_status: attempt.httpStatus }),
    ...(attempt.retryAfterMs === undefined ? {} : { retry_after_ms: attempt.retryAfterMs }),
    elapsed_ms: attempt.elapsedMs,
    ...(attempt.retryWaitMs === undefined ? {} : { retry_wait_ms: attempt.retryWaitMs }),
  };
}

function savedCaseReport(
  testCase: SkillSelectionBenchmarkCase,
  prediction: Prediction | undefined,
  execution?: HostedCaseExecution,
): SavedCaseReport {
  if (prediction === undefined) {
    return {
      fixture_id: testCase.name,
      outcome: "not-attempted",
      expected: testCase.relevant,
      predictions: [],
      elapsed_ms: null,
      wall_duration_ms: execution?.wallDurationMs ?? null,
      retry_wait_ms: execution?.retryWaitMs ?? 0,
      attempts: execution?.attempts.map(savedAttemptReport) ?? [],
      failure: null,
      usage: null,
    };
  }

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
          ...(failureSource.retryAfterMs === undefined
            ? {}
            : { retry_after_ms: failureSource.retryAfterMs }),
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
    wall_duration_ms: execution?.wallDurationMs ?? prediction.latencyMs ?? null,
    retry_wait_ms: execution?.retryWaitMs ?? 0,
    attempts: execution?.attempts.map(savedAttemptReport) ?? [],
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
    not_attempted_cases: metrics.notAttemptedCases,
    not_attempted_semantic_cases: metrics.notAttemptedSemanticCases,
    not_attempted_bypass_cases: metrics.notAttemptedBypassCases,
    failures: metrics.failures,
  };
}

function usageSummary(
  cases: readonly SkillSelectionBenchmarkCase[],
  predictions: readonly (Prediction | undefined)[],
) {
  const withUsage = predictions.filter(
    (prediction, index): prediction is Prediction =>
      cases[index]?.explicitSkillInvocation !== true && prediction?.usage !== undefined,
  );
  return {
    responses: predictions.filter(
      (prediction, index) =>
        cases[index]?.explicitSkillInvocation !== true &&
        prediction !== undefined &&
        prediction.unavailable !== true,
    ).length,
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

function createRunReport(
  timeoutMs: number,
  execution: {
    readonly cases: readonly HostedCaseExecution[];
    readonly retryWaitMs: number;
    readonly wallDurationMs: number;
    readonly complete: boolean;
    readonly stop?: { readonly caseIndex: number; readonly reason: HostedRunStopReason };
  },
): SavedRunReport {
  const executionByIndex = new Map(execution.cases.map((entry) => [entry.caseIndex, entry]));
  const predictions = SKILL_SELECTION_BENCHMARK_CASES.map(
    (_testCase, index) => executionByIndex.get(index)?.prediction,
  );
  const metrics = calculateBenchmarkMetrics(SKILL_SELECTION_BENCHMARK_CASES, predictions);
  const cases = SKILL_SELECTION_BENCHMARK_CASES.map((testCase, index) => {
    const entry = executionByIndex.get(index);
    return savedCaseReport(testCase, entry?.prediction, entry);
  });
  return {
    timeout_ms: timeoutMs,
    complete: execution.complete,
    stop_reason: execution.stop?.reason ?? null,
    stopped_fixture_id:
      execution.stop === undefined
        ? null
        : (SKILL_SELECTION_BENCHMARK_CASES[execution.stop.caseIndex]?.name ?? null),
    wall_duration_ms: execution.wallDurationMs,
    retry_wait_ms: execution.retryWaitMs,
    api_calls: execution.cases.reduce((sum, entry) => sum + entry.attempts.length, 0),
    responses: metrics.evaluatedSemanticCases,
    metrics: savedMetrics(metrics),
    usage: usageSummary(SKILL_SELECTION_BENCHMARK_CASES, predictions),
    unavailable_fixture_ids: metrics.unavailableFixtureNames,
    not_attempted_fixture_ids: SKILL_SELECTION_BENCHMARK_CASES.filter(
      (_testCase, index) => predictions[index] === undefined,
    ).map(({ name }) => name),
    cases,
  };
}

function catalogFingerprint(): string {
  return createHash("sha256")
    .update(JSON.stringify(SKILL_SELECTION_BENCHMARK_CATALOG))
    .digest("hex");
}

function createReport(
  runs: readonly SavedRunReport[],
  retryOptions: HostedRetryOptions,
): SavedBenchmarkReport {
  const lexicalMetrics = calculateBenchmarkMetrics(
    SKILL_SELECTION_BENCHMARK_CASES,
    SKILL_SELECTION_BENCHMARK_CASES.map(lexicalPrediction),
  );
  const incompleteRun = runs.find((run) => !run.complete);
  return {
    schema_version: BENCHMARK_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    complete: incompleteRun === undefined,
    incomplete_reason: incompleteRun?.stop_reason ?? null,
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
      retries: retryOptions.maxAttempts - 1,
      max_attempts: retryOptions.maxAttempts,
      delay_ms: retryOptions.pacingDelayMs,
      retry_base_ms: retryOptions.retryBaseMs,
      retry_cap_ms: retryOptions.retryCapMs,
      max_case_wait_ms: retryOptions.maxCaseWaitMs,
      max_run_wait_ms: retryOptions.maxRunWaitMs,
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
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseDelay(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= MAX_HOSTED_WAIT_MS
    ? parsed
    : undefined;
}

const FLAG_OPTIONS = new Set(["--help", "--jev", "--hosted-compare"]);
const VALUE_OPTIONS = new Set([
  "--delay-ms",
  "--timeout-ms",
  "--output",
  "--max-attempts",
  "--retries",
  "--retry-base-ms",
  "--retry-cap-ms",
  "--max-case-wait-ms",
  "--max-run-wait-ms",
]);

function validateArguments(args: readonly string[]): void {
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) continue;
    const equalsIndex = argument.indexOf("=");
    const name = equalsIndex === -1 ? argument : argument.slice(0, equalsIndex);
    if (FLAG_OPTIONS.has(name)) {
      if (equalsIndex !== -1) throw new Error(`${name} does not take a value`);
      if (seen.has(name)) throw new Error(`${name} may be specified only once`);
      seen.add(name);
      continue;
    }
    if (!VALUE_OPTIONS.has(name)) throw new Error(`Unknown option: ${name}`);
    if (seen.has(name)) throw new Error(`${name} may be specified only once`);
    seen.add(name);
    if (equalsIndex === -1) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${name} requires a value`);
      }
      index += 1;
    } else if (argument.length === equalsIndex + 1) {
      throw new Error(`${name} requires a value`);
    }
  }
}

function requiredNonnegativeOption(
  args: readonly string[],
  name: string,
  defaultValue: number,
): number {
  const value = optionValue(args, name);
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_HOSTED_WAIT_MS) {
    throw new Error(
      `${name} must be a nonnegative safe integer no greater than ${MAX_HOSTED_WAIT_MS}`,
    );
  }
  return parsed;
}

function requiredRetryCount(args: readonly string[]): number | undefined {
  const value = optionValue(args, "--retries");
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed >= MAX_HOSTED_ATTEMPTS) {
    throw new Error(
      `--retries must be a nonnegative safe integer less than ${MAX_HOSTED_ATTEMPTS}`,
    );
  }
  return parsed;
}

function requiredPositiveOption(
  args: readonly string[],
  name: string,
  defaultValue: number,
): number {
  const value = optionValue(args, name);
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_HOSTED_ATTEMPTS) {
    throw new Error(
      `${name} must be a positive safe integer no greater than ${MAX_HOSTED_ATTEMPTS}`,
    );
  }
  return parsed;
}

function retryOptionsFromArgs(args: readonly string[], delayMs: number): HostedRetryOptions {
  if (args.includes("--retries") && args.includes("--max-attempts")) {
    throw new Error("--retries cannot be combined with --max-attempts");
  }
  const retries = requiredRetryCount(args);
  const maxAttempts =
    retries === undefined
      ? requiredPositiveOption(args, "--max-attempts", DEFAULT_HOSTED_RETRY_OPTIONS.maxAttempts)
      : retries + 1;
  const retryBaseMs = requiredNonnegativeOption(
    args,
    "--retry-base-ms",
    DEFAULT_HOSTED_RETRY_OPTIONS.retryBaseMs,
  );
  const retryCapMs = requiredNonnegativeOption(
    args,
    "--retry-cap-ms",
    DEFAULT_HOSTED_RETRY_OPTIONS.retryCapMs,
  );
  const maxCaseWaitMs = requiredNonnegativeOption(
    args,
    "--max-case-wait-ms",
    DEFAULT_HOSTED_RETRY_OPTIONS.maxCaseWaitMs,
  );
  const maxRunWaitMs = requiredNonnegativeOption(
    args,
    "--max-run-wait-ms",
    DEFAULT_HOSTED_RETRY_OPTIONS.maxRunWaitMs,
  );
  if (retryCapMs < retryBaseMs) throw new Error("--retry-cap-ms must be at least --retry-base-ms");
  return {
    pacingDelayMs: delayMs,
    maxAttempts,
    retryBaseMs,
    retryCapMs,
    maxCaseWaitMs,
    maxRunWaitMs,
  };
}

export async function waitBetweenHostedCalls(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) {
    if (signal?.aborted === true) throw new Error("hosted pacing wait cancelled");
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("hosted pacing wait cancelled"));
    };
    if (signal?.aborted === true) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runWithHostedPacing<T>(
  cases: readonly { explicitSkillInvocation?: boolean }[],
  delayMs: number,
  request: (index: number) => Promise<T>,
  wait: (delayMs: number) => Promise<void> = waitBetweenHostedCalls,
  initialHostedCalls = 0,
): Promise<{ results: T[]; hostedCalls: number }> {
  let hostedCalls = initialHostedCalls;
  const results: T[] = [];
  for (const [index, testCase] of cases.entries()) {
    if (testCase.explicitSkillInvocation !== true) {
      if (hostedCalls > 0) await wait(delayMs);
      hostedCalls += 1;
    }
    results.push(await request(index));
  }
  return { results, hostedCalls };
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

export async function runHosted(
  timeouts: readonly number[],
  outputPath: string | undefined,
  delayMs = DEFAULT_HOSTED_DELAY_MS,
  wait: HostedWait = waitBetweenHostedCalls,
  retryConfig: Omit<HostedRetryOptions, "pacingDelayMs"> = DEFAULT_HOSTED_RETRY_OPTIONS,
  signal?: AbortSignal,
): Promise<void> {
  if (outputPath !== undefined) assertOutputIsIgnoredOrExternal(resolve(outputPath));
  const runtime = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
  const modelRegistry = new ModelRegistry(runtime);
  const runs: SavedRunReport[] = [];
  let hostedCalls = 0;
  const retryOptions: HostedRetryOptions = { pacingDelayMs: delayMs, ...retryConfig };

  for (const timeoutMs of timeouts) {
    const execution = await runWithHostedRetries(
      SKILL_SELECTION_BENCHMARK_CASES,
      retryOptions,
      (index) => {
        const testCase = SKILL_SELECTION_BENCHMARK_CASES[index];
        if (testCase === undefined) throw new Error(`Missing benchmark case at index ${index}`);
        return jevPrediction(testCase, modelRegistry, timeoutMs, signal);
      },
      wait,
      hostedCalls,
      signal,
    );
    hostedCalls = execution.hostedCalls;
    runs.push(createRunReport(timeoutMs, execution));
    if (!execution.complete) break;
  }

  const report = createReport(runs, retryOptions);
  const resolvedOutput =
    outputPath === undefined ? undefined : await writeReport(outputPath, report);
  console.log(
    JSON.stringify(
      {
        mode: "hosted-synthetic",
        complete: report.complete,
        ...(report.incomplete_reason === null
          ? {}
          : { incomplete_reason: report.incomplete_reason }),
        ...(resolvedOutput === undefined ? {} : { output: resolvedOutput }),
        budgets_ms: report.benchmark.budgets_ms,
        runs: report.runs.map(
          ({
            timeout_ms,
            complete,
            stop_reason,
            metrics,
            usage,
            unavailable_fixture_ids,
            not_attempted_fixture_ids,
          }) => ({
            timeout_ms,
            complete,
            stop_reason,
            metrics,
            usage,
            unavailable_fixture_ids,
            not_attempted_fixture_ids,
          }),
        ),
      },
      null,
      2,
    ),
  );
  if (!report.complete)
    throw new Error("Skill-selection benchmark incomplete; partial report saved");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  validateArguments(args);
  if (args.includes("--help")) {
    console.log(
      "Usage: bun run benchmark:skill-selection [--jev [--timeout-ms N]] [--hosted-compare] [--delay-ms N] [--max-attempts N|--retries N] [--retry-base-ms N] [--retry-cap-ms N] [--max-case-wait-ms N] [--max-run-wait-ms N] [--output PATH]",
    );
    console.log(
      "--delay-ms: nonnegative milliseconds between hosted requests (default: 1000; 0 disables pacing).",
    );
    console.log(
      "--max-attempts: total attempts per case, including the initial request (default: 5; --retries is an alias for the retry count).",
    );
    console.log(
      "--retry-base-ms/--retry-cap-ms: bounded exponential retry wait (defaults: 2000/30000).",
    );
    console.log(
      "--max-case-wait-ms/--max-run-wait-ms: total retry-wait budgets (defaults: 120000/600000).",
    );
    console.log(
      "Default: frozen synthetic lexical baseline; hosted calls require explicit --jev or --hosted-compare.",
    );
    return;
  }

  const hostedCompare = args.includes("--hosted-compare");
  const hosted = hostedCompare || args.includes("--jev");
  const delayValue = optionValue(args, "--delay-ms");
  const delayMs = parseDelay(delayValue);
  if (args.includes("--delay-ms") && (delayValue === undefined || delayMs === undefined)) {
    throw new Error("--delay-ms must be a nonnegative safe integer");
  }
  const effectiveDelayMs = delayMs ?? DEFAULT_HOSTED_DELAY_MS;
  const retryOptions = retryOptionsFromArgs(args, effectiveDelayMs);
  const timeoutValue = optionValue(args, "--timeout-ms");
  const timeoutMs = parseTimeout(timeoutValue);
  if (args.includes("--timeout-ms") && (timeoutValue === undefined || timeoutMs === undefined)) {
    throw new Error("--timeout-ms must be a positive safe integer");
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
  const retryConfig = {
    maxAttempts: retryOptions.maxAttempts,
    retryBaseMs: retryOptions.retryBaseMs,
    retryCapMs: retryOptions.retryCapMs,
    maxCaseWaitMs: retryOptions.maxCaseWaitMs,
    maxRunWaitMs: retryOptions.maxRunWaitMs,
  };
  const cancellation = new AbortController();
  const onInterrupt = () => cancellation.abort();
  // SAFETY: Bun's process typings omit POSIX signals, but runtime process exposes these methods.
  const signalProcess = process as unknown as {
    once: (event: string, listener: () => void) => void;
    removeListener: (event: string, listener: () => void) => void;
  };
  signalProcess.once("SIGINT", onInterrupt);
  try {
    await runHosted(
      timeouts,
      output ?? defaultOutputPath(),
      effectiveDelayMs,
      waitBetweenHostedCalls,
      retryConfig,
      cancellation.signal,
    );
  } finally {
    signalProcess.removeListener("SIGINT", onInterrupt);
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch {
    console.error("Skill-selection benchmark failed; a partial report may have been saved");
    process.exitCode = 1;
  }
}
