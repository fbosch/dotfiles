import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { authPathFor, DEFAULT_PROFILE, listProfiles, normalizeName } from "./profile-store";

const OUTPUT_SCHEMA = "fbb.pi-auth-profiles-usage/v1";
const CACHE_SCHEMA = "fbb.pi-auth-profiles-usage-cache/v1";
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const RESET_CREDITS_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const USAGE_CACHE_MS = 10_000;
const RESET_CREDITS_CACHE_MS = 8 * 60 * 60 * 1_000;
const MAX_CONCURRENT_REQUESTS = 4;

export type FetchFn = (input: string | URL, init?: RequestInit) => Promise<Response>;
type Urgency = "urgent" | "soon" | "later" | "unknown";
type DiagnosticCode =
  | "credential-expired"
  | "invalid-auth-file"
  | "invalid-codex-credential"
  | "invalid-profile-name"
  | "reset-credits-request-failed"
  | "usage-request-failed";

type CodexCredential = {
  access: string;
  accountId: string;
  expires: number;
};

export type UsageWindowStatus = {
  remaining: number;
  resetsIn?: string;
};

export type ProfileUsageStatus = {
  profileLabel: string;
  active: boolean;
  availableCount?: number;
  urgency: Urgency;
  usage: UsageWindowStatus[];
};

export type UsageStatusPayload = {
  schema: typeof OUTPUT_SCHEMA;
  profiles: ProfileUsageStatus[];
  diagnostics: Array<{ profileLabel: string; code: DiagnosticCode }>;
};

type UsageSnapshot = {
  windows: UsageWindowStatus[];
  availableCount?: number;
};

type ResetCreditsSnapshot = {
  availableCount: number;
  urgency: Urgency;
};

export type CachedResetCreditStatus = ResetCreditsSnapshot & {
  checkedAt: number;
};

type CachedAccount = {
  credentialKey: string;
  usage?: UsageSnapshot;
  usageCheckedAt?: number;
  resetCredits?: ResetCreditsSnapshot;
  resetCreditsCheckedAt?: number;
};

type UsageCache = {
  schema: typeof CACHE_SCHEMA;
  accounts: Record<string, CachedAccount>;
};

type ProfileCredential = {
  profileLabel: string;
  credentialKey: string;
  credential: CodexCredential;
};

type AccountResult = {
  cached: CachedAccount;
  profile: Omit<ProfileUsageStatus, "profileLabel" | "active">;
  errors: DiagnosticCode[];
};

