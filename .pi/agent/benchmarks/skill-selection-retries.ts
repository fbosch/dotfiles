import type {
  BenchmarkFailureStage,
  BenchmarkPrediction,
  BenchmarkPredictionFailure,
} from "./skill-selection-metrics";

export const DEFAULT_HOSTED_MAX_ATTEMPTS = 5;
export const MAX_HOSTED_ATTEMPTS = 100;
export const MAX_HOSTED_WAIT_MS = 86_400_000;
export const DEFAULT_HOSTED_RETRY_BASE_MS = 2_000;
export const DEFAULT_HOSTED_RETRY_CAP_MS = 30_000;
export const DEFAULT_HOSTED_MAX_CASE_WAIT_MS = 120_000;
export const DEFAULT_HOSTED_MAX_RUN_WAIT_MS = 600_000;

export interface HostedRetryOptions {
  readonly pacingDelayMs: number;
  readonly maxAttempts: number;
  readonly retryBaseMs: number;
  readonly retryCapMs: number;
  readonly maxCaseWaitMs: number;
  readonly maxRunWaitMs: number;
}

export interface HostedAttemptSummary {
  readonly attempt: number;
  readonly status: "success" | "failure";
  readonly stage?: BenchmarkFailureStage;
  readonly reason?: string;
  readonly httpStatus?: number;
  readonly retryAfterMs?: number;
  readonly elapsedMs: number | null;
  readonly retryWaitMs?: number;
}

export interface HostedCaseExecution {
  readonly caseIndex: number;
  readonly prediction?: BenchmarkPrediction;
  readonly attempts: readonly HostedAttemptSummary[];
  readonly retryWaitMs: number;
  readonly wallDurationMs: number;
}

export type HostedRunStopReason =
  | "failure"
  | "retry-exhausted"
  | "retry-budget-exhausted"
  | "cancelled";

export interface HostedRunExecution {
  readonly cases: readonly HostedCaseExecution[];
  readonly hostedCalls: number;
  readonly retryWaitMs: number;
  readonly wallDurationMs: number;
  readonly complete: boolean;
  readonly stop?: {
    readonly caseIndex: number;
    readonly reason: HostedRunStopReason;
  };
}

export type HostedWait = (delayMs: number, signal?: AbortSignal) => Promise<void>;
export type HostedNow = () => number;

const DEFAULT_WAIT: HostedWait = (delayMs, signal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new HostedWaitCancelled());
    };
    if (signal?.aborted === true) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });

function finiteNonNegative(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function failureOf(prediction: BenchmarkPrediction): BenchmarkPredictionFailure | undefined {
  return prediction.unavailable === true ? prediction.failure : undefined;
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export function isHostedRetryableFailure(prediction: BenchmarkPrediction): boolean {
  const failure = failureOf(prediction);
  if (failure === undefined) return false;
  if (failure.reason === "timeout") {
    return failure.stage === "request" || failure.stage === "body";
  }
  if (failure.reason === "request-failure" || failure.reason === "body-failure") {
    return failure.stage === "request" || failure.stage === "body";
  }
  if (failure.reason !== "http-status" || failure.httpStatus === undefined) return false;
  return failure.httpStatus === 429 || (failure.httpStatus >= 500 && failure.httpStatus <= 599);
}

function cancellationPrediction(): BenchmarkPrediction {
  return {
    names: [],
    unavailable: true,
    failure: { stage: "request", reason: "caller-cancellation" },
  };
}

function requestFailurePrediction(): BenchmarkPrediction {
  return {
    names: [],
    unavailable: true,
    failure: { stage: "request", reason: "request-failure" },
  };
}

function budgetPrediction(prediction: BenchmarkPrediction): BenchmarkPrediction {
  return {
    ...prediction,
    names: [],
    unavailable: true,
    failure: {
      stage: "request",
      reason: "retry-budget-exhausted",
      ...(prediction.failure?.httpStatus === undefined
        ? {}
        : { httpStatus: prediction.failure.httpStatus }),
      ...(prediction.failure?.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: prediction.failure.retryAfterMs }),
    },
  };
}

function attemptSummary(attempt: number, prediction: BenchmarkPrediction): HostedAttemptSummary {
  const failure = failureOf(prediction);
  const elapsedMs = finiteNonNegative(prediction.latencyMs) ?? null;
  return {
    attempt,
    status: failure === undefined ? "success" : "failure",
    ...(failure === undefined ? {} : { stage: failure.stage, reason: failure.reason }),
    ...(failure?.httpStatus === undefined ? {} : { httpStatus: failure.httpStatus }),
    ...(failure?.retryAfterMs === undefined ? {} : { retryAfterMs: failure.retryAfterMs }),
    elapsedMs,
  };
}

class HostedWaitCancelled extends Error {
  constructor() {
    super("hosted benchmark wait cancelled");
  }
}

async function waitWithCancellation(
  delayMs: number,
  wait: HostedWait,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (delayMs <= 0) {
    if (signal?.aborted === true) throw new HostedWaitCancelled();
    return;
  }
  if (signal?.aborted === true) throw new HostedWaitCancelled();

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => finish(() => reject(new HostedWaitCancelled()));

    signal?.addEventListener("abort", onAbort, { once: true });
    void wait(delayMs, signal).then(
      () => finish(resolve),
      () => finish(() => reject(new HostedWaitCancelled())),
    );
  });
}

