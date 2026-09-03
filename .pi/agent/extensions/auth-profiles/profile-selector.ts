import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { match } from "ts-pattern";
import type { ProfileProviderAdapter } from "./provider-adapter";
import {
  type ProfileResolution,
  type ResolveProfileOptions,
  resolveProfile,
} from "./profile-resolver";
import {
  type CollectUsageStatusOptions,
  collectUsageStatus,
  type DiagnosticCode,
  type FetchFn,
  type UsageStatusPayload,
} from "./usage-status-service";
import { createOpenAiCodexProfileAdapter } from "./providers/openai-codex";

export {
  openAiCodexUsageLimitResetAt as codexUsageLimitResetAt,
  openAiCodexUsageLimitResetAtFromMessage as codexUsageLimitResetAtFromMessage,
} from "./providers/openai-codex";

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
  providerAdapter?: ProfileProviderAdapter;
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

type DiagnosticEffect = "credential-unusable" | "usage-unconfirmed" | "nonblocking";

function diagnosticEffect(code: DiagnosticCode): DiagnosticEffect {
  return match(code)
    .returnType<DiagnosticEffect>()
    .with(
      "credential-identity-changed",
      "credential-expired",
      "credential-read-failed",
      "credential-refresh-failed",
      "invalid-auth-file",
      "invalid-provider-credential",
      () => "credential-unusable",
    )
    .with("usage-request-failed", () => "usage-unconfirmed")
    .with(
      "invalid-profile-name",
      "reset-credits-request-failed",
      "usage-cache-write-failed",
      () => "nonblocking",
    )
    .exhaustive();
}

function hasConfirmedUsage(payload: UsageStatusPayload, profile: string): boolean {
  if (
    payload.diagnostics.some(
      (diagnostic) =>
        diagnostic.profileLabel === profile && diagnosticEffect(diagnostic.code) !== "nonblocking",
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
    diagnostics.some((diagnostic) => diagnosticEffect(diagnostic.code) === "credential-unusable")
  ) {
    return false;
  }

  const status = payload.profiles.find((candidate) => candidate.profileLabel === profile);
  if (status === undefined) return false;
  return (
    diagnostics.some((diagnostic) => diagnosticEffect(diagnostic.code) === "usage-unconfirmed") ||
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

  const eligibleProfiles = resolution.profileOrder.filter(
    (profile) => options.excludedProfiles?.has(profile) !== true,
  );
  if (eligibleProfiles.length === 0) return resolution;

  let usage: UsageStatusPayload;
  try {
    const agentDir = options.agentDir ?? getAgentDir();
    const providerAdapter = options.providerAdapter ?? createOpenAiCodexProfileAdapter(agentDir);
    usage = await (options.usageCollector ?? collectUsageStatus)({
      activeProfile: resolution.profile,
      agentDir,
      ...(options.cachePath === undefined ? {} : { cachePath: options.cachePath }),
      ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
      forceUsageRefresh: options.forceUsageRefresh === true,
      includeDefault: true,
      includeResetCredits: false,
      ...(options.now === undefined ? {} : { now: options.now }),
      profileLabels: eligibleProfiles,
      providerAdapter,
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