export type CollectUsageStatusOptions = {
  activeProfile?: string;
  agentDir?: string;
  cachePath?: string;
  fetchFn?: FetchFn;
  forceUsageRefresh?: boolean;
  includeDefault?: boolean;
  includeResetCredits?: boolean;
  now?: () => number;
  profileLabels?: readonly string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonnegativeInteger(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && Number.isInteger(number) && number >= 0 ? number : undefined;
}

function readJsonObject(path: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function readCodexCredential(
  path: string,
):
  | { kind: "missing" }
  | { kind: "invalid-auth-file" }
  | { kind: "invalid-codex-credential" }
  | { kind: "valid"; credential: CodexCredential } {
  if (!existsSync(path)) return { kind: "missing" };

  const auth = readJsonObject(path);
  if (!auth) return { kind: "invalid-auth-file" };
  const value = auth["openai-codex"];
  if (value === undefined) return { kind: "missing" };
  if (!isRecord(value)) return { kind: "invalid-codex-credential" };

  const access = value.access;
  const accountId = value.accountId;
  const expires = finiteNumber(value.expires);
  if (
    value.type !== "oauth" ||
    typeof access !== "string" ||
    access.length === 0 ||
    access.length > 64 * 1024 ||
    typeof accountId !== "string" ||
    !/^[A-Za-z0-9._-]{1,200}$/.test(accountId) ||
    expires === undefined
  ) {
    return { kind: "invalid-codex-credential" };
  }

  return { kind: "valid", credential: { access, accountId, expires } };
}

function accountCredentialKey(accountId: string): string {
  return createHash("sha256").update(accountId).digest("hex");
}

function formatReset(seconds: number | undefined): string | undefined {
  if (seconds === undefined) return undefined;
  if (seconds <= 0) return "now";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.ceil(seconds / 3600)}h`;
  return `${Math.ceil(seconds / 86_400)}d`;
}

function parseUsageWindow(value: unknown): UsageWindowStatus | undefined {
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

export function usageFromPayload(payload: unknown): UsageSnapshot {
  if (!isRecord(payload) || !isRecord(payload.rate_limit)) {
    throw new Error("usage response has an unexpected shape");
  }

  const windows = [
    parseUsageWindow(payload.rate_limit.primary_window),
    parseUsageWindow(payload.rate_limit.secondary_window),
  ].filter((window): window is UsageWindowStatus => window !== undefined);
  const resetCredits = isRecord(payload.rate_limit_reset_credits)
    ? nonnegativeInteger(payload.rate_limit_reset_credits.available_count)
    : undefined;
  return {
    windows,
    ...(resetCredits !== undefined ? { availableCount: resetCredits } : {}),
  };
}

function urgencyFromExpiry(expiresAt: unknown, now: number): Urgency {
  if (typeof expiresAt !== "string") return "unknown";
  const timestamp = Date.parse(expiresAt);
  if (!Number.isFinite(timestamp)) return "unknown";
  const remaining = timestamp - now;
  if (remaining < 12 * 60 * 60 * 1_000) return "urgent";
  if (remaining <= 7 * 86_400_000) return "soon";
  return "later";
}

export function resetCreditsFromPayload(payload: unknown, now = Date.now()): ResetCreditsSnapshot {
  if (!isRecord(payload)) throw new Error("reset credits response has an unexpected shape");
  const availableCount = nonnegativeInteger(payload.available_count);
  if (availableCount === undefined) {
    throw new Error("reset credits response has an unexpected shape");
  }

  const credits = Array.isArray(payload.credits) ? payload.credits : [];
  const expiries = credits
    .filter((credit) => isRecord(credit) && credit.status === "available")
    .map((credit) => (isRecord(credit) ? credit.expires_at : undefined))
    .filter((expiresAt): expiresAt is string => typeof expiresAt === "string")
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  return {
    availableCount,
    urgency: availableCount > 0 ? urgencyFromExpiry(expiries[0], now) : "unknown",
  };
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
  credential: CodexCredential,
  fetchFn: FetchFn,
): Promise<unknown> {
  const response = await fetchFn(url, {
    headers: {
      Authorization: `Bearer ${credential.access}`,
      "ChatGPT-Account-Id": credential.accountId,
    },
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`request failed with ${response.status}`);
  return readBoundedJson(response);
}

function parseUsageWindowStatus(value: unknown): UsageWindowStatus | undefined {
  if (!isRecord(value)) return undefined;
  const remaining = finiteNumber(value.remaining);
  if (remaining === undefined || remaining < 0 || remaining > 100) return undefined;
  const resetsIn = value.resetsIn;
  if (
    resetsIn !== undefined &&
    (typeof resetsIn !== "string" || !/^(?:now|\d+[dhms])$/.test(resetsIn))
  ) {
    return undefined;
  }
  return { remaining, ...(typeof resetsIn === "string" ? { resetsIn } : {}) };
}

function parseUsageSnapshot(value: unknown): UsageSnapshot | undefined {
  if (!isRecord(value) || !Array.isArray(value.windows)) return undefined;
  const windows = value.windows
    .map(parseUsageWindowStatus)
    .filter((window): window is UsageWindowStatus => window !== undefined);
  const availableCount = nonnegativeInteger(value.availableCount);
  return { windows, ...(availableCount !== undefined ? { availableCount } : {}) };
}

function parseUrgency(value: unknown): Urgency {
  return value === "urgent" || value === "soon" || value === "later" ? value : "unknown";
}

function parseResetCreditsSnapshot(value: unknown): ResetCreditsSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const availableCount = nonnegativeInteger(value.availableCount);
  if (availableCount === undefined) return undefined;
  return { availableCount, urgency: parseUrgency(value.urgency) };
}

function parseCachedAccount(value: unknown): CachedAccount | undefined {
  if (!isRecord(value) || typeof value.credentialKey !== "string") return undefined;
  const usage = parseUsageSnapshot(value.usage);
  const usageCheckedAt = finiteNumber(value.usageCheckedAt);
  const resetCredits = parseResetCreditsSnapshot(value.resetCredits);
  const resetCreditsCheckedAt = finiteNumber(value.resetCreditsCheckedAt);
  return {
    credentialKey: value.credentialKey,
    ...(usage ? { usage } : {}),
    ...(usageCheckedAt !== undefined ? { usageCheckedAt } : {}),
    ...(resetCredits ? { resetCredits } : {}),
    ...(resetCreditsCheckedAt !== undefined ? { resetCreditsCheckedAt } : {}),
  };
}

function readUsageCache(path: string): UsageCache {
  const value = readJsonObject(path);
  if (value?.schema !== CACHE_SCHEMA || !isRecord(value.accounts)) {
    return { schema: CACHE_SCHEMA, accounts: {} };
  }

  const accounts: Record<string, CachedAccount> = {};
  for (const [key, entry] of Object.entries(value.accounts)) {
    const parsed = parseCachedAccount(entry);
    if (parsed && parsed.credentialKey === key) accounts[key] = parsed;
  }
  return { schema: CACHE_SCHEMA, accounts };
}

function writeUsageCache(path: string, cache: UsageCache): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(cache)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, path);
}

function defaultCachePath(): string {
  const cacheHome = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(cacheHome, "fbb", "pi-auth-profiles-usage.json");
}

export function cachedResetCreditStatusForAccount(
  accountId: string,
  cachePath = defaultCachePath(),
): CachedResetCreditStatus | undefined {
  const cached = readUsageCache(cachePath).accounts[accountCredentialKey(accountId)];
  if (cached?.resetCredits === undefined || cached.resetCreditsCheckedAt === undefined) {
    return undefined;
  }
  // This is only a profile-picker hint; the selected profile is fetched again before mutation.
  return { ...cached.resetCredits, checkedAt: cached.resetCreditsCheckedAt };
}

async function refreshAccount(
  credentialKey: string,
  credential: CodexCredential,
  cached: CachedAccount | undefined,
  now: number,
  fetchFn: FetchFn,
  forceUsageRefresh: boolean,
  includeResetCredits: boolean,
): Promise<AccountResult> {
  const next: CachedAccount =
    cached?.credentialKey === credentialKey ? { ...cached } : { credentialKey };
  const errors: DiagnosticCode[] = [];

  if (credential.expires <= now) {
    errors.push("credential-expired");
  } else if (
    forceUsageRefresh ||
    !next.usageCheckedAt ||
    now - next.usageCheckedAt >= USAGE_CACHE_MS
  ) {
    try {
      next.usage = usageFromPayload(await fetchPayload(USAGE_URL, credential, fetchFn));
      next.usageCheckedAt = now;
    } catch {
      errors.push("usage-request-failed");
    }
  }

  const usageCount = next.usage?.availableCount;
  const resetCreditsAreStale =
    !next.resetCreditsCheckedAt || now - next.resetCreditsCheckedAt >= RESET_CREDITS_CACHE_MS;
  const resetCreditsCountChanged =
    usageCount !== undefined && next.resetCredits?.availableCount !== usageCount;
  if (
    includeResetCredits &&
    credential.expires > now &&
    (resetCreditsAreStale || resetCreditsCountChanged)
  ) {
    try {
      next.resetCredits = resetCreditsFromPayload(
        await fetchPayload(RESET_CREDITS_URL, credential, fetchFn),
        now,
      );
      next.resetCreditsCheckedAt = now;
    } catch {
      errors.push("reset-credits-request-failed");
    }
  }

  const availableCount = next.resetCredits?.availableCount ?? usageCount;
  return {
    cached: next,
    profile: {
      usage: next.usage?.windows ?? [],
      ...(availableCount !== undefined ? { availableCount } : {}),
      urgency:
        availableCount && next.resetCredits?.availableCount === availableCount
          ? next.resetCredits.urgency
          : "unknown",
    },
    errors,
  };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  const jobs = values.map((value, index) => ({ value, index }));
  async function run(): Promise<void> {
    while (true) {
      const job = jobs.shift();
      if (!job) return;
      results[job.index] = await worker(job.value);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => run()));
  return results;
}

export async function collectUsageStatus(
  options: CollectUsageStatusOptions = {},
): Promise<UsageStatusPayload> {
  const agentDir = options.agentDir ?? getAgentDir();
  const fetchFn = options.fetchFn ?? fetch;
  const now = (options.now ?? Date.now)();
  const diagnostics: UsageStatusPayload["diagnostics"] = [];
  const profileCredentials: ProfileCredential[] = [];
  const requestedProfiles = options.profileLabels
    ? new Set(options.profileLabels.map(normalizeName))
    : undefined;

  for (const rawName of listProfiles(agentDir)) {
    if (rawName === DEFAULT_PROFILE && options.includeDefault !== true) continue;

    let profileLabel: string;
    try {
      profileLabel = normalizeName(rawName);
    } catch {
      diagnostics.push({ profileLabel: "invalid", code: "invalid-profile-name" });
      continue;
    }

    if (requestedProfiles && requestedProfiles.has(profileLabel) === false) continue;

    const result = readCodexCredential(authPathFor(profileLabel, agentDir));
    if (result.kind === "missing") continue;
    if (result.kind !== "valid") {
      diagnostics.push({ profileLabel, code: result.kind });
      continue;
    }
    profileCredentials.push({
      profileLabel,
      credentialKey: accountCredentialKey(result.credential.accountId),
      credential: result.credential,
    });
  }

  const activeProfile = options.activeProfile ?? DEFAULT_PROFILE;
  const cachePath = options.cachePath ?? defaultCachePath();
  const cache = readUsageCache(cachePath);
  const credentialsByKey = new Map<string, CodexCredential>();
  for (const profile of profileCredentials) {
    const existing = credentialsByKey.get(profile.credentialKey);
    if (!existing || profile.credential.expires > existing.expires) {
      credentialsByKey.set(profile.credentialKey, profile.credential);
    }
  }

  const accountEntries = [...credentialsByKey.entries()];
  const accountResults = await mapWithConcurrency(
    accountEntries,
    MAX_CONCURRENT_REQUESTS,
    ([credentialKey, credential]) =>
      refreshAccount(
        credentialKey,
        credential,
        cache.accounts[credentialKey],
        now,
        fetchFn,
        options.forceUsageRefresh === true,
        options.includeResetCredits !== false,
      ),
  );
  const resultsByKey = new Map<string, AccountResult>();
  accountEntries.forEach(([credentialKey], index) => {
    const result = accountResults[index];
    if (result) resultsByKey.set(credentialKey, result);
  });
  const nextCache: UsageCache = {
    schema: CACHE_SCHEMA,
    accounts: requestedProfiles ? { ...cache.accounts } : {},
  };
  for (const [credentialKey, result] of resultsByKey) {
    nextCache.accounts[credentialKey] = result.cached;
  }
  writeUsageCache(cachePath, nextCache);

  const profiles = profileCredentials
    .map(({ profileLabel, credentialKey }) => {
      const result = resultsByKey.get(credentialKey);
      if (!result) return undefined;
      for (const code of result.errors) diagnostics.push({ profileLabel, code });
      return {
        profileLabel,
        active: profileLabel === activeProfile,
        ...result.profile,
      } satisfies ProfileUsageStatus;
    })
    .filter((profile): profile is ProfileUsageStatus => profile !== undefined)
    .sort((left, right) =>
      left.profileLabel < right.profileLabel ? -1 : left.profileLabel > right.profileLabel ? 1 : 0,
    );

  return { schema: OUTPUT_SCHEMA, profiles, diagnostics };
}
