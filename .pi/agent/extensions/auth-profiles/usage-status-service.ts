import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { isRecord } from "../shared/is-record";
import { DEFAULT_PROFILE, listProfiles, normalizeName, providersIn } from "./profile-store";
import {
  type ProfileCredentialReadResult,
  type ProfileProviderAdapter,
  type ProfileProviderCredential,
  ProviderAuthError,
  type ProviderFetch,
  type ProviderUsageSnapshot,
  type ProviderUsageWindow,
  type UsageUrgency,
} from "./provider-adapter";
import {
  ANTHROPIC_PROVIDER_ID,
  type AnthropicCredential,
  fetchAnthropicUsage,
  readAnthropicCredential,
  refreshAnthropicCredential,
} from "./providers/anthropic-usage";
import {
  createOpenAiCodexProfileAdapter,
  openAiCodexCreditsFromPayload,
  openAiCodexUsageFromPayload,
} from "./providers/openai-codex";

const OUTPUT_SCHEMA = "fbb.pi-auth-profiles-usage/v1";
const CACHE_SCHEMA = "fbb.pi-auth-profiles-usage-cache/v2";
const MAX_CACHE_BYTES = 2 * 1024 * 1024;
const USAGE_CACHE_MS = 10_000;
const RESET_CREDITS_CACHE_MS = 8 * 60 * 60 * 1_000;
const MAX_CONCURRENT_REQUESTS = 4;
const liveUsageByCredential = new Map<string, ProviderUsageSnapshot>();
const CACHE_NEEDS_REVALIDATION: unique symbol = Symbol("usage-cache-needs-revalidation");
const pendingRevalidations = new Map<string, Promise<UsageStatusPayload>>();

export type FetchFn = ProviderFetch;
type Urgency = UsageUrgency;
export type DiagnosticCode =
  | "credential-identity-changed"
  | "credential-expired"
  | "credential-read-failed"
  | "credential-refresh-failed"
  | "invalid-auth-file"
  | "invalid-provider-credential"
  | "invalid-profile-name"
  | "reset-credits-request-failed"
  | "usage-cache-write-failed"
  | "usage-request-failed";

export const AUTH_USAGE_OBSERVATION: unique symbol = Symbol("auth-usage-observation");

export interface AuthUsageObservation {
  readonly windows: readonly ProviderUsageWindow[];
  readonly observedAt: number;
  readonly staleAt: number;
  readonly bankedResetCount?: number;
  readonly bankedExpiryAt?: number;
}

export type UsageWindowStatus = ProviderUsageWindow;

export type ProfileUsageStatus = {
  profileLabel: string;
  active: boolean;
  availableCount?: number;
  nextExpiresAt?: string;
  urgency: Urgency;
  usage: UsageWindowStatus[];
  /** Anthropic plan windows (5h, 7d) for profiles that can use Anthropic OAuth. */
  anthropicUsage?: UsageWindowStatus[];
  readonly [AUTH_USAGE_OBSERVATION]?: AuthUsageObservation;
};

export type UsageStatusPayload = {
  schema: typeof OUTPUT_SCHEMA;
  profiles: ProfileUsageStatus[];
  diagnostics: Array<{ profileLabel: string; code: DiagnosticCode }>;
  readonly [CACHE_NEEDS_REVALIDATION]?: boolean;
};

type UsageSnapshot = {
  windows: UsageWindowStatus[];
  availableCount?: number;
};

type ResetCreditsSnapshot = {
  availableCount: number;
  nextExpiresAt?: string | null;
  urgency: Urgency;
};

export type CachedResetCreditStatus = ResetCreditsSnapshot & {
  checkedAt: number;
};

type CachedAccount = {
  credentialKey: string;
  usage?: UsageSnapshot;
  usageCheckedAt?: number;
  /** Last Anthropic request attempt, including failures, so rate limits are not hammered. */
  attemptedAt?: number;
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
  credential: ProfileProviderCredential;
};

type AccountResult = {
  cached: CachedAccount;
  profile: Omit<ProfileUsageStatus, "profileLabel" | "active">;
  errors: DiagnosticCode[];
  needsRevalidation: boolean;
};

export type CollectUsageStatusOptions = {
  activeProfile?: string;
  agentDir?: string;
  cachePath?: string;
  cacheOnly?: boolean;
  fetchFn?: FetchFn;
  forceUsageRefresh?: boolean;
  staleWhileRevalidate?: boolean;
  onRevalidated?: (status: UsageStatusPayload) => void;
  includeDefault?: boolean;
  includeResetCredits?: boolean;
  now?: () => number;
  profileLabels?: readonly string[];
  providerAdapter?: ProfileProviderAdapter;
};

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

