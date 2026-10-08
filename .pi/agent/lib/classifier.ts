import { join } from "node:path";
import type {
  ClassifierAnswer,
  ClassifierContext,
  ClassifierResult,
  JsonValue,
  Usage,
} from "@earendil-works/pi-ai";
import { getAgentDir, type ModelRegistry, SettingsManager } from "@earendil-works/pi-coding-agent";
import { isMatching, match, P } from "ts-pattern";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { readJsonConfig } from "./extension-config";

export const OPENROUTER_PROVIDER_ID = "openrouter" as const;
export const VERCEL_GATEWAY_PROVIDER_ID = "vercel-ai-gateway" as const;
export const CLASSIFIER_PROVIDER_IDS = [
  OPENROUTER_PROVIDER_ID,
  VERCEL_GATEWAY_PROVIDER_ID,
] as const;
export const DEFAULT_CLASSIFIER_TIMEOUT_MS = 2_400;
export const INTERACTIVE_CLASSIFIER_TIMEOUT_MS = 10_000;
export type ClassifierRegistry = Pick<ModelRegistry, "findOfType" | "classify">;
export type ClassifierFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type ClassifierProviderId = (typeof CLASSIFIER_PROVIDER_IDS)[number];
export type ClassifierFailure = {
  readonly ok: false;
  readonly provider?: ClassifierProviderId;
  readonly stage: "config" | "auth" | "request" | "body";
  readonly reason:
    | "invalid-config"
    | "disabled"
    | "invalid-input"
    | "model-unavailable"
    | "auth-failure"
    | "timeout"
    | "caller-cancellation"
    | "request-failure"
    | "http-status"
    | "invalid-response";
  readonly httpStatus?: number;
  readonly retryAfterMs?: number;
  readonly usage?: Usage;
};
export type ClassifierRequestResult =
  | {
      readonly ok: true;
      readonly value: { answers: Record<string, ClassifierAnswer> };
      readonly usage?: Usage;
    }
  | ClassifierFailure;
export interface ClassifierSettingsContext {
  readonly cwd: string;
  isProjectTrusted(): boolean;
}

export interface ClassifierOptions {
  fetch?: ClassifierFetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  onFetchAttempt?: () => void;
  settingsContext?: ClassifierSettingsContext;
}

const DEFAULT_PROVIDERS = [
  { provider: OPENROUTER_PROVIDER_ID, model: "typesafe/jev-1.13" },
  { provider: VERCEL_GATEWAY_PROVIDER_ID, model: "typesafe-ai/jev" },
] as const;
type Preference = { provider: ClassifierProviderId; model: string };
const RecordPattern = P.record(P.string, P.unknown);

function parseClassifierPreferences(settings: unknown): Preference[] | undefined {
  if (settings === undefined) return [...DEFAULT_PROVIDERS];
  if (!isMatching(RecordPattern, settings)) return undefined;
  if (settings.classifier === undefined) return [...DEFAULT_PROVIDERS];
  if (!isMatching(RecordPattern, settings.classifier)) return undefined;
  if (settings.classifier.providers === undefined) return [...DEFAULT_PROVIDERS];
  const entries = settings.classifier.providers;
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 2) return undefined;
  const preferences: Preference[] = [];
  for (const entry of entries) {
    if (!isMatching({ provider: P.union(...CLASSIFIER_PROVIDER_IDS), model: P.string }, entry))
      return undefined;
    if (preferences.some(({ provider }) => provider === entry.provider)) return undefined;
    if (entry.provider === OPENROUTER_PROVIDER_ID) {
      if (!/^~?typesafe\/jev-(?:latest|preview|\d+\.\d+(?:\.\d+)?)$/u.test(entry.model))
        return undefined;
    } else if (entry.model !== "typesafe-ai/jev") return undefined;
    preferences.push({ provider: entry.provider, model: entry.model });
  }
  return preferences;
}

export function loadClassifierPreferences(
  agentDirectory = getAgentDir(),
): Preference[] | undefined {
  try {
    return parseClassifierPreferences(readJsonConfig(join(agentDirectory, "settings.json")));
  } catch {
    return undefined;
  }
}

function readClassifierEnabled(settings: unknown): boolean | undefined {
  if (settings === undefined) return true;
  if (!isMatching(RecordPattern, settings)) return undefined;
  if (!Object.hasOwn(settings, "classifier")) return true;
  if (!isMatching(RecordPattern, settings.classifier)) return undefined;
  if (!Object.hasOwn(settings.classifier, "enabled")) return true;
  return typeof settings.classifier.enabled === "boolean" ? settings.classifier.enabled : undefined;
}

export function resolveClassifierEnabled(
  globalSettings: unknown,
  projectSettings: unknown,
): boolean | undefined {
  const globalEnabled = readClassifierEnabled(globalSettings);
  if (globalEnabled === undefined || globalEnabled === false) return globalEnabled;
  return readClassifierEnabled(projectSettings);
}