function validateRetryOptions(options: HostedRetryOptions): void {
  if (
    !Number.isSafeInteger(options.pacingDelayMs) ||
    options.pacingDelayMs < 0 ||
    options.pacingDelayMs > MAX_HOSTED_WAIT_MS ||
    !Number.isSafeInteger(options.maxAttempts) ||
    options.maxAttempts < 1 ||
    options.maxAttempts > MAX_HOSTED_ATTEMPTS ||
    !Number.isSafeInteger(options.retryBaseMs) ||
    options.retryBaseMs < 0 ||
    !Number.isSafeInteger(options.retryCapMs) ||
    options.retryCapMs < options.retryBaseMs ||
    options.retryCapMs > MAX_HOSTED_WAIT_MS ||
    !Number.isSafeInteger(options.maxCaseWaitMs) ||
    options.maxCaseWaitMs < 0 ||
    options.maxCaseWaitMs > MAX_HOSTED_WAIT_MS ||
    !Number.isSafeInteger(options.maxRunWaitMs) ||
    options.maxRunWaitMs < 0 ||
    options.maxRunWaitMs > MAX_HOSTED_WAIT_MS
  ) {
    throw new Error("Invalid hosted benchmark retry options");
  }
}

function retryDelayMs(
  failedAttempt: number,
  failure: BenchmarkPredictionFailure,
  options: HostedRetryOptions,
): number {
  const exponential = Math.min(
    options.retryCapMs,
    options.retryBaseMs * 2 ** Math.max(0, failedAttempt - 1),
  );
  const retryAfterMs = finiteNonNegative(failure.retryAfterMs) ?? 0;
  return Math.max(exponential, retryAfterMs);
}

