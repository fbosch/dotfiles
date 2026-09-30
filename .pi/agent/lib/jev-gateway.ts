import { join } from "node:path";
import { getAgentDir, type ModelRegistry } from "@earendil-works/pi-coding-agent";
import { readJsonConfig } from "./extension-config";

export const VERCEL_GATEWAY_PROVIDER_ID = "vercel-ai-gateway" as const;
export const VERCEL_GATEWAY_ENDPOINT = "https://ai-gateway.vercel.sh/typesafe/v1/systemone";
export const VERCEL_GATEWAY_MODEL = "typesafe-ai/jev";
export const OPENROUTER_PROVIDER_ID = "openrouter" as const;
export const OPENROUTER_GATEWAY_ENDPOINT = "https://openrouter.ai/api/v1/systemone";
export const OPENROUTER_CONFIG_MODEL = "typesafe/jev-1.13";
/** OpenRouter's System One endpoint accepts the bare Jev model ID. */
export const OPENROUTER_GATEWAY_MODEL = "jev-1.13";
export const JEV_GATEWAY_PROVIDER_IDS = [
  OPENROUTER_PROVIDER_ID,
  VERCEL_GATEWAY_PROVIDER_ID,
] as const;
/** Provisional total Jev budget shared by every integration and both gateways. */
export const DEFAULT_JEV_TIMEOUT_MS = 2_400;
export const DEFAULT_VERCEL_GATEWAY_TIMEOUT_MS = DEFAULT_JEV_TIMEOUT_MS;
export const MAX_VERCEL_GATEWAY_RESPONSE_CHARS = 256_000;

export type JevGatewayProviderId = (typeof JEV_GATEWAY_PROVIDER_IDS)[number];
type JevGatewayRegistry = Pick<ModelRegistry, "getProviderAuth">;
export type JevGatewayFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type JevGatewayStage = "config" | "auth" | "request" | "body";
export type JevGatewayFailureReason =
  | "invalid-config"
  | "missing-credentials"
  | "auth-failure"
  | "timeout"
  | "caller-cancellation"
  | "request-failure"
  | "http-status"
  | "invalid-json"
  | "oversized-body"
  | "body-failure";

export type JevGatewayFailure = {
  readonly ok: false;
  /** Identifies the provider whose bounded attempt produced this failure. */
  readonly provider?: JevGatewayProviderId;
  readonly stage: JevGatewayStage;
  readonly reason: JevGatewayFailureReason;
  readonly httpStatus?: number;
  /** Validated delay from Retry-After, in milliseconds. Never includes raw headers. */
  readonly retryAfterMs?: number;
};

export type JevGatewayResult = { readonly ok: true; readonly value: unknown } | JevGatewayFailure;

export interface JevGatewayRequestOptions {
  fetch?: JevGatewayFetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Called immediately before fetch is invoked; receives no request or credential data. */
  onFetchAttempt?: () => void;
}

type AwaitStageResult<T> =
  | { readonly completed: true; readonly value: T }
  | { readonly completed: false };

type ProviderConfig = {
  readonly id: JevGatewayProviderId;
  readonly endpoint: string;
  readonly model: string;
};

