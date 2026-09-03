import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  type ProfileResolution,
  type ResolveProfileOptions,
  resolveProfile,
} from "./profile-resolver";
import {
  type CollectUsageStatusOptions,
  collectUsageStatus,
  type FetchFn,
  type UsageStatusPayload,
} from "./usage-status-service";

const UNKNOWN_USAGE_COOLDOWN_MS = 60_000;

type ProfileContext = Pick<ExtensionContext, "cwd" | "isProjectTrusted">;
type UsageCollector = (options: CollectUsageStatusOptions) => Promise<UsageStatusPayload>;

export type ProfileSelection = ProfileResolution & {
  fallbackFrom?: string;
  fallbackReason?: "confirmed usage" | "credential availability";
  selectionWarning?: string;
};

export type ProfileSelectionOptions = ResolveProfileOptions & {
  allowUnconfirmedFallback?: boolean;
  cachePath?: string;
  excludedProfiles?: ReadonlySet<string>;
  fetchFn?: FetchFn;
  forceUsageRefresh?: boolean;
  now?: () => number;
  preferredProfile?: string;
  usageCollector?: UsageCollector;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withFallback(
  resolution: ProfileResolution,
  profile: string,
  fallbackReason: NonNullable<ProfileSelection["fallbackReason"]>,
): ProfileSelection {
  return {
    ...resolution,
    profile,
    ...(profile === resolution.profile ? {} : { fallbackFrom: resolution.profile }),
    fallbackReason,
  };
}

function preferProfile(
  resolution: ProfileResolution,
  preferredProfile: string | undefined,
): ProfileResolution {
  if (preferredProfile === undefined) return resolution;

  const startIndex = resolution.profileOrder.indexOf(preferredProfile);
  const profileOrder =
    startIndex < 0
      ? [preferredProfile, ...resolution.profileOrder]
      : [
          ...resolution.profileOrder.slice(startIndex),
          ...resolution.profileOrder.slice(0, startIndex),
        ];
  return {
    ...resolution,
    profile: preferredProfile,
    profileOrder,
    source: "session",
  };
}

function hasConfirmedUsage(payload: UsageStatusPayload, profile: string): boolean {
  if (
    payload.diagnostics.some(
      (diagnostic) =>
        diagnostic.profileLabel === profile &&
        (diagnostic.code === "credential-expired" ||
          diagnostic.code === "invalid-auth-file" ||
          diagnostic.code === "invalid-codex-credential" ||
          diagnostic.code === "usage-request-failed"),
    )
  ) {
    return false;
  }
  const status = payload.profiles.find((candidate) => candidate.profileLabel === profile);
  return (
    status !== undefined &&
    status.usage.length > 0 &&
    status.usage.every((window) => window.remaining > 0)
  );
}

function hasConfirmedExhaustion(payload: UsageStatusPayload, profile: string): boolean {
  const status = payload.profiles.find((candidate) => candidate.profileLabel === profile);
  return status?.usage.some((window) => window.remaining <= 0) === true;
}

function hasFallbackCredential(payload: UsageStatusPayload, profile: string): boolean {
  const diagnostics = payload.diagnostics.filter(
    (diagnostic) => diagnostic.profileLabel === profile,
  );
  if (
    diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "credential-expired" ||
        diagnostic.code === "invalid-auth-file" ||
        diagnostic.code === "invalid-codex-credential",
    )
  ) {
    return false;
  }

  const status = payload.profiles.find((candidate) => candidate.profileLabel === profile);
  if (status === undefined) return false;
  return (
    diagnostics.some((diagnostic) => diagnostic.code === "usage-request-failed") ||
    status.usage.length === 0 ||
    status.usage.every((window) => window.remaining > 0)
  );
}

export async function selectProfile(
  ctx: ProfileContext,
  options: ProfileSelectionOptions = {},
): Promise<ProfileSelection> {
  const automatic = await resolveProfile(ctx, options);
  const resolution = preferProfile(automatic, options.preferredProfile);
  if (resolution.profileOrder.length < 2) return resolution;

  const eligibleProfiles = resolution.profileOrder.filter(
    (profile) => options.excludedProfiles?.has(profile) !== true,
  );
  if (eligibleProfiles.length === 0) return resolution;

  let usage: UsageStatusPayload;
  try {
    usage = await (options.usageCollector ?? collectUsageStatus)({
      activeProfile: resolution.profile,
      agentDir: options.agentDir ?? getAgentDir(),
      ...(options.cachePath === undefined ? {} : { cachePath: options.cachePath }),
      ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
      forceUsageRefresh: options.forceUsageRefresh === true,
      includeDefault: true,
      includeResetCredits: false,
      ...(options.now === undefined ? {} : { now: options.now }),
      profileLabels: eligibleProfiles,
    });
  } catch (error) {
    return { ...resolution, selectionWarning: errorMessage(error) };
  }

  const confirmed = eligibleProfiles.find((profile) => hasConfirmedUsage(usage, profile));
  if (confirmed !== undefined) return withFallback(resolution, confirmed, "confirmed usage");

  const selectedProfileIsExhausted = hasConfirmedExhaustion(usage, resolution.profile);
  if (options.allowUnconfirmedFallback !== false && selectedProfileIsExhausted === false) {
    const credentialFallback = eligibleProfiles.find((profile) =>
      hasFallbackCredential(usage, profile),
    );
    if (credentialFallback !== undefined) {
      return withFallback(resolution, credentialFallback, "credential availability");
    }
  }

  return selectedProfileIsExhausted
    ? {
        ...resolution,
        selectionWarning: `${resolution.profile} is exhausted; no alternate profile has confirmed usage`,
      }
    : resolution;
}

function finiteHeaderNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function codexUsageLimitResetAtFromMessage(
  errorMessage: string | undefined,
  currentTime = Date.now(),
): number | undefined {
  return errorMessage?.startsWith("You have hit your ChatGPT usage limit")
    ? currentTime + UNKNOWN_USAGE_COOLDOWN_MS
    : undefined;
}

export function codexUsageLimitResetAt(
  responseHeaders: Record<string, string>,
  currentTime = Date.now(),
): number | undefined {
  const headers = Object.fromEntries(
    Object.entries(responseHeaders).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const resetTimes: number[] = [];
  let exhausted = false;

  for (const window of ["primary", "secondary"] as const) {
    const usedPercent = finiteHeaderNumber(headers[`x-codex-${window}-used-percent`]);
    if (usedPercent === undefined || usedPercent < 100) continue;
    exhausted = true;

    const resetAtSeconds = finiteHeaderNumber(headers[`x-codex-${window}-reset-at`]);
    if (resetAtSeconds !== undefined) {
      const resetAt = resetAtSeconds * 1_000;
      if (Number.isFinite(resetAt) && resetAt > currentTime) {
        resetTimes.push(resetAt);
        continue;
      }
    }

    const resetAfterSeconds = finiteHeaderNumber(headers[`x-codex-${window}-reset-after-seconds`]);
    if (resetAfterSeconds !== undefined && resetAfterSeconds >= 0) {
      const resetAt = currentTime + resetAfterSeconds * 1_000;
      if (Number.isFinite(resetAt) && resetAt > currentTime) resetTimes.push(resetAt);
    }
  }

  if (exhausted === false) return undefined;
  return resetTimes.length > 0 ? Math.max(...resetTimes) : currentTime + UNKNOWN_USAGE_COOLDOWN_MS;
}
