import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

export const VERCEL_GATEWAY_PROVIDER_ID = "vercel-ai-gateway";
export const VERCEL_GATEWAY_ENDPOINT = "https://ai-gateway.vercel.sh/typesafe/v1/systemone";
export const VERCEL_GATEWAY_MODEL = "typesafe-ai/jev";
export const DEFAULT_VERCEL_GATEWAY_TIMEOUT_MS = 2_000;
export const MAX_VERCEL_GATEWAY_RESPONSE_CHARS = 256_000;

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

async function awaitWithinDeadline<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<AwaitStageResult<T>> {
  if (signal.aborted) return { completed: false };

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
  });
}

function failure(
  reason: VercelGatewayFailureReason,
  stage: VercelGatewayStage,
  httpStatus?: number,
  retryAfterMs?: number,
): VercelGatewayFailure {
  return {
    ok: false,
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
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return 0;
  return Math.floor(timeoutMs);
}

export async function requestVercelGateway<TRequest extends object>(
  registry: VercelGatewayRegistry,
  request: TRequest,
  options: VercelGatewayRequestOptions = {},
): Promise<VercelGatewayResult> {
  const timeoutMs = normalizedTimeout(options.timeoutMs);
  const deadlineController = new AbortController();
  let timedOut = false;
  let callerCancelled = options.signal?.aborted === true;
  const timeout = setTimeout(() => {
    timedOut = true;
    deadlineController.abort();
  }, timeoutMs);
  const onCallerAbort = () => {
    callerCancelled = true;
    deadlineController.abort();
  };
  options.signal?.addEventListener("abort", onCallerAbort, { once: true });

  const stageFailure = (stage: VercelGatewayStage): VercelGatewayFailure | undefined => {
    if (callerCancelled) return failure("caller-cancellation", stage);
    if (timedOut || deadlineController.signal.aborted) return failure("timeout", stage);
    return undefined;
  };

  try {
    const initialFailure = stageFailure("auth");
    if (initialFailure !== undefined) return initialFailure;

    let authResult: AwaitStageResult<Awaited<ReturnType<VercelGatewayRegistry["getProviderAuth"]>>>;
    try {
      authResult = await awaitWithinDeadline(
        Promise.resolve().then(() => registry.getProviderAuth(VERCEL_GATEWAY_PROVIDER_ID)),
        deadlineController.signal,
      );
    } catch {
      return failure("auth-failure", "auth");
    }
    if (!authResult.completed) {
      return stageFailure("auth") ?? failure("auth-failure", "auth");
    }

    const auth = authResult.value;
    if (auth === undefined) return failure("missing-credentials", "auth");
    let apiKey: unknown;
    try {
      apiKey = auth.auth.apiKey;
    } catch {
      return failure("auth-failure", "auth");
    }
    if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
      return failure("missing-credentials", "auth");
    }

    const requestFailure = stageFailure("request");
    if (requestFailure !== undefined) return requestFailure;

    let body: string;
    try {
      // The evaluator request is assembled from bounded synthetic/catalog fields by its caller.
      body = JSON.stringify({ ...request, model: VERCEL_GATEWAY_MODEL });
    } catch {
      return failure("request-failure", "request");
    }

    let responseResult: AwaitStageResult<Response>;
    try {
      responseResult = await awaitWithinDeadline(
        Promise.resolve().then(() => {
          options.onFetchAttempt?.();
          return (options.fetch ?? globalThis.fetch)(VERCEL_GATEWAY_ENDPOINT, {
            method: "POST",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            // Keep Gateway routing private; callers supply only evaluator-specific state.
            body,
            signal: deadlineController.signal,
          });
        }),
        deadlineController.signal,
      );
    } catch {
      return stageFailure("request") ?? failure("request-failure", "request");
    }
    if (!responseResult.completed) {
      return stageFailure("request") ?? failure("request-failure", "request");
    }
    const response = responseResult.value;

    const responseFailure = stageFailure("request");
    if (responseFailure !== undefined) return responseFailure;
    if (!response.ok) {
      return failure(
        "http-status",
        "request",
        response.status,
        parseRetryAfter(response.headers.get("retry-after")),
      );
    }

    let textResult: AwaitStageResult<string>;
    try {
      textResult = await awaitWithinDeadline(response.text(), deadlineController.signal);
    } catch {
      return stageFailure("body") ?? failure("body-failure", "body");
    }
    if (!textResult.completed) return stageFailure("body") ?? failure("body-failure", "body");

    const text = textResult.value;
    const bodyDeadlineFailure = stageFailure("body");
    if (bodyDeadlineFailure !== undefined) return bodyDeadlineFailure;
    if (text.length > MAX_VERCEL_GATEWAY_RESPONSE_CHARS) {
      return failure("oversized-body", "body");
    }

    try {
      return { ok: true, value: JSON.parse(text) as unknown };
    } catch {
      return failure("invalid-json", "body");
    }
  } catch {
    const unexpectedFailure = stageFailure("request");
    return unexpectedFailure ?? failure("request-failure", "request");
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onCallerAbort);
  }
}
