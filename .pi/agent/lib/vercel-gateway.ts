import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

export const VERCEL_GATEWAY_PROVIDER_ID = "vercel-ai-gateway" as const;
export const VERCEL_GATEWAY_ENDPOINT = "https://ai-gateway.vercel.sh/typesafe/v1/systemone";
export const VERCEL_GATEWAY_MODEL = "typesafe-ai/jev";
export const OPENROUTER_PROVIDER_ID = "openrouter" as const;
export const OPENROUTER_GATEWAY_ENDPOINT = "https://openrouter.ai/api/v1/systemone";
/** OpenRouter's official TypeSafe integration accepts the bare Jev model ID. */
export const OPENROUTER_GATEWAY_MODEL = "jev-1.13";
export const JEV_GATEWAY_PROVIDER_IDS = [
  VERCEL_GATEWAY_PROVIDER_ID,
  OPENROUTER_PROVIDER_ID,
] as const;
/** Provisional total Jev budget shared by every integration and both gateways. */
export const DEFAULT_JEV_TIMEOUT_MS = 2_400;
export const DEFAULT_VERCEL_GATEWAY_TIMEOUT_MS = DEFAULT_JEV_TIMEOUT_MS;
export const MAX_VERCEL_GATEWAY_RESPONSE_CHARS = 256_000;

export type VercelGatewayProviderId = (typeof JEV_GATEWAY_PROVIDER_IDS)[number];
type VercelGatewayRegistry = Pick<ModelRegistry, "getProviderAuth">;
export type VercelGatewayFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type VercelGatewayStage = "auth" | "request" | "body";
export type VercelGatewayFailureReason =
  | "missing-credentials"
  | "auth-failure"
  | "timeout"
  | "caller-cancellation"
  | "request-failure"
  | "http-status"
  | "invalid-json"
  | "oversized-body"
  | "body-failure";

export type VercelGatewayFailure = {
  readonly ok: false;
  /** Identifies the provider whose bounded attempt produced this failure. */
  readonly provider: VercelGatewayProviderId;
  readonly stage: VercelGatewayStage;
  readonly reason: VercelGatewayFailureReason;
  readonly httpStatus?: number;
  /** Validated delay from Retry-After, in milliseconds. Never includes raw headers. */
  readonly retryAfterMs?: number;
};

export type VercelGatewayResult =
  | { readonly ok: true; readonly value: unknown }
  | VercelGatewayFailure;

export interface VercelGatewayRequestOptions {
  fetch?: VercelGatewayFetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Called immediately before fetch is invoked; receives no request or credential data. */
  onFetchAttempt?: () => void;
}

type AwaitStageResult<T> =
  | { readonly completed: true; readonly value: T }
  | { readonly completed: false };

type ProviderConfig = {
  readonly id: VercelGatewayProviderId;
  readonly endpoint: string;
  readonly model: string;
};

const PRIMARY_PROVIDER: ProviderConfig = {
  id: VERCEL_GATEWAY_PROVIDER_ID,
  endpoint: VERCEL_GATEWAY_ENDPOINT,
  model: VERCEL_GATEWAY_MODEL,
};
const FALLBACK_PROVIDER: ProviderConfig = {
  id: OPENROUTER_PROVIDER_ID,
  endpoint: OPENROUTER_GATEWAY_ENDPOINT,
  model: OPENROUTER_GATEWAY_MODEL,
};

interface DeadlineState {
  readonly signal: AbortSignal;
  readonly callerCancelled: () => boolean;
  readonly timedOut: () => boolean;
  readonly attemptTimedOut: () => boolean;
}

type AttemptDeadline = DeadlineState & { readonly dispose: () => void };

async function awaitWithinDeadline<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<AwaitStageResult<T>> {
  return new Promise<AwaitStageResult<T>>((resolve) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const finish = (result: AwaitStageResult<T>) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const onAbort = () => finish({ completed: false });

    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => finish({ completed: true, value }),
      () => finish({ completed: false }),
    );
    if (signal.aborted) finish({ completed: false });
  });
}