type LoadedClassifierSettings = {
  readonly enabled: boolean;
  readonly globalSettings: unknown;
};

function loadClassifierSettings(
  context: ClassifierSettingsContext | undefined,
  agentDirectory: string | undefined,
): LoadedClassifierSettings | undefined {
  try {
    const settings = SettingsManager.create(
      context?.cwd ?? process.cwd(),
      agentDirectory ?? getAgentDir(),
      {
        projectTrusted: context?.isProjectTrusted() ?? false,
      },
    );
    const globalSettings = settings.getGlobalSettings();
    const projectSettings = settings.getProjectSettings();
    if (settings.drainErrors().length > 0) return undefined;
    const enabled = resolveClassifierEnabled(globalSettings, projectSettings);
    if (enabled && !parseClassifierPreferences(globalSettings)) return undefined;
    return enabled === undefined ? undefined : { enabled, globalSettings };
  } catch {
    return undefined;
  }
}

const registryContexts = new WeakMap<ClassifierRegistry, ClassifierSettingsContext>();

export function installClassifierGate(
  registry: ClassifierRegistry,
  context: ClassifierSettingsContext,
  agentDirectory = getAgentDir(),
): () => void {
  registryContexts.set(registry, context);
  const original = registry.classify;
  // Gate the native boundary too: codemode can call classify without the shared requester.
  const guarded: ClassifierRegistry["classify"] = async (model, input, options) => {
    const settings = loadClassifierSettings(registryContexts.get(registry), agentDirectory);
    if (!settings?.enabled) {
      return {
        api: model.api,
        provider: model.provider,
        model: model.id,
        answers: {},
        stopReason: "error",
        errorMessage: settings ? "Classifier disabled by settings" : "Invalid classifier settings",
        timestamp: Date.now(),
      };
    }
    return original.call(registry, model, input, options);
  };
  registry.classify = guarded;
  return () => {
    if (registry.classify === guarded) registry.classify = original;
    registryContexts.delete(registry);
  };
}

const ClassifierInput = Type.Object(
  {
    state: Type.Record(Type.String(), Type.Unknown()),
    questions: Type.Record(
      Type.String(),
      Type.Union([
        Type.Object(
          {
            type: Type.Literal("bool"),
            instructions: Type.String(),
            criteria: Type.Object(
              { true: Type.String(), false: Type.String() },
              { additionalProperties: false },
            ),
          },
          { additionalProperties: false },
        ),
        Type.Object(
          {
            type: Type.Literal("choice"),
            instructions: Type.String(),
            criteria: Type.Record(Type.String(), Type.String(), {
              minProperties: 2,
              maxProperties: 255,
            }),
          },
          { additionalProperties: false },
        ),
        Type.Object(
          {
            type: Type.Literal("score"),
            instructions: Type.String(),
            criteria: Type.Array(Type.String(), { minItems: 2, maxItems: 10 }),
          },
          { additionalProperties: false },
        ),
      ]),
      { minProperties: 1 },
    ),
  },
  { additionalProperties: false },
);

export function assertClassifierJson(
  value: unknown,
  ancestors = new Set<object>(),
): asserts value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || value === null || ancestors.has(value))
    throw new Error("Invalid Classifier JSON");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (const child of value) assertClassifierJson(child, ancestors);
    } else if (
      Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null
    ) {
      for (const child of Object.values(value)) assertClassifierJson(child, ancestors);
    } else throw new Error("Invalid Classifier JSON");
  } finally {
    ancestors.delete(value);
  }
}

const Probability = P.number.finite().between(0, 1);
const Answer = P.union(
  { type: "bool", probability: Probability },
  {
    type: "choice",
    choice: P.string,
    probabilities: P.record(P.string, Probability),
    confidence: Probability,
  },
  { type: "score", score: P.number.finite(), confidence: Probability },
);
export function normalizeClassifierAnswers(
  value: unknown,
  input: ClassifierContext,
): Record<string, ClassifierAnswer> {
  if (
    !isMatching({ answers: RecordPattern }, value) ||
    Object.keys(value.answers).length !== Object.keys(input.questions).length
  )
    throw new Error("Invalid Classifier answer set");
  const answers: Record<string, ClassifierAnswer> = Object.create(null);
  for (const [id, question] of Object.entries(input.questions)) {
    const answer = value.answers[id];
    if (
      !Object.hasOwn(value.answers, id) ||
      !isMatching(Answer, answer) ||
      answer.type !== question.type
    )
      throw new Error(`Invalid Classifier answer for ${id}`);
    answers[id] = match(answer)
      .returnType<ClassifierAnswer>()
      .with({ type: "bool" }, ({ probability }) => ({ type: "bool", probability }))
      .with({ type: "choice" }, ({ choice, probabilities, confidence }) => {
        const keys = Object.keys(question.criteria);
        const total = Object.values(probabilities).reduce(
          (sum, probability) => sum + probability,
          0,
        );
        if (
          !keys.includes(choice) ||
          Object.keys(probabilities).length !== keys.length ||
          keys.some((key) => !Object.hasOwn(probabilities, key)) ||
          Math.abs(total - 1) > 0.02 ||
          keys.some((key) => (probabilities[key] ?? 0) > (probabilities[choice] ?? 0))
        )
          throw new Error(`Invalid Classifier choice for ${id}`);
        return { type: "choice", choice, probabilities, confidence };
      })
      .with({ type: "score" }, ({ score, confidence }) => {
        if (question.type !== "score" || score < 0 || score > question.criteria.length - 1)
          throw new Error(`Invalid Classifier score for ${id}`);
        return { type: "score", score, confidence };
      })
      .exhaustive();
  }
  if (Buffer.byteLength(JSON.stringify(answers), "utf8") > 256_000)
    throw new Error("Oversized Classifier answers");
  return answers;
}