function accountCredentialKey(providerId: string, identity: string): string {
  return createHash("sha256").update(providerId).update("\0").update(identity).digest("hex");
}

export function usageFromPayload(payload: unknown): UsageSnapshot {
  const snapshot = openAiCodexUsageFromPayload(payload);
  return {
    windows: snapshot.windows,
    ...(snapshot.availableCreditCount === undefined
      ? {}
      : { availableCount: snapshot.availableCreditCount }),
  };
}

export function resetCreditsFromPayload(payload: unknown, now = Date.now()): ResetCreditsSnapshot {
  return openAiCodexCreditsFromPayload(payload, now);
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
  const windowId =
    typeof value.windowId === "string" && /^(?:primary|secondary|credit)$/.test(value.windowId)
      ? value.windowId
      : undefined;
  const allowanceResetAt = finiteNumber(value.allowanceResetAt);
  if (
    value.allowanceResetAt !== undefined &&
    (allowanceResetAt === undefined || allowanceResetAt < 0)
  ) {
    return undefined;
  }
  const detail =
    typeof value.detail === "string" && value.detail.length <= 80 ? value.detail : undefined;
  // Legacy persisted windows lack stable IDs and absolute reset times; preserve that limitation.
  return {
    ...(detail === undefined ? {} : { detail }),
    ...(windowId === undefined ? {} : { windowId }),
    remaining,
    ...(typeof resetsIn === "string" ? { resetsIn } : {}),
    ...(allowanceResetAt === undefined ? {} : { allowanceResetAt }),
  };
}

function parseUsageSnapshot(value: unknown): UsageSnapshot | undefined {
  if (!isRecord(value) || !Array.isArray(value.windows) || value.windows.length === 0) {
    return undefined;
  }
  const windows: UsageWindowStatus[] = [];
  for (const valueWindow of value.windows) {
    const window = parseUsageWindowStatus(valueWindow);
    if (window === undefined) return undefined;
    windows.push(window);
  }
  const availableCount = nonnegativeInteger(value.availableCount);
  if (value.availableCount !== undefined && availableCount === undefined) return undefined;
  return { windows, ...(availableCount !== undefined ? { availableCount } : {}) };
}

function parseUrgency(value: unknown): Urgency {
  return value === "urgent" || value === "soon" || value === "later" ? value : "unknown";
}

function parseResetCreditsSnapshot(value: unknown): ResetCreditsSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const availableCount = nonnegativeInteger(value.availableCount);
  if (availableCount === undefined) return undefined;
  const nextExpiresAt = value.nextExpiresAt;
  if (
    nextExpiresAt !== undefined &&
    nextExpiresAt !== null &&
    (typeof nextExpiresAt !== "string" || Number.isFinite(Date.parse(nextExpiresAt)) === false)
  ) {
    return undefined;
  }
  return {
    availableCount,
    ...(nextExpiresAt === undefined ? {} : { nextExpiresAt }),
    urgency: parseUrgency(value.urgency),
  };
}

function parseCachedAccount(value: unknown): CachedAccount | undefined {
  if (!isRecord(value) || typeof value.credentialKey !== "string") return undefined;
  const usage = parseUsageSnapshot(value.usage);
  const usageCheckedAt = usage === undefined ? undefined : finiteNumber(value.usageCheckedAt);
  const resetCredits = parseResetCreditsSnapshot(value.resetCredits);
  const resetCreditsCheckedAt = finiteNumber(value.resetCreditsCheckedAt);
  const attemptedAt = finiteNumber(value.attemptedAt);
  return {
    credentialKey: value.credentialKey,
    ...(attemptedAt !== undefined ? { attemptedAt } : {}),
    ...(usage ? { usage } : {}),
    ...(usageCheckedAt !== undefined ? { usageCheckedAt } : {}),
    ...(resetCredits ? { resetCredits } : {}),
    ...(resetCreditsCheckedAt !== undefined ? { resetCreditsCheckedAt } : {}),
  };
}