export async function runWithHostedRetries(
  cases: readonly { explicitSkillInvocation?: boolean }[],
  options: HostedRetryOptions,
  request: (index: number, attempt: number) => Promise<BenchmarkPrediction>,
  wait: HostedWait = DEFAULT_WAIT,
  initialHostedCalls = 0,
  signal?: AbortSignal,
  now: HostedNow = () => performance.now(),
): Promise<HostedRunExecution> {
  validateRetryOptions(options);
  const runStartedAt = now();
  const executions: HostedCaseExecution[] = [];
  let hostedCalls = initialHostedCalls;
  let retryWaitMs = 0;
  let stop: HostedRunExecution["stop"];

  for (const [caseIndex, testCase] of cases.entries()) {
    if (isAborted(signal)) {
      stop = { caseIndex, reason: "cancelled" };
      break;
    }

    const caseStartedAt = now();
    const attempts: HostedAttemptSummary[] = [];
    let caseRetryWaitMs = 0;
    let pendingRetryWaitMs = 0;
    let activeElapsedMs = 0;
    let finalPrediction: BenchmarkPrediction | undefined;
    let caseStopReason: HostedRunStopReason | undefined;

    for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
      const pacingWaitMs =
        testCase.explicitSkillInvocation === true || hostedCalls === 0 ? 0 : options.pacingDelayMs;
      // One wait preserves request pacing without adding a second sleep after backoff.
      const effectiveWaitMs = Math.max(pacingWaitMs, pendingRetryWaitMs);
      if (effectiveWaitMs > 0) {
        try {
          await waitWithCancellation(effectiveWaitMs, wait, signal);
        } catch {
          finalPrediction = attempts.length === 0 ? undefined : cancellationPrediction();
          caseStopReason = "cancelled";
          break;
        }
      }
      if (isAborted(signal)) {
        finalPrediction = attempts.length === 0 ? undefined : cancellationPrediction();
        caseStopReason = "cancelled";
        break;
      }

      if (testCase.explicitSkillInvocation !== true) hostedCalls += 1;
      let prediction: BenchmarkPrediction;
      try {
        prediction = await request(caseIndex, attempt);
      } catch {
        prediction = isAborted(signal) ? cancellationPrediction() : requestFailurePrediction();
      }
      const summary = attemptSummary(attempt, prediction);
      pendingRetryWaitMs = 0;
      activeElapsedMs += finiteNonNegative(prediction.latencyMs) ?? 0;
      finalPrediction = {
        ...prediction,
        latencyMs: activeElapsedMs,
      };

      if (testCase.explicitSkillInvocation === true) {
        if (prediction.unavailable === true) caseStopReason = "failure";
        break;
      }

      if (!isHostedRetryableFailure(prediction)) {
        attempts.push(summary);
        if (prediction.unavailable === true) {
          caseStopReason =
            prediction.failure?.reason === "caller-cancellation" ? "cancelled" : "failure";
        }
        break;
      }
      if (attempt >= options.maxAttempts) {
        attempts.push(summary);
        caseStopReason = "retry-exhausted";
        break;
      }

      const failure = failureOf(prediction);
      if (failure === undefined) {
        attempts.push(summary);
        caseStopReason = "failure";
        break;
      }
      const nextWaitMs = retryDelayMs(attempt, failure, options);
      const caseRemainingMs = options.maxCaseWaitMs - caseRetryWaitMs;
      const runRemainingMs = options.maxRunWaitMs - retryWaitMs;
      if (nextWaitMs > caseRemainingMs || nextWaitMs > runRemainingMs) {
        attempts.push(summary);
        finalPrediction = { ...budgetPrediction(prediction), latencyMs: activeElapsedMs };
        caseStopReason = "retry-budget-exhausted";
        break;
      }

      attempts.push({ ...summary, retryWaitMs: nextWaitMs });
      caseRetryWaitMs += nextWaitMs;
      retryWaitMs += nextWaitMs;
      pendingRetryWaitMs = nextWaitMs;
    }

    if (finalPrediction !== undefined || attempts.length > 0 || caseStopReason === "cancelled") {
      executions.push({
        caseIndex,
        ...(finalPrediction === undefined ? {} : { prediction: finalPrediction }),
        attempts,
        retryWaitMs: caseRetryWaitMs,
        wallDurationMs: Math.max(0, now() - caseStartedAt),
      });
    }

    if (caseStopReason !== undefined) {
      stop = { caseIndex, reason: caseStopReason };
      break;
    }
  }

  return {
    cases: executions,
    hostedCalls,
    retryWaitMs,
    wallDurationMs: Math.max(0, now() - runStartedAt),
    complete: stop === undefined && executions.length === cases.length,
    ...(stop === undefined ? {} : { stop }),
  };
}