export function addClassifierUsage(
  total: Usage | undefined,
  next: Usage | undefined,
): Usage | undefined {
  if (!total) return next;
  if (!next) return total;
  return {
    input: total.input + next.input,
    output: total.output + next.output,
    cacheRead: total.cacheRead + next.cacheRead,
    cacheWrite: total.cacheWrite + next.cacheWrite,
    totalTokens: total.totalTokens + next.totalTokens,
    ...(total.cacheWrite1h === undefined && next.cacheWrite1h === undefined
      ? {}
      : { cacheWrite1h: (total.cacheWrite1h ?? 0) + (next.cacheWrite1h ?? 0) }),
    ...(total.reasoning === undefined && next.reasoning === undefined
      ? {}
      : { reasoning: (total.reasoning ?? 0) + (next.reasoning ?? 0) }),
    cost: {
      input: total.cost.input + next.cost.input,
      output: total.cost.output + next.cost.output,
      cacheRead: total.cost.cacheRead + next.cost.cacheRead,
      cacheWrite: total.cost.cacheWrite + next.cost.cacheWrite,
      total: total.cost.total + next.cost.total,
    },
  };
}

export function parseRetryAfter(value: string | null, nowMs = Date.now()): number | undefined {
  if (value === null) return undefined;
  const normalized = value.trim();
  if (/^\d+$/u.test(normalized))
    return Math.min(Number.MAX_SAFE_INTEGER, Number(normalized) * 1_000);
  if (/^[+-]?\d/u.test(normalized)) return undefined;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - nowMs) : undefined;
}