function readUsageCache(path: string): UsageCache {
  try {
    if (existsSync(path) && statSync(path).size > MAX_CACHE_BYTES) {
      return { schema: CACHE_SCHEMA, accounts: {} };
    }
  } catch {
    return { schema: CACHE_SCHEMA, accounts: {} };
  }

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

export function defaultCachePath(): string {
  const cacheHome = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(cacheHome, "fbb", "pi-auth-profiles-usage.json");
}

export function cachedResetCreditStatusForAccount(
  accountId: string,
  cachePath = defaultCachePath(),
  providerId = "openai-codex",
): CachedResetCreditStatus | undefined {
  const cached = readUsageCache(cachePath).accounts[accountCredentialKey(providerId, accountId)];
  if (cached?.resetCredits === undefined || cached.resetCreditsCheckedAt === undefined) {
    return undefined;
  }
  // This is only a profile-picker hint; the selected profile is fetched again before mutation.
  return { ...cached.resetCredits, checkedAt: cached.resetCreditsCheckedAt };
}

function positionalWindowId(index: number): string {
  if (index === 0) return "primary";
  if (index === 1) return "secondary";
  return `window-${index + 1}`;
}

function observedUsageWindows(
  windows: readonly ProviderUsageWindow[] | undefined,
): ProviderUsageWindow[] {
  return (windows ?? []).map((window, index) => ({
    ...window,
    ...(window.windowId === undefined ? { windowId: positionalWindowId(index) } : {}),
  }));
}

function anthropicDisplayWindows(
  windows: readonly ProviderUsageWindow[] | undefined,
): UsageWindowStatus[] {
  return (windows ?? []).map(({ windowId, remaining, resetsIn, detail, allowanceResetAt }) => ({
    ...(windowId === undefined ? {} : { windowId }),
    ...(detail === undefined ? {} : { detail }),
    remaining,
    ...(resetsIn === undefined ? {} : { resetsIn }),
    // The startup header schedules re-renders at absolute reset times.
    ...(allowanceResetAt === undefined ? {} : { allowanceResetAt }),
  }));
}

function displayUsageWindows(
  windows: readonly ProviderUsageWindow[] | undefined,
): UsageWindowStatus[] {
  return (windows ?? []).map(({ remaining, resetsIn }) => ({
    remaining,
    ...(resetsIn === undefined ? {} : { resetsIn }),
  }));
}

function resetCreditsNeedRefresh(cached: CachedAccount, now: number): boolean {
  return (
    cached.resetCreditsCheckedAt === undefined ||
    now - cached.resetCreditsCheckedAt >= RESET_CREDITS_CACHE_MS ||
    (cached.usage?.availableCount !== undefined &&
      cached.resetCredits?.availableCount !== cached.usage.availableCount) ||
    ((cached.resetCredits?.availableCount ?? 0) > 0 &&
      cached.resetCredits?.nextExpiresAt === undefined)
  );
}

async function refreshAccount(
  adapter: ProfileProviderAdapter,
  credentialKey: string,
  profileLabel: string,
  initialCredential: ProfileProviderCredential,
  cached: CachedAccount | undefined,
  now: number,
  fetchFn: FetchFn,
  forceUsageRefresh: boolean,
  includeResetCredits: boolean,
  cacheOnly: boolean,
): Promise<AccountResult> {
  const next: CachedAccount =
    cached?.credentialKey === credentialKey ? { ...cached } : { credentialKey };
  const errors: DiagnosticCode[] = [];
  let liveUsage = liveUsageByCredential.get(credentialKey);
  let credential = initialCredential;

  if (credential.expiresAt <= now) {
    errors.push("credential-expired");
  } else if (
    !cacheOnly &&
    (forceUsageRefresh || !next.usageCheckedAt || now - next.usageCheckedAt >= USAGE_CACHE_MS)
  ) {
    try {
      let usage: ProviderUsageSnapshot;
      try {
        usage = await adapter.fetchUsage(credential, fetchFn);
      } catch (error) {
        if (!(error instanceof ProviderAuthError)) throw error;
        // The server can revoke a token that still looks valid locally, e.g. after another
        // profile on the same account rotated the refresh token. Refresh once and retry.
        credential = await adapter.refreshCredential({
          expectedIdentity: credential.identity,
          profileLabel,
          force: true,
        });
        usage = await adapter.fetchUsage(credential, fetchFn);
      }
      liveUsage = usage;
      liveUsageByCredential.set(credentialKey, usage);
      next.usage = {
        // Preserve provider window identity and absolute reset deadlines for the next process.
        windows: usage.windows,
        ...(usage.availableCreditCount === undefined
          ? {}
          : { availableCount: usage.availableCreditCount }),
      };
      next.usageCheckedAt = now;
    } catch {
      errors.push("usage-request-failed");
    }
  }

  const usageCount = next.usage?.availableCount;
  if (
    includeResetCredits &&
    !cacheOnly &&
    credential.expiresAt > now &&
    adapter.fetchCredits !== undefined &&
    resetCreditsNeedRefresh(next, now)
  ) {
    try {
      next.resetCredits = await adapter.fetchCredits(credential, fetchFn, now);
      next.resetCreditsCheckedAt = now;
    } catch {
      errors.push("reset-credits-request-failed");
    }
  }

  // Credit details can outlive a failed refresh; keep the newest successful count.
  const usageCountIsNewer =
    usageCount !== undefined && (next.usageCheckedAt ?? 0) > (next.resetCreditsCheckedAt ?? 0);
  const availableCount = usageCountIsNewer
    ? usageCount
    : (next.resetCredits?.availableCount ?? usageCount);
  const resetCredits =
    availableCount !== undefined && next.resetCredits?.availableCount === availableCount
      ? next.resetCredits
      : undefined;
  const bankedExpiryAt =
    typeof resetCredits?.nextExpiresAt === "string"
      ? Date.parse(resetCredits.nextExpiresAt)
      : undefined;
  const profile: AccountResult["profile"] = {
    usage: displayUsageWindows(next.usage?.windows),
    ...(availableCount !== undefined ? { availableCount } : {}),
    ...(typeof resetCredits?.nextExpiresAt === "string"
      ? { nextExpiresAt: resetCredits.nextExpiresAt }
      : {}),
    urgency: resetCredits?.urgency ?? "unknown",
  };
  if (next.usageCheckedAt !== undefined) {
    const observation: AuthUsageObservation = Object.freeze({
      windows: Object.freeze(observedUsageWindows(liveUsage?.windows ?? next.usage?.windows)),
      observedAt: next.usageCheckedAt,
      staleAt: next.usageCheckedAt + USAGE_CACHE_MS,
      ...(availableCount === undefined ? {} : { bankedResetCount: availableCount }),
      ...(bankedExpiryAt === undefined || !Number.isFinite(bankedExpiryAt)
        ? {}
        : { bankedExpiryAt }),
    });
    Object.defineProperty(profile, AUTH_USAGE_OBSERVATION, { value: observation });
  }
  return {
    cached: next,
    profile,
    errors,
    needsRevalidation:
      credential.expiresAt <= now ||
      (cacheOnly && forceUsageRefresh) ||
      next.usageCheckedAt === undefined ||
      now - next.usageCheckedAt >= USAGE_CACHE_MS ||
      (includeResetCredits &&
        adapter.fetchCredits !== undefined &&
        resetCreditsNeedRefresh(next, now)),
  };
}

const ANTHROPIC_CACHE_MS = 5 * 60_000;

// Anthropic's usage endpoint is rate limited and the CLI runs in a fresh process every few
// seconds, so persist per credential holder and keep the last good windows on failure.
async function anthropicUsageFor(
  profileLabel: string,
  agentDir: string,
  fetchFn: FetchFn,
  now: number,
  cacheOnly: boolean,
  previous: Record<string, CachedAccount>,
  cache: Record<string, CachedAccount>,
): Promise<{ windows: UsageWindowStatus[] | undefined; needsRevalidation: boolean }> {
  let credential: AnthropicCredential | undefined = readAnthropicCredential(profileLabel, agentDir);
  if (credential === undefined) return { windows: undefined, needsRevalidation: false };
  const key = accountCredentialKey(ANTHROPIC_PROVIDER_ID, credential.identity);
  const cached = previous[key];
  if (cached) cache[key] = cached;
  const cachedWindows = cached?.usage ? anthropicDisplayWindows(cached.usage.windows) : undefined;
  const attemptedAt = cached?.attemptedAt ?? cached?.usageCheckedAt;
  const fresh = attemptedAt !== undefined && now - attemptedAt < ANTHROPIC_CACHE_MS;
  if (cacheOnly || fresh) return { windows: cachedWindows, needsRevalidation: !fresh };
  try {
    if (credential.expiresAt <= now) {
      credential = await refreshAnthropicCredential(credential, agentDir, false);
    }
    let windows: UsageWindowStatus[];
    try {
      windows = await fetchAnthropicUsage(credential, fetchFn, now);
    } catch (error) {
      if (!(error instanceof ProviderAuthError)) throw error;
      credential = await refreshAnthropicCredential(credential, agentDir, true);
      windows = await fetchAnthropicUsage(credential, fetchFn, now);
    }
    if (windows.length === 0) {
      cache[key] = { credentialKey: key, attemptedAt: now };
      return { windows: undefined, needsRevalidation: false };
    }
    cache[key] = { credentialKey: key, usage: { windows }, usageCheckedAt: now, attemptedAt: now };
    return { windows: anthropicDisplayWindows(windows), needsRevalidation: false };
  } catch {
    // Back off for a full interval so a failing endpoint is not retried on every render.
    cache[key] = { ...(cached ?? { credentialKey: key }), attemptedAt: now };
    return { windows: cachedWindows, needsRevalidation: false };
  }
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

export function usageStatusNeedsRevalidation(status: UsageStatusPayload): boolean {
  return status[CACHE_NEEDS_REVALIDATION] === true;
}

export async function collectUsageStatus(
  options: CollectUsageStatusOptions = {},
): Promise<UsageStatusPayload> {
  if (options.staleWhileRevalidate === true && options.cacheOnly !== true) {
    const cached = await collectUsageStatus({ ...options, cacheOnly: true });
    if (usageStatusNeedsRevalidation(cached)) {
      const key = JSON.stringify([
        options.cachePath ?? defaultCachePath(),
        options.agentDir ?? getAgentDir(),
        options.activeProfile,
        options.profileLabels,
        options.includeDefault,
        options.includeResetCredits,
        options.providerAdapter?.providerId,
      ]);
      let pending = pendingRevalidations.get(key);
      if (pending === undefined) {
        const { onRevalidated: _callback, ...refreshOptions } = options;
        // Defer work until callers have published the cached snapshot.
        pending = new Promise<void>((resolve) => setImmediate(resolve))
          .then(() => collectUsageStatus({ ...refreshOptions, staleWhileRevalidate: false }))
          .finally(() => {
            pendingRevalidations.delete(key);
          });
        pendingRevalidations.set(key, pending);
      }
      void pending
        .then((status) => {
          const failures = new Set(status.diagnostics.map(({ profileLabel }) => profileLabel));
          const labels = new Set(status.profiles.map(({ profileLabel }) => profileLabel));
          const retained = cached.profiles.filter(
            ({ profileLabel }) => failures.has(profileLabel) && !labels.has(profileLabel),
          );
          options.onRevalidated?.({ ...status, profiles: [...status.profiles, ...retained] });
        })
        .catch(() => {
          // Background failures retain the last successful snapshot for the next read.
        });
    }
    return cached;
  }
  const agentDir = options.agentDir ?? getAgentDir();
  const fetchFn = options.fetchFn ?? fetch;
  const now = (options.now ?? Date.now)();
  const adapter = options.providerAdapter ?? createOpenAiCodexProfileAdapter(agentDir);
  const diagnostics: UsageStatusPayload["diagnostics"] = [];
  const requestedProfiles = options.profileLabels
    ? new Set(options.profileLabels.map(normalizeName))
    : undefined;
  const candidateProfiles: string[] = [];
  // Profiles holding only non-Codex credentials still need an indicator entry.
  const codexlessProfiles: string[] = [];

  const failedCredentialKeys = new Set<string>();
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
    candidateProfiles.push(profileLabel);
  }

  const discoveredProfiles = await mapWithConcurrency(
    candidateProfiles,
    MAX_CONCURRENT_REQUESTS,
    async (profileLabel): Promise<ProfileCredential | undefined> => {
      let result: ProfileCredentialReadResult;
      try {
        result = await adapter.readCredential(profileLabel);
      } catch {
        diagnostics.push({ profileLabel, code: "credential-read-failed" });
        return undefined;
      }
      if (
        result.kind === "valid" &&
        result.credential.expiresAt <= now &&
        options.cacheOnly !== true
      ) {
        const expectedIdentity = result.credential.identity;
        let refreshed: ProfileProviderCredential;
        try {
          refreshed = await adapter.refreshCredential({ expectedIdentity, profileLabel });
        } catch {
          diagnostics.push({ profileLabel, code: "credential-refresh-failed" });
          failedCredentialKeys.add(accountCredentialKey(adapter.providerId, expectedIdentity));
          return undefined;
        }
        if (refreshed.identity !== expectedIdentity) {
          diagnostics.push({ profileLabel, code: "credential-identity-changed" });
          return undefined;
        }
        if (refreshed.expiresAt <= now) {
          diagnostics.push({ profileLabel, code: "credential-refresh-failed" });
          return undefined;
        }
        return {
          profileLabel,
          credentialKey: accountCredentialKey(adapter.providerId, refreshed.identity),
          credential: refreshed,
        };
      }

      if (result.kind === "missing") {
        if (providersIn(profileLabel, agentDir).length > 0) codexlessProfiles.push(profileLabel);
        return undefined;
      }
      if (result.kind !== "valid") {
        diagnostics.push({ profileLabel, code: result.kind });
        return undefined;
      }
      return {
        profileLabel,
        credentialKey: accountCredentialKey(adapter.providerId, result.credential.identity),
        credential: result.credential,
      };
    },
  );
  const profileCredentials = discoveredProfiles.filter(
    (profile): profile is ProfileCredential => profile !== undefined,
  );

  const activeProfile = options.activeProfile ?? DEFAULT_PROFILE;
  const cachePath = options.cachePath ?? defaultCachePath();
  const cache = readUsageCache(cachePath);
  const credentialsByKey = new Map<string, ProfileCredential>();
  for (const profile of profileCredentials) {
    const existing = credentialsByKey.get(profile.credentialKey);
    if (!existing || profile.credential.expiresAt > existing.credential.expiresAt) {
      credentialsByKey.set(profile.credentialKey, profile);
    }
  }

  const accountEntries = [...credentialsByKey.entries()];
  const accountResults = await mapWithConcurrency(
    accountEntries,
    MAX_CONCURRENT_REQUESTS,
    ([credentialKey, { profileLabel, credential }]) =>
      refreshAccount(
        adapter,
        credentialKey,
        profileLabel,
        credential,
        cache.accounts[credentialKey],
        now,
        fetchFn,
        options.forceUsageRefresh === true,
        options.includeResetCredits !== false,
        options.cacheOnly === true,
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
  // Credential refresh failures must not erase the last successful display snapshot.
  for (const key of failedCredentialKeys) {
    const retained = cache.accounts[key];
    if (retained) nextCache.accounts[key] = retained;
  }
  for (const [credentialKey, result] of resultsByKey) {
    nextCache.accounts[credentialKey] = result.cached;
  }
  const profiles = profileCredentials
    .map(({ profileLabel, credentialKey }) => {
      const result = resultsByKey.get(credentialKey);
      if (!result) return undefined;
      for (const code of result.errors) diagnostics.push({ profileLabel, code });
      const profile = {
        profileLabel,
        active: profileLabel === activeProfile,
        ...result.profile,
      } satisfies ProfileUsageStatus;
      const observation = result.profile[AUTH_USAGE_OBSERVATION];
      if (observation !== undefined) {
        Object.defineProperty(profile, AUTH_USAGE_OBSERVATION, { value: observation });
      }
      return profile;
    })
    .filter((profile): profile is ProfileUsageStatus => profile !== undefined)
    .concat(
      codexlessProfiles.map((profileLabel) => ({
        profileLabel,
        active: profileLabel === activeProfile,
        usage: [],
        urgency: "unknown" as const,
      })),
    )
    .sort((left, right) =>
      left.profileLabel < right.profileLabel ? -1 : left.profileLabel > right.profileLabel ? 1 : 0,
    );

  const anthropicUsage = await mapWithConcurrency(profiles, MAX_CONCURRENT_REQUESTS, (profile) =>
    anthropicUsageFor(
      profile.profileLabel,
      agentDir,
      fetchFn,
      now,
      options.cacheOnly === true,
      cache.accounts,
      nextCache.accounts,
    ),
  );
  profiles.forEach((profile, index) => {
    const windows = anthropicUsage[index]?.windows;
    if (windows) profile.anthropicUsage = windows;
  });

  if (options.cacheOnly !== true) {
    try {
      writeUsageCache(cachePath, nextCache);
    } catch {
      diagnostics.push({ profileLabel: "cache", code: "usage-cache-write-failed" });
    }
  }

  const status: UsageStatusPayload = { schema: OUTPUT_SCHEMA, profiles, diagnostics };
  Object.defineProperty(status, CACHE_NEEDS_REVALIDATION, {
    value:
      accountResults.some((result) => result.needsRevalidation) ||
      anthropicUsage.some((result) => result.needsRevalidation),
  });
  return status;
}