function createAttemptDeadline(overall: DeadlineState, timeoutMs?: number): AttemptDeadline {
  const controller = new AbortController();
  let attemptTimedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const onOverallAbort = () => controller.abort();
  if (overall.signal.aborted) controller.abort();
  else overall.signal.addEventListener("abort", onOverallAbort, { once: true });

  if (timeoutMs !== undefined && !overall.signal.aborted) {
    timeout = setTimeout(
      () => {
        if (overall.signal.aborted) return;
        attemptTimedOut = true;
        controller.abort();
      },
      Math.max(1, timeoutMs),
    );
  }

  return {
    signal: controller.signal,
    callerCancelled: overall.callerCancelled,
    timedOut: overall.timedOut,
    attemptTimedOut: () => attemptTimedOut,
    dispose: () => {
      if (timeout !== undefined) clearTimeout(timeout);
      overall.signal.removeEventListener("abort", onOverallAbort);
    },
  };
}

function failure(
  provider: VercelGatewayProviderId,
  reason: VercelGatewayFailureReason,
  stage: VercelGatewayStage,
  httpStatus?: number,
  retryAfterMs?: number,
): VercelGatewayFailure {
  return {
    ok: false,
    provider,
    stage,
    reason,
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
}

const MAX_SAFE_DELAY_MS = Number.MAX_SAFE_INTEGER;

function safeDelayMs(value: number): number | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.min(Math.floor(value), MAX_SAFE_DELAY_MS);
}

/** Parse Retry-After without retaining untrusted header text. */
export function parseRetryAfter(value: string | null, nowMs = Date.now()): number | undefined {
  if (value === null) return undefined;
  const normalized = value.trim();
  if (/^\d+$/u.test(normalized)) {
    const seconds = Number(normalized);
    if (!Number.isFinite(seconds)) return MAX_SAFE_DELAY_MS;
    return safeDelayMs(seconds * 1_000);
  }
  if (/^[+-]?\d/u.test(normalized)) return undefined;

  const timestampMs = Date.parse(normalized);
  if (!Number.isFinite(timestampMs)) return undefined;
  return safeDelayMs(Math.max(0, timestampMs - nowMs));
}

function normalizedTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return DEFAULT_VERCEL_GATEWAY_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return 1;
  return Math.max(1, Math.floor(timeoutMs));
}

function stageFailure(
  provider: VercelGatewayProviderId,
  stage: VercelGatewayStage,
  deadline: DeadlineState,
): VercelGatewayFailure | undefined {
  if (deadline.callerCancelled()) return failure(provider, "caller-cancellation", stage);
  if (deadline.timedOut() || deadline.attemptTimedOut() || deadline.signal.aborted)
    return failure(provider, "timeout", stage);
  return undefined;
}

async function requestProvider<TRequest extends object>(
  registry: VercelGatewayRegistry,
  request: TRequest,
  provider: ProviderConfig,
  options: VercelGatewayRequestOptions,
  deadline: DeadlineState,
): Promise<VercelGatewayResult> {
  const initialFailure = stageFailure(provider.id, "auth", deadline);
  if (initialFailure !== undefined) return initialFailure;

  let authResult: AwaitStageResult<Awaited<ReturnType<VercelGatewayRegistry["getProviderAuth"]>>>;
  try {
    authResult = await awaitWithinDeadline(
      Promise.resolve().then(() => registry.getProviderAuth(provider.id)),
      deadline.signal,
    );
  } catch {
    return failure(provider.id, "auth-failure", "auth");
  }
  if (!authResult.completed) {
    return (
      stageFailure(provider.id, "auth", deadline) ?? failure(provider.id, "auth-failure", "auth")
    );
  }

  const authDeadlineFailure = stageFailure(provider.id, "auth", deadline);
  if (authDeadlineFailure !== undefined) return authDeadlineFailure;

  const auth = authResult.value;
  if (auth === undefined) return failure(provider.id, "missing-credentials", "auth");
  let apiKey: unknown;
  try {
    apiKey = auth.auth.apiKey;
  } catch {
    return failure(provider.id, "auth-failure", "auth");
  }
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    return failure(provider.id, "missing-credentials", "auth");
  }

  const requestFailure = stageFailure(provider.id, "request", deadline);
  if (requestFailure !== undefined) return requestFailure;

  let body: string;
  try {
    // The evaluator request is assembled from bounded synthetic/catalog fields by its caller.
    body = JSON.stringify({ ...request, model: provider.model });
  } catch {
    return failure(provider.id, "request-failure", "request");
  }

  let responseResult: AwaitStageResult<Response>;
  try {
    responseResult = await awaitWithinDeadline(
      Promise.resolve().then(() => {
        if (deadline.signal.aborted) throw new Error("provider attempt aborted");
        options.onFetchAttempt?.();
        return (options.fetch ?? globalThis.fetch)(provider.endpoint, {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          // Keep provider routing private; callers supply only evaluator-specific state.
          body,
          signal: deadline.signal,
        });
      }),
      deadline.signal,
    );
  } catch {
    return (
      stageFailure(provider.id, "request", deadline) ??
      failure(provider.id, "request-failure", "request")
    );
  }
  if (!responseResult.completed) {
    return (
      stageFailure(provider.id, "request", deadline) ??
      failure(provider.id, "request-failure", "request")
    );
  }
  const response = responseResult.value;

  const responseFailure = stageFailure(provider.id, "request", deadline);
  if (responseFailure !== undefined) return responseFailure;
  if (!response.ok) {
    return failure(
      provider.id,
      "http-status",
      "request",
      response.status,
      parseRetryAfter(response.headers.get("retry-after")),
    );
  }

  let textResult: AwaitStageResult<string>;
  try {
    textResult = await awaitWithinDeadline(response.text(), deadline.signal);
  } catch {
    return (
      stageFailure(provider.id, "body", deadline) ?? failure(provider.id, "body-failure", "body")
    );
  }
  if (!textResult.completed) {
    return (
      stageFailure(provider.id, "body", deadline) ?? failure(provider.id, "body-failure", "body")
    );
  }

  const text = textResult.value;
  const bodyDeadlineFailure = stageFailure(provider.id, "body", deadline);
  if (bodyDeadlineFailure !== undefined) return bodyDeadlineFailure;
  if (text.length > MAX_VERCEL_GATEWAY_RESPONSE_CHARS) {
    return failure(provider.id, "oversized-body", "body");
  }

  try {
    // OpenRouter's official System One endpoint returns the same typed answers shape as TypeSafe.
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return failure(provider.id, "invalid-json", "body");
  }
}