async function withinDeadline<T>(
  run: () => Promise<T>,
  signal: AbortSignal,
): Promise<T | undefined> {
  if (signal.aborted) return undefined;
  return new Promise((resolve) => {
    const finish = (value: T | undefined) => {
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => finish(undefined);
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve()
      .then(() => (signal.aborted ? undefined : run()))
      .then(finish, () => finish(undefined));
  });
}

export function createClassifierRequester(now: () => number = Date.now, agentDirectory?: string) {
  const cooldowns = new Map<ClassifierProviderId, { until: number; failure: ClassifierFailure }>();
  return async function requestClassifier(
    registry: ClassifierRegistry,
    input: ClassifierContext,
    options: ClassifierOptions = {},
  ): Promise<ClassifierRequestResult> {
    let usage: Usage | undefined;
    const fail = (
      reason: ClassifierFailure["reason"],
      stage: ClassifierFailure["stage"],
      provider?: ClassifierProviderId,
      httpStatus?: number,
      retryAfterMs?: number,
    ): ClassifierFailure => ({
      ok: false,
      reason,
      stage,
      ...(provider ? { provider } : {}),
      ...(httpStatus === undefined ? {} : { httpStatus }),
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      ...(usage ? { usage } : {}),
    });
    if (options.signal?.aborted) return fail("caller-cancellation", "request");
    const settings = loadClassifierSettings(
      options.settingsContext ?? registryContexts.get(registry),
      agentDirectory,
    );
    if (!settings) return fail("invalid-config", "config");
    if (!settings.enabled) return fail("disabled", "config");
    const preferences = parseClassifierPreferences(settings.globalSettings);
    if (!preferences) return fail("invalid-config", "config");
    try {
      assertClassifierJson(input);
      if (
        !Value.Check(ClassifierInput, input) ||
        Buffer.byteLength(JSON.stringify(input), "utf8") > 64_000
      )
        return fail("invalid-input", "config");
    } catch {
      return fail("invalid-input", "config");
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_CLASSIFIER_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return fail("invalid-config", "config");
    const overall = new AbortController();
    const timer = setTimeout(() => overall.abort(), Math.max(1, Math.floor(timeoutMs)));
    const onAbort = () => overall.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    let lastFailure: ClassifierFailure | undefined;
    let usefulFailure: ClassifierFailure | undefined;
    try {
      for (const [index, preference] of preferences.entries()) {
        if (overall.signal.aborted)
          return fail(
            options.signal?.aborted ? "caller-cancellation" : "timeout",
            "request",
            preference.provider,
          );
        const cooldown = cooldowns.get(preference.provider);
        if (cooldown && now() < cooldown.until) {
          lastFailure = { ...cooldown.failure, retryAfterMs: cooldown.until - now() };
          usefulFailure ??= lastFailure;
          continue;
        }
        cooldowns.delete(preference.provider);
        // Existing saved settings used the unprefixed latest alias; the native catalog prefixes it.
        const id =
          preference.model === "typesafe/jev-latest" ? "~typesafe/jev-latest" : preference.model;
        const model = registry.findOfType("classifier", preference.provider, id);
        if (!model) {
          lastFailure = fail("model-unavailable", "config", preference.provider);
          continue;
        }
        const attempt = new AbortController();
        const onOverallAbort = () => attempt.abort();
        overall.signal.addEventListener("abort", onOverallAbort, { once: true });
        const attemptTimer =
          index === 0 && preferences.length > 1
            ? setTimeout(() => attempt.abort(), Math.max(1, Math.floor(timeoutMs / 2)))
            : undefined;
        let attemptedFetch = false;
        let httpStatus: number | undefined;
        let retryAfterMs: number | undefined;
        const transport = options.fetch ?? globalThis.fetch;
        // Observe only bounded status metadata; Pi owns request payloads, credentials, and parsing.
        const fetch = Object.assign(
          async (url: RequestInfo | URL, init?: RequestInit) => {
            attempt.signal.throwIfAborted();
            options.onFetchAttempt?.();
            attemptedFetch = true;
            const response = await transport(url, init);
            httpStatus = response.status;
            retryAfterMs = parseRetryAfter(response.headers.get("retry-after"), now());
            return response;
          },
          { preconnect: globalThis.fetch.preconnect },
        );
        let result: ClassifierResult | undefined;
        try {
          // Our shared cooldown and fallback policy owns retries; avoid retrying the same primary first.
          result = await withinDeadline(
            () => registry.classify(model, input, { signal: attempt.signal, maxRetries: 0, fetch }),
            attempt.signal,
          );
        } finally {
          if (attemptTimer !== undefined) clearTimeout(attemptTimer);
          overall.signal.removeEventListener("abort", onOverallAbort);
        }
        usage = addClassifierUsage(usage, result?.usage);
        if (attempt.signal.aborted)
          lastFailure = fail(
            options.signal?.aborted ? "caller-cancellation" : "timeout",
            httpStatus === undefined ? (attemptedFetch ? "request" : "auth") : "body",
            preference.provider,
            httpStatus,
            retryAfterMs,
          );
        else if (httpStatus !== undefined && httpStatus >= 400)
          lastFailure = fail(
            "http-status",
            "request",
            preference.provider,
            httpStatus,
            retryAfterMs,
          );
        else if (result?.stopReason !== "stop")
          lastFailure = fail(
            attemptedFetch ? "request-failure" : "auth-failure",
            attemptedFetch ? "request" : "auth",
            preference.provider,
          );
        else {
          try {
            return {
              ok: true,
              value: { answers: normalizeClassifierAnswers(result, input) },
              ...(usage ? { usage } : {}),
            };
          } catch {
            lastFailure = fail("invalid-response", "body", preference.provider);
          }
        }
        if (
          lastFailure.httpStatus === 429 &&
          lastFailure.retryAfterMs &&
          lastFailure.retryAfterMs > 0
        )
          cooldowns.set(preference.provider, {
            until: Math.min(Number.MAX_SAFE_INTEGER, now() + lastFailure.retryAfterMs),
            failure: {
              ok: false,
              stage: lastFailure.stage,
              reason: lastFailure.reason,
              provider: preference.provider,
              httpStatus: 429,
              retryAfterMs: lastFailure.retryAfterMs,
            },
          });
        if (overall.signal.aborted || options.signal?.aborted) return lastFailure;
        if (lastFailure.stage !== "auth") usefulFailure ??= lastFailure;
      }
      const failure = lastFailure?.stage === "auth" ? (usefulFailure ?? lastFailure) : lastFailure;
      return failure
        ? { ...failure, ...(usage ? { usage } : {}) }
        : fail("model-unavailable", "config");
    } catch {
      return fail(
        options.signal?.aborted
          ? "caller-cancellation"
          : overall.signal.aborted
            ? "timeout"
            : "request-failure",
        "request",
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  };
}

export const requestClassifier = createClassifierRequester();