const DEFAULT_PROVIDERS: readonly ProviderConfig[] = [
  {
    id: OPENROUTER_PROVIDER_ID,
    endpoint: OPENROUTER_GATEWAY_ENDPOINT,
    model: OPENROUTER_GATEWAY_MODEL,
  },
  {
    id: VERCEL_GATEWAY_PROVIDER_ID,
    endpoint: VERCEL_GATEWAY_ENDPOINT,
    model: VERCEL_GATEWAY_MODEL,
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function isSupportedTypeSafeModel(model: string): boolean {
  return /^(?:jev-(?:latest|preview|\d+\.\d+(?:\.\d+)?))$/u.test(model);
}

function resolveProviderPreference(value: unknown): ProviderConfig | undefined {
  if (!isRecord(value) || typeof value.provider !== "string" || typeof value.model !== "string") {
    return undefined;
  }

  if (value.provider === OPENROUTER_PROVIDER_ID) {
    const namespace = "typesafe/";
    if (!value.model.startsWith(namespace)) return undefined;
    const model = value.model.slice(namespace.length);
    if (!isSupportedTypeSafeModel(model)) return undefined;
    return { id: OPENROUTER_PROVIDER_ID, endpoint: OPENROUTER_GATEWAY_ENDPOINT, model };
  }

  if (value.provider === VERCEL_GATEWAY_PROVIDER_ID && value.model === VERCEL_GATEWAY_MODEL) {
    return {
      id: VERCEL_GATEWAY_PROVIDER_ID,
      endpoint: VERCEL_GATEWAY_ENDPOINT,
      model: VERCEL_GATEWAY_MODEL,
    };
  }

  return undefined;
}

function resolveProviderPreferences(settings: unknown): ProviderConfig[] | undefined {
  if (settings === undefined) return [...DEFAULT_PROVIDERS];
  if (!isRecord(settings)) return undefined;
  if (settings.jev === undefined) return [...DEFAULT_PROVIDERS];
  if (!isRecord(settings.jev)) return undefined;
  if (settings.jev.providers === undefined) return [...DEFAULT_PROVIDERS];

  const preferences = settings.jev.providers;
  if (!Array.isArray(preferences) || preferences.length < 1 || preferences.length > 2)
    return undefined;

  const providers: ProviderConfig[] = [];
  const seen = new Set<JevGatewayProviderId>();
  for (const preference of preferences) {
    const provider = resolveProviderPreference(preference);
    if (provider === undefined || seen.has(provider.id)) return undefined;
    seen.add(provider.id);
    providers.push(provider);
  }
  return providers;
}

function loadProviderPreferences(agentDirectory = getAgentDir()): ProviderConfig[] | undefined {
  try {
    return resolveProviderPreferences(readJsonConfig(join(agentDirectory, "settings.json")));
  } catch {
    return undefined;
  }
}

/** Reuse the routing policy while native classifiers own transport and authentication. */
export function loadJevClassifierPreferences(agentDirectory?: string) {
  return loadProviderPreferences(agentDirectory)?.map(({ id, model }) => ({
    provider: id,
    model: id === OPENROUTER_PROVIDER_ID ? `typesafe/${model}` : model,
  }));
}

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
  provider: JevGatewayProviderId,
  reason: JevGatewayFailureReason,
  stage: JevGatewayStage,
  httpStatus?: number,
  retryAfterMs?: number,
): JevGatewayFailure {
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
  provider: JevGatewayProviderId,
  stage: JevGatewayStage,
  deadline: DeadlineState,
): JevGatewayFailure | undefined {
  if (deadline.callerCancelled()) return failure(provider, "caller-cancellation", stage);
  if (deadline.timedOut() || deadline.attemptTimedOut() || deadline.signal.aborted)
    return failure(provider, "timeout", stage);
  return undefined;
}

async function requestProvider<TRequest extends object>(
  registry: JevGatewayRegistry,
  request: TRequest,
  provider: ProviderConfig,
  options: JevGatewayRequestOptions,
  deadline: DeadlineState,
  now: () => number,
): Promise<JevGatewayResult> {
  const initialFailure = stageFailure(provider.id, "auth", deadline);
  if (initialFailure !== undefined) return initialFailure;

  let authResult: AwaitStageResult<Awaited<ReturnType<JevGatewayRegistry["getProviderAuth"]>>>;
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
      parseRetryAfter(response.headers.get("retry-after"), now()),
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

export function createJevGatewayRequester(now: () => number = Date.now, agentDirectory?: string) {
  const cooldowns = new Map<
    JevGatewayProviderId,
    { readonly untilMs: number; readonly failure: JevGatewayFailure }
  >();

  return async function requestJevGateway<TRequest extends object>(
    registry: JevGatewayRegistry,
    request: TRequest,
    options: JevGatewayRequestOptions = {},
  ): Promise<JevGatewayResult> {
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
    ): Promise<JevGatewayResult> => {
      const attemptDeadline = createAttemptDeadline(deadline, attemptTimeoutMs);
      try {
        return await requestProvider(registry, request, provider, options, attemptDeadline, now);
      } finally {
        attemptDeadline.dispose();
      }
    };

    let currentProvider: JevGatewayProviderId | undefined;
    try {
      const providers = loadProviderPreferences(agentDirectory);
      if (providers === undefined) {
        return {
          ok: false,
          stage: "config",
          reason: callerCancelled ? "caller-cancellation" : timedOut ? "timeout" : "invalid-config",
        };
      }

      let firstFailure: JevGatewayFailure | undefined;
      let lastFailure: JevGatewayFailure | undefined;
      let attempted = false;
      for (const [index, provider] of providers.entries()) {
        const cooldown = cooldowns.get(provider.id);
        if (cooldown !== undefined && now() < cooldown.untilMs) {
          const unavailable = {
            ...cooldown.failure,
            retryAfterMs: Math.max(0, cooldown.untilMs - now()),
          };
          firstFailure ??= unavailable;
          lastFailure = unavailable;
          continue;
        }
        cooldowns.delete(provider.id);

        currentProvider = provider.id;
        const result = await runAttempt(
          provider,
          index === 0 && providers.length > 1 ? primaryTimeoutMs : undefined,
        );
        attempted = true;
        if (result.ok) return result;
        const retryAfterMs = result.retryAfterMs;
        if (result.httpStatus === 429 && retryAfterMs !== undefined && retryAfterMs > 0) {
          cooldowns.set(provider.id, { untilMs: now() + retryAfterMs, failure: result });
        }
        if (callerCancelled || timedOut || deadlineController.signal.aborted) return result;

        if (
          index > 0 &&
          result.stage === "auth" &&
          (result.reason === "missing-credentials" || result.reason === "auth-failure") &&
          firstFailure !== undefined &&
          !(
            firstFailure.stage === "auth" &&
            (firstFailure.reason === "missing-credentials" ||
              firstFailure.reason === "auth-failure")
          )
        ) {
          const cooldown =
            firstFailure.provider === undefined ? undefined : cooldowns.get(firstFailure.provider);
          return cooldown === undefined
            ? firstFailure
            : { ...firstFailure, retryAfterMs: Math.max(0, cooldown.untilMs - now()) };
        }

        firstFailure ??= result;
        lastFailure = result;
      }
      if (attempted && lastFailure !== undefined) return lastFailure;
      return firstFailure ?? { ok: false, stage: "config", reason: "invalid-config" };
    } catch {
      if (currentProvider === undefined) {
        return {
          ok: false,
          stage: "config",
          reason: callerCancelled ? "caller-cancellation" : timedOut ? "timeout" : "invalid-config",
        };
      }
      return (
        stageFailure(currentProvider, "request", deadline) ??
        failure(currentProvider, "request-failure", "request")
      );
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onCallerAbort);
    }
  };
}

export const requestJevGateway = createJevGatewayRequester();
