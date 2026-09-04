import type {
  AuthOperationOptions,
  AuthResult,
  Credential,
  CredentialInfo,
  CredentialStore,
} from "@earendil-works/pi-ai";
import { getAgentDir, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { authPathFor, normalizeName } from "../profile-store";
import type {
  ProfileCredentialReadResult,
  ProfileProviderAdapter,
  ProfileProviderCredential,
  ProviderCreditSnapshot,
  ProviderFetch,
  ProviderUsageSnapshot,
  UsageUrgency,
} from "../provider-adapter";

const PROVIDER_ID = "openai-codex";
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const RESET_CREDITS_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const REQUEST_TIMEOUT_MS = 10_000;
const REFRESH_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const UNKNOWN_USAGE_COOLDOWN_MS = 60_000;
// shortcut: AuthStorage is not publicly exported, so use Pi's pinned implementation
// until coding-agent exposes a supported file-backed CredentialStore constructor.
const AUTH_STORAGE_MODULE_URL = new URL(
  "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js",
  import.meta.url,
).href;

type AuthRuntime = {
  getAuth(
    providerId: string,
    options?: AuthOperationOptions & { minOAuthValidityMs?: number },
  ): Promise<AuthResult | undefined>;
};

export type OpenAiCodexAdapterDependencies = {
  createCredentialStore?: (path: string) => Promise<CredentialStore>;
  createRuntime?: (credentials: CredentialStore) => Promise<AuthRuntime>;
  now?: () => number;
};

type AuthStorageModule = {
  AuthStorage: { create(path?: string): CredentialStore };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonnegativeInteger(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && Number.isInteger(number) && number >= 0 ? number : undefined;
}

function parseCredential(value: unknown): ProfileCredentialReadResult {
  if (value === undefined) return { kind: "missing" };
  if (!isRecord(value)) return { kind: "invalid-provider-credential" };

  const accessToken = value.access;
  const identity = value.accountId;
  const expiresAt = finiteNumber(value.expires);
  const refreshToken = value.refresh;
  if (
    value.type !== "oauth" ||
    typeof accessToken !== "string" ||
    accessToken.length === 0 ||
    accessToken.length > 64 * 1024 ||
    typeof refreshToken !== "string" ||
    refreshToken.length === 0 ||
    refreshToken.length > 64 * 1024 ||
    typeof identity !== "string" ||
    /^[A-Za-z0-9._-]{1,200}$/.test(identity) === false ||
    expiresAt === undefined
  ) {
    return { kind: "invalid-provider-credential" };
  }

  return { kind: "valid", credential: { accessToken, identity, expiresAt } };
}

function assertExpectedIdentity(
  credential: Credential | undefined,
  expectedIdentity: string,
): void {
  const identity =
    credential?.type === "oauth" && typeof credential.accountId === "string"
      ? credential.accountId
      : undefined;
  if (identity !== expectedIdentity) {
    throw new Error("OpenAI Codex credential changed accounts during refresh.");
  }
}

export function guardOpenAiCodexCredential(
  store: CredentialStore,
  initialIdentity: string | undefined,
  allowIdentityResetAfterDelete = false,
): CredentialStore {
  let protectedIdentity = initialIdentity;
  let mutationTail: Promise<void> = Promise.resolve();

  const serializeMutation = <T>(mutation: () => Promise<T>): Promise<T> => {
    const result = mutationTail.then(mutation);
    mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const identityFor = (credential: Credential | undefined): string | undefined => {
    if (credential === undefined && protectedIdentity === undefined) return undefined;
    if (protectedIdentity === undefined) {
      const identity =
        credential?.type === "oauth" && typeof credential.accountId === "string"
          ? credential.accountId
          : undefined;
      if (identity === undefined) {
        throw new Error("OpenAI Codex credential has no account identity.");
      }
      return identity;
    }
    assertExpectedIdentity(credential, protectedIdentity);
    return protectedIdentity;
  };

  return {
    async read(providerId, options) {
      const credential = await store.read(providerId, options);
      if (providerId === PROVIDER_ID) {
        protectedIdentity = identityFor(credential) ?? protectedIdentity;
      }
      return credential;
    },
    list(options): Promise<readonly CredentialInfo[]> {
      return store.list(options);
    },
    modify(providerId, modify, options) {
      if (providerId !== PROVIDER_ID) return store.modify(providerId, modify, options);
      return serializeMutation(async () => {
        let observedIdentity: string | undefined;
        const result = await store.modify(
          providerId,
          async (current) => {
            const expectedIdentity = identityFor(current);
            const next = await modify(current);
            if (next === undefined) return undefined;
            const nextIdentity =
              next.type === "oauth" && typeof next.accountId === "string"
                ? next.accountId
                : undefined;
            if (
              nextIdentity === undefined ||
              (expectedIdentity && nextIdentity !== expectedIdentity)
            ) {
              throw new Error("OpenAI Codex credential changed accounts during refresh.");
            }
            observedIdentity = nextIdentity;
            return next;
          },
          options,
        );
        protectedIdentity = observedIdentity ?? protectedIdentity;
        return result;
      });
    },
    delete(providerId, options): Promise<void> {
      if (providerId !== PROVIDER_ID) return store.delete(providerId, options);
      return serializeMutation(async () => {
        if (allowIdentityResetAfterDelete === false) {
          throw new Error("OpenAI Codex credential cannot be deleted during refresh.");
        }
        await store.delete(providerId, options);
        protectedIdentity = undefined;
      });
    },
  };
}

async function createCredentialStore(path: string): Promise<CredentialStore> {
  const module = (await import(AUTH_STORAGE_MODULE_URL)) as AuthStorageModule;
  return module.AuthStorage.create(path);
}

async function createRuntime(credentials: CredentialStore): Promise<AuthRuntime> {
  return ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false });
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error("response is too large");
  }
  if (!response.body) return undefined;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("response is too large");
    }
    parts.push(decoder.decode(value, { stream: true }));
  }
  parts.push(decoder.decode());
  return JSON.parse(parts.join(""));
}

