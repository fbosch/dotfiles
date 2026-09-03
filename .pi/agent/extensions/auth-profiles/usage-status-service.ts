import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
  ProfileCredentialReadResult,
  ProfileProviderAdapter,
  ProfileProviderCredential,
  ProviderFetch,
  ProviderUsageWindow,
  UsageUrgency,
} from "./provider-adapter";
import { DEFAULT_PROFILE, listProfiles, normalizeName } from "./profile-store";
import {
  createOpenAiCodexProfileAdapter,
  openAiCodexCreditsFromPayload,
  openAiCodexUsageFromPayload,
} from "./providers/openai-codex";

const OUTPUT_SCHEMA = "fbb.pi-auth-profiles-usage/v1";
const CACHE_SCHEMA = "fbb.pi-auth-profiles-usage-cache/v1";
const MAX_CACHE_BYTES = 2 * 1024 * 1024;
const USAGE_CACHE_MS = 10_000;
const RESET_CREDITS_CACHE_MS = 8 * 60 * 60 * 1_000;
const MAX_CONCURRENT_REQUESTS = 4;

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

export type UsageWindowStatus = ProviderUsageWindow;

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
  credential: ProfileProviderCredential;
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
  providerAdapter?: ProfileProviderAdapter;
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

function accountCredentialKey(accountId: string): string {
  return createHash("sha256").update(accountId).digest("hex");
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
  adapter: ProfileProviderAdapter,
  credentialKey: string,
  credential: ProfileProviderCredential,
  cached: CachedAccount | undefined,
  now: number,
  fetchFn: FetchFn,
  forceUsageRefresh: boolean,
  includeResetCredits: boolean,
): Promise<AccountResult> {
  const next: CachedAccount =
    cached?.credentialKey === credentialKey ? { ...cached } : { credentialKey };
  const errors: DiagnosticCode[] = [];

  if (credential.expiresAt <= now) {
    errors.push("credential-expired");
  } else if (
    forceUsageRefresh ||
    !next.usageCheckedAt ||
    now - next.usageCheckedAt >= USAGE_CACHE_MS
  ) {
    try {
      const usage = await adapter.fetchUsage(credential, fetchFn);
      next.usage = {
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
  const resetCreditsAreStale =
    !next.resetCreditsCheckedAt || now - next.resetCreditsCheckedAt >= RESET_CREDITS_CACHE_MS;
  const resetCreditsCountChanged =
    usageCount !== undefined && next.resetCredits?.availableCount !== usageCount;
  if (
    includeResetCredits &&
    credential.expiresAt > now &&
    adapter.fetchCredits !== undefined &&
    (resetCreditsAreStale || resetCreditsCountChanged)
  ) {
    try {
      next.resetCredits = await adapter.fetchCredits(credential, fetchFn, now);
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
  const adapter = options.providerAdapter ?? createOpenAiCodexProfileAdapter(agentDir);
  const diagnostics: UsageStatusPayload["diagnostics"] = [];
  const requestedProfiles = options.profileLabels
    ? new Set(options.profileLabels.map(normalizeName))
    : undefined;
  const candidateProfiles: string[] = [];

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
      if (result.kind === "valid" && result.credential.expiresAt <= now) {
        const expectedIdentity = result.credential.identity;
        let refreshed: ProfileProviderCredential;
        try {
          refreshed = await adapter.refreshCredential({ expectedIdentity, profileLabel });
        } catch {
          diagnostics.push({ profileLabel, code: "credential-refresh-failed" });
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
          credentialKey: accountCredentialKey(refreshed.identity),
          credential: refreshed,
        };
      }

      if (result.kind === "missing") return undefined;
      if (result.kind !== "valid") {
        diagnostics.push({ profileLabel, code: result.kind });
        return undefined;
      }
      return {
        profileLabel,
        credentialKey: accountCredentialKey(result.credential.identity),
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
  const credentialsByKey = new Map<string, ProfileProviderCredential>();
  for (const profile of profileCredentials) {
    const existing = credentialsByKey.get(profile.credentialKey);
    if (!existing || profile.credential.expiresAt > existing.expiresAt) {
      credentialsByKey.set(profile.credentialKey, profile.credential);
    }
  }

  const accountEntries = [...credentialsByKey.entries()];
  const accountResults = await mapWithConcurrency(
    accountEntries,
    MAX_CONCURRENT_REQUESTS,
    ([credentialKey, credential]) =>
      refreshAccount(
        adapter,
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
  try {
    writeUsageCache(cachePath, nextCache);
  } catch {
    diagnostics.push({ profileLabel: "cache", code: "usage-cache-write-failed" });
  }

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