export async function requestVercelGateway<TRequest extends object>(
  registry: VercelGatewayRegistry,
  request: TRequest,
  options: VercelGatewayRequestOptions = {},
): Promise<VercelGatewayResult> {
  const timeoutMs = normalizedTimeout(options.timeoutMs);
  const primaryTimeoutMs = Math.max(1, Math.floor(timeoutMs / 2));
  const deadlineController = new AbortController();
  let timedOut = false;
  let callerCancelled = options.signal?.aborted === true;
  if (callerCancelled) deadlineController.abort();

  const timeout = setTimeout(() => {
    timedOut = true;
    deadlineController.abort();
  }, timeoutMs);
  const onCallerAbort = () => {
    callerCancelled = true;
    deadlineController.abort();
  };
  options.signal?.addEventListener("abort", onCallerAbort, { once: true });
  const deadline: DeadlineState = {
    signal: deadlineController.signal,
    callerCancelled: () => callerCancelled,
    timedOut: () => timedOut,
    attemptTimedOut: () => false,
  };
  const runAttempt = async (
    provider: ProviderConfig,
    attemptTimeoutMs?: number,
  ): Promise<VercelGatewayResult> => {
    const attemptDeadline = createAttemptDeadline(deadline, attemptTimeoutMs);
    try {
      return await requestProvider(registry, request, provider, options, attemptDeadline);
    } finally {
      attemptDeadline.dispose();
    }
  };

  try {
    const primary = await runAttempt(PRIMARY_PROVIDER, primaryTimeoutMs);
    if (primary.ok || callerCancelled || timedOut || deadlineController.signal.aborted)
      return primary;

    const fallback = await runAttempt(FALLBACK_PROVIDER);
    if (
      !fallback.ok &&
      fallback.stage === "auth" &&
      (fallback.reason === "missing-credentials" || fallback.reason === "auth-failure") &&
      !(
        primary.stage === "auth" &&
        (primary.reason === "missing-credentials" || primary.reason === "auth-failure")
      )
    ) {
      // Keep useful primary diagnostics such as Vercel's Retry-After when the fallback is unavailable.
      return primary;
    }
    return fallback;
  } catch {
    const provider = callerCancelled || timedOut ? PRIMARY_PROVIDER.id : FALLBACK_PROVIDER.id;
    return (
      stageFailure(provider, "request", deadline) ?? failure(provider, "request-failure", "request")
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onCallerAbort);
  }
}