async function fetchPayload(
  url: string,
  credential: ProfileProviderCredential,
  fetchFn: ProviderFetch,
): Promise<unknown> {
  const response = await fetchFn(url, {
    headers: {
      Authorization: `Bearer ${credential.accessToken}`,
      "ChatGPT-Account-Id": credential.identity,
    },
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`request failed with ${response.status}`);
  return readBoundedJson(response);
}

function formatReset(seconds: number | undefined): string | undefined {
  if (seconds === undefined) return undefined;
  if (seconds <= 0) return "now";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.ceil(seconds / 3600)}h`;
  return `${Math.ceil(seconds / 86_400)}d`;
}

function usageWindow(value: unknown) {
  if (!isRecord(value)) return undefined;
  const usedPercent = finiteNumber(value.used_percent);
  if (usedPercent === undefined || usedPercent < 0 || usedPercent > 100) return undefined;
  const resetAfterSeconds = finiteNumber(value.reset_after_seconds);
  const validResetSeconds =
    resetAfterSeconds !== undefined && resetAfterSeconds >= 0 && resetAfterSeconds <= 31_536_000
      ? resetAfterSeconds
      : undefined;
  const remaining = Math.max(0, Math.min(100, 100 - Math.floor(usedPercent)));
  const resetsIn = formatReset(validResetSeconds);
  return resetsIn ? { remaining, resetsIn } : { remaining };
}

export function openAiCodexUsageFromPayload(payload: unknown): ProviderUsageSnapshot {
  if (!isRecord(payload) || !isRecord(payload.rate_limit)) {
    throw new Error("usage response has an unexpected shape");
  }
  const primaryWindow = usageWindow(payload.rate_limit.primary_window);
  if (primaryWindow === undefined) {
    throw new Error("usage response has an unexpected primary window");
  }
  const secondaryValue = payload.rate_limit.secondary_window;
  const secondaryWindow =
    secondaryValue === undefined || secondaryValue === null
      ? undefined
      : usageWindow(secondaryValue);
  if (secondaryValue !== undefined && secondaryValue !== null && secondaryWindow === undefined) {
    throw new Error("usage response has an unexpected secondary window");
  }
  const windows =
    secondaryWindow === undefined ? [primaryWindow] : [primaryWindow, secondaryWindow];
  const availableCreditCount = isRecord(payload.rate_limit_reset_credits)
    ? nonnegativeInteger(payload.rate_limit_reset_credits.available_count)
    : undefined;
  return {
    windows,
    ...(availableCreditCount === undefined ? {} : { availableCreditCount }),
  };
}

function urgencyFromExpiry(expiresAt: unknown, now: number): UsageUrgency {
  if (typeof expiresAt !== "string") return "unknown";
  const timestamp = Date.parse(expiresAt);
  if (!Number.isFinite(timestamp)) return "unknown";
  const remaining = timestamp - now;
  if (remaining < 12 * 60 * 60 * 1_000) return "urgent";
  if (remaining <= 7 * 86_400_000) return "soon";
  return "later";
}

export function openAiCodexCreditsFromPayload(
  payload: unknown,
  now = Date.now(),
): ProviderCreditSnapshot {
  if (!isRecord(payload)) throw new Error("reset credits response has an unexpected shape");
  const availableCount = nonnegativeInteger(payload.available_count);
  if (availableCount === undefined) {
    throw new Error("reset credits response has an unexpected shape");
  }
  const credits = Array.isArray(payload.credits) ? payload.credits : [];
  const expiries = credits
    .filter((credit) => isRecord(credit) && credit.status === "available")
    .flatMap((credit) => {
      const expiresAt = isRecord(credit) ? credit.expires_at : undefined;
      if (typeof expiresAt !== "string") return [];
      const timestamp = Date.parse(expiresAt);
      return Number.isFinite(timestamp) ? [{ expiresAt, timestamp }] : [];
    })
    .sort((left, right) => left.timestamp - right.timestamp);
  const nextExpiresAt = availableCount > 0 ? (expiries[0]?.expiresAt ?? null) : null;
  return {
    availableCount,
    nextExpiresAt,
    urgency: urgencyFromExpiry(nextExpiresAt, now),
  };
}

function finiteHeaderNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resetAtForWindow(
  headers: Record<string, string>,
  window: "primary" | "secondary",
  currentTime: number,
): number | undefined {
  const entries = Object.entries(headers).map(
    ([name, value]) => [name.toLowerCase(), value] as const,
  );
  const normalizedHeaders = Object.fromEntries(entries);
  const usedPercent = finiteHeaderNumber(normalizedHeaders[`x-codex-${window}-used-percent`]);
  if (usedPercent === undefined || usedPercent < 100) return undefined;

  const resetAtSeconds = finiteHeaderNumber(normalizedHeaders[`x-codex-${window}-reset-at`]);
  if (resetAtSeconds !== undefined) {
    const resetAt = resetAtSeconds * 1000;
    if (Number.isFinite(resetAt) && resetAt > currentTime) return resetAt;
  }
  const resetAfterSeconds = finiteHeaderNumber(
    normalizedHeaders[`x-codex-${window}-reset-after-seconds`],
  );
  if (resetAfterSeconds !== undefined && resetAfterSeconds >= 0) {
    const resetAt = currentTime + resetAfterSeconds * 1000;
    if (Number.isFinite(resetAt) && resetAt > currentTime) return resetAt;
  }
  return currentTime + UNKNOWN_USAGE_COOLDOWN_MS;
}

export function openAiCodexUsageLimitResetAt(
  headers: Record<string, string>,
  currentTime = Date.now(),
): number | undefined {
  const resetTimes = [
    resetAtForWindow(headers, "primary", currentTime),
    resetAtForWindow(headers, "secondary", currentTime),
  ].filter((value): value is number => value !== undefined);
  return resetTimes.length > 0 ? Math.max(...resetTimes) : undefined;
}

export function openAiCodexUsageLimitResetAtFromMessage(
  errorMessage: string | undefined,
  currentTime = Date.now(),
): number | undefined {
  return errorMessage?.startsWith("You have hit your ChatGPT usage limit")
    ? currentTime + UNKNOWN_USAGE_COOLDOWN_MS
    : undefined;
}

export function createOpenAiCodexProfileAdapter(
  agentDir = getAgentDir(),
  dependencies: OpenAiCodexAdapterDependencies = {},
): ProfileProviderAdapter {
  const loadStore = dependencies.createCredentialStore ?? createCredentialStore;
  const loadRuntime = dependencies.createRuntime ?? createRuntime;
  const now = dependencies.now ?? Date.now;
  const pathFor = (profileLabel: string) => authPathFor(normalizeName(profileLabel), agentDir);

  const resolveStoredCredential = async (
    profileLabel: string,
    expectedIdentity?: string,
  ): Promise<ProfileProviderCredential> => {
    const profile = normalizeName(profileLabel);
    const unguardedStore = await loadStore(pathFor(profile));
    const initial = parseCredential(
      await unguardedStore.read(PROVIDER_ID, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }),
    );
    if (initial.kind !== "valid") {
      throw new Error(`Profile ${profile} has no usable OpenAI Codex OAuth credential.`);
    }
    if (expectedIdentity !== undefined && initial.credential.identity !== expectedIdentity) {
      throw new Error("OpenAI Codex credential changed accounts during refresh.");
    }

    const identity = expectedIdentity ?? initial.credential.identity;
    const store = guardOpenAiCodexCredential(unguardedStore, identity);
    const runtime = await loadRuntime(store);
    const auth = await runtime.getAuth(PROVIDER_ID, {
      minOAuthValidityMs: 1,
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });
    if (auth === undefined) {
      throw new Error(`Profile ${profile} has no usable OpenAI Codex OAuth credential.`);
    }
    const result = parseCredential(
      await store.read(PROVIDER_ID, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
    );
    if (result.kind !== "valid" || result.credential.identity !== identity) {
      throw new Error("OpenAI Codex credential changed accounts during refresh.");
    }
    if (result.credential.expiresAt <= now()) {
      throw new Error(`Profile ${profile} OpenAI Codex credential remained expired after refresh.`);
    }
    return result.credential;
  };

  return {
    providerId: PROVIDER_ID,
    async createCredentialStore(profileLabel) {
      const profile = normalizeName(profileLabel);
      const store = await loadStore(pathFor(profile));
      const result = parseCredential(
        await store.read(PROVIDER_ID, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
      );
      if (result.kind === "missing") {
        return guardOpenAiCodexCredential(store, undefined, true);
      }
      if (result.kind !== "valid") {
        throw new Error(`Profile ${profile} has an invalid OpenAI Codex credential.`);
      }
      return guardOpenAiCodexCredential(store, result.credential.identity, true);
    },
    async readCredential(profileLabel) {
      try {
        const store = await loadStore(pathFor(profileLabel));
        return parseCredential(
          await store.read(PROVIDER_ID, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
        );
      } catch {
        return { kind: "invalid-auth-file" };
      }
    },
    resolveCredential(profileLabel) {
      return resolveStoredCredential(profileLabel);
    },
    refreshCredential({ expectedIdentity, profileLabel }) {
      return resolveStoredCredential(profileLabel, expectedIdentity);
    },
    fetchUsage(credential, fetchFn) {
      return fetchPayload(USAGE_URL, credential, fetchFn).then(openAiCodexUsageFromPayload);
    },
    fetchCredits(credential, fetchFn, currentTime) {
      return fetchPayload(RESET_CREDITS_URL, credential, fetchFn).then((payload) =>
        openAiCodexCreditsFromPayload(payload, currentTime),
      );
    },
    usageLimitResetAt: openAiCodexUsageLimitResetAt,
    usageLimitResetAtFromMessage: openAiCodexUsageLimitResetAtFromMessage,
  };
}
