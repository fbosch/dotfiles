/**
 * Vendored from @nanstey/pi-auth-profiles@0.1.1.
 * npm integrity: sha512-AMg/Xl5KVcuLTs2ig+dQx27Q3iKRd3+vae07yIfNzpf1dCcyQ7V8a3EKwvWrbwhTQjK6/+Z63wNgaeI1W4auYA==
 * Local changes: repository formatting, type-safety guards, active-profile status publishing,
 * WezTerm status invalidation, a usage-status data source, a reset-credit command, and
 * repository-compatible JSON indentation.
 * License: MIT; see LICENSE in this directory.
 */

import type { CredentialStore } from "@earendil-works/pi-ai";
import { brandColor, PROVIDER_BRANDS, type ProviderBrand } from "../shared/provider-brand";
import {
  installCredentialLoginBoundary,
  PROFILE_FALLBACK_PROVIDERS,
  PROFILE_LOGIN_PROVIDERS,
} from "./credential-login";
import {
  type FallbackOwnerRoute,
  fallbackCredentialOwner,
  fallbackOwnerChain,
  openProfileCredentials,
  type ProfileAuthFallbackCallbacks,
} from "./profile-credentials";
import type { GitRunner } from "./profile-resolver";
import { type ProfileSelection, selectProfile } from "./profile-selector";
import {
  authPathFor,
  DEFAULT_PROFILE,
  globalConfigPath,
  listProfiles,
  normalizeName,
  PROFILE_STATUS_KEY,
  providersIn,
  publishWezTermChange,
  readJsonFile,
  updateJsonFile,
} from "./profile-store";
import type { ProfileProviderAdapter } from "./provider-adapter";
import {
  ANTHROPIC_PROVIDER_ID,
  anthropicExhaustionResetAt,
  anthropicUsageLimitFromMessage,
  hasConfirmedAnthropicUsage,
} from "./providers/anthropic-usage";
import { createOpenAiCodexProfileAdapter } from "./providers/openai-codex";
import { registerResetCreditCommand } from "./reset-credit";
import { persistSessionProfile, restoreSessionProfile } from "./session-profile";
import {
  type AuthProfileObservation,
  type AuthProviderObservation,
  AuthStartupOwner,
  type AuthStartupState,
} from "./startup-owner";
import {
  AUTH_USAGE_OBSERVATION,
  collectUsageStatus,
  type ProfileUsageStatus,
  type UsageStatusPayload,
} from "./usage-status-service";

export { createProfileCredentialStore } from "./profile-credentials";
export { resolveProfile } from "./profile-resolver";
export { authPathFor } from "./profile-store";

/**
 * auth-profiles — routed OAuth/API-key credential profiles for pi.
 *
 * Profiles are separate credential files:
 *   default        -> ~/.pi/agent/auth.json
 *   <name>         -> ~/.pi/agent/auth-profiles/<name>.json
 *
 * Profile selection order:
 *   1. current session override
 *   2. repository preferences (only when the project is trusted)
 *   3. host defaults
 *   4. global default
 *   5. "default"
 *
 * A session override changes the starting point without disabling usage checks.
 * New sessions bind the preferred profile; when it has no confirmed Codex usage, only
 * the Codex credential comes from the next profile with confirmed usage, without
 * redeeming reset credits.
 *
 * The extension resolves and binds the live AuthStorage backend before model
 * availability is checked, then rebinds it at session_start and on /profile
 * changes. The built-in /login, /logout, and OAuth token refresh therefore
 * all read and write the active profile's file — no restart required.
 *
 * Codex and Anthropic credentials resolve per provider: a pinned owner first, then
 * the bound profile and the other profiles in effective order (repository, host,
 * global), then auth.json, skipping owners exhausted until their usage resets.
 * /login saves to the bound profile; refresh and logout write back to whichever
 * file holds the credential in use. Other providers are shared through auth.json.
 *
 * A usage limit moves only that provider's credential to the next owner with
 * confirmed usage: Codex from x-codex-* headers or its limit message, Anthropic OAuth
 * from HTTP 429 rate_limit_error. The bound profile never changes on a limit.
 *
 * Commands:
 *   /profile                 show the active profile
 *   /profile list            list profiles and their providers
 *   /profile use <name>      prefer a profile in the current session
 *   /profile default <name>  set the global fallback profile
 *   /profile clear           restore automatic selection in this session
 *   /profiles status         show usage for all configured profiles
 *   /reset-credit [--dry-run] select and consume an earned reset credit
 */
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";

type InternalCredentials = { store?: CredentialStore };

type InternalRuntime = {
  credentials?: InternalCredentials;
  login: import("@earendil-works/pi-coding-agent").ModelRuntime["login"];
};

type BindProfileOptions = ProfileAuthFallbackCallbacks & {
  refresh?: boolean;
  route?: FallbackOwnerRoute;
};

type StartupSelection = {
  selection: ProfileSelection;
  sessionId: string | undefined;
  sessionProfile: string | undefined;
};

type AuthProfileDependencies = {
  now?: () => number;
  providerAdapter?: ProfileProviderAdapter;
  selectProfile?: typeof selectProfile;
  usageCollector?: typeof collectUsageStatus;
};

function credentialStoreBinding(ctx: Pick<ExtensionContext, "modelRegistry">): {
  credentials: InternalCredentials;
  store: CredentialStore;
  runtime: InternalRuntime;
} {
  // Pi no longer exposes its credential runtime to extensions, so this is the
  // narrow compatibility boundary used to replace only its active store.
  // SAFETY: installed Pi owns this private runtime; validate required ports below.
  const runtime = (ctx.modelRegistry as unknown as { runtime?: InternalRuntime }).runtime;
  const credentials = runtime?.credentials;
  const store = credentials?.store;
  if (
    credentials === undefined ||
    store === undefined ||
    runtime === undefined ||
    typeof runtime.login !== "function"
  ) {
    throw new Error(
      "Auth profiles is incompatible with this version of pi: credential storage cannot be switched.",
    );
  }
  return { credentials, store, runtime };
}

/** Point the session's live credential store at the profile's file. */
async function bindProfile(
  ctx: Pick<ExtensionContext, "modelRegistry">,
  selection: Pick<ProfileSelection, "profile" | "profileOrder">,
  adapter: ProfileProviderAdapter,
  options: BindProfileOptions = {},
): Promise<string> {
  const { profile } = selection;
  const path = authPathFor(profile);
  const { credentials, store } = credentialStoreBinding(ctx);
  credentials.store = await openProfileCredentials(
    adapter,
    profile,
    selection.profileOrder,
    options.route,
    options,
  );
  if (options.refresh === false) return path;

  const refresh = async (): Promise<void> => {
    // Keep provider availability in sync with the newly selected credential file.
    const errorBefore = ctx.modelRegistry.getError?.();
    const result = await ctx.modelRegistry.refresh({ allowNetwork: false });
    const errors = result?.errors;
    if (errors !== undefined && errors.size > 0) {
      throw new AggregateError(
        [...errors.values()],
        `Could not refresh auth profile ${profile} availability.`,
      );
    }
    const errorAfter = ctx.modelRegistry.getError?.();
    if (errorAfter !== undefined && errorAfter !== errorBefore) {
      throw new Error(`Could not refresh auth profile ${profile} availability: ${errorAfter}`);
    }
  };

  try {
    await refresh();
  } catch (switchError) {
    credentials.store = store;
    try {
      await refresh();
    } catch (rollbackError) {
      throw new AggregateError(
        [switchError, rollbackError],
        `Could not switch auth profile to ${profile} or refresh the restored profile.`,
      );
    }
    throw switchError;
  }
  return path;
}

function describeSelection(selection: ProfileSelection): string {
  const source =
    selection.source === "repository" && selection.repository
      ? `repository ${selection.repository.name}`
      : selection.source === "host default"
        ? `host ${selection.host.name}`
        : selection.source;
  // A usage-based fallback chooses only the Codex owner; `fallbackFrom` stays bound.
  return selection.fallbackFrom ? `${source}; Codex via ${selection.profile}` : source;
}

const USAGE_BAR_WIDTH = 14;

function usageColor(theme: Theme, remaining: number, value: string): string {
  if (remaining >= 75) return theme.fg("success", value);
  if (remaining >= 50) return theme.fg("warning", value);
  if (remaining >= 25) return theme.bold(theme.fg("warning", value));
  return theme.fg("error", value);
}

function renderUsageBar(theme: Theme, remaining: number): string {
  const clamped = Math.max(0, Math.min(100, remaining));
  const cells = (clamped / 100) * USAGE_BAR_WIDTH;
  const fullCells = Math.floor(cells);
  const partialCell = cells - fullCells >= 0.5 ? "╸" : "";
  const emptyCells = USAGE_BAR_WIDTH - fullCells - Number(partialCell !== "");
  const filled = `${"━".repeat(fullCells)}${partialCell}`;
  return `${filled ? usageColor(theme, clamped, filled) : ""}${theme.fg("dim", "─".repeat(emptyCells))}`;
}

function formatUsageWindow(
  theme: Theme,
  window: ProfileUsageStatus["usage"][number] | undefined,
): string {
  if (window === undefined) return theme.fg("muted", "unavailable");
  const remaining = usageColor(theme, window.remaining, `${window.remaining}% remaining`);
  const reset = window.resetsIn ? theme.fg("dim", `  resets ${window.resetsIn}`) : "";
  return `${renderUsageBar(theme, window.remaining)} ${remaining}${reset}`;
}

function durationUntil(timestamp: string, currentTime: number): string | undefined {
  const remaining = Date.parse(timestamp) - currentTime;
  if (Number.isFinite(remaining) === false) return undefined;
  if (remaining <= 0) return "now";
  if (remaining < 60_000) return `${Math.ceil(remaining / 1_000)}s`;
  if (remaining < 3_600_000) return `${Math.ceil(remaining / 60_000)}m`;
  if (remaining < 86_400_000) return `${Math.ceil(remaining / 3_600_000)}h`;
  return `${Math.ceil(remaining / 86_400_000)}d`;
}

function formatResetTokens(theme: Theme, profile: ProfileUsageStatus, currentTime: number): string {
  if (profile.availableCount === undefined) return theme.fg("muted", "unavailable");

  const value = `${profile.availableCount} available`;
  const count =
    profile.availableCount === 0 || profile.urgency === "unknown"
      ? theme.fg("muted", value)
      : theme.fg(
          profile.urgency === "urgent"
            ? "error"
            : profile.urgency === "soon"
              ? "warning"
              : "success",
          value,
        );
  const expiresIn = profile.nextExpiresAt
    ? durationUntil(profile.nextExpiresAt, currentTime)
    : undefined;
  return `${count}${expiresIn ? theme.fg("dim", `  expires in ${expiresIn}`) : ""}`;
}

function formatDiagnosticCode(code: string): string {
  if (code === "reset-credits-request-failed") return "banked resets request failed";
  return code.replaceAll("-", " ");
}

const OPENAI_BRAND = PROVIDER_BRANDS["openai-codex"];
const ANTHROPIC_BRAND = PROVIDER_BRANDS.anthropic;
function formatUsageStatus(status: UsageStatusPayload, theme: Theme, currentTime: number): string {
  const profiles = [...status.profiles].sort(
    (left, right) =>
      Number(right.active) - Number(left.active) ||
      left.profileLabel.localeCompare(right.profileLabel),
  );
  const sections = profiles.map((profile) => {
    const activeColor = profile.active ? "success" : "muted";
    const marker = theme.fg(activeColor, profile.active ? "*" : "-");
    const name = theme.fg("accent", theme.bold(profile.profileLabel));
    const state = theme.fg(activeColor, profile.active ? "active" : "inactive");
    const windows: Array<ProfileUsageStatus["usage"][number] | undefined> = [
      profile.usage[0],
      profile.usage[1],
      ...profile.usage.slice(2),
    ];
    const usageLines = windows.map((window, index) => {
      const label = index === 0 ? "primary" : index === 1 ? "secondary" : `window ${index + 1}`;
      return `    ${label.padEnd(14)}${formatUsageWindow(theme, window)}`;
    });
    const anthropicLines = (profile.anthropicUsage ?? []).map((window) => {
      const label =
        window.windowId === "primary" ? "5h" : window.windowId === "secondary" ? "7d" : "credit";
      const detail = window.detail ? theme.fg("dim", `  ${window.detail}`) : "";
      return `    ${label.padEnd(14)}${formatUsageWindow(theme, window)}${detail}`;
    });
    // Profiles without Codex credentials only carry Anthropic usage.
    const hasCodex =
      profile.usage.length > 0 ||
      profile.availableCount !== undefined ||
      anthropicLines.length === 0;
    const providerHeader = (brand: ProviderBrand | undefined, name: string) =>
      `  ${brand === undefined ? name : brandColor(brand.rgb, `${brand.icon} ${name}`)}`;
    return [
      `${marker} ${name} ${state}`,
      ...(hasCodex
        ? [
            providerHeader(OPENAI_BRAND, "OpenAI Codex"),
            ...usageLines,
            `    ${"banked resets".padEnd(14)}${formatResetTokens(theme, profile, currentTime)}`,
          ]
        : []),
      ...(anthropicLines.length > 0
        ? [providerHeader(ANTHROPIC_BRAND, "Anthropic"), ...anthropicLines]
        : []),
    ].join("\n");
  });

  if (sections.length === 0) {
    sections.push(theme.fg("muted", "No auth profiles with usable credentials."));
  }
  if (status.diagnostics.length > 0) {
    sections.push(
      [
        theme.fg("warning", theme.bold("Diagnostics")),
        ...status.diagnostics.map(
          ({ profileLabel, code }) =>
            `  ${theme.fg("muted", `${profileLabel}:`)} ${formatDiagnosticCode(code)}`,
        ),
      ].join("\n"),
    );
  }
  return sections.join("\n\n");
}

export type AuthObservationOptions = {
  /** Effective profile order used for fallback-provider lookup. */
  profileOrder?: readonly string[];
  /** Whether a profile's own auth file holds a credential for the provider. */
  hasCredential?: (profile: string, providerId: string) => boolean;
  /** Live fallback-provider routing, so status shows the owner requests actually use. */
  route?: FallbackOwnerRoute;
  /** The bound profile and the profile whose adapter-provider login serves it. */
  profileProviderOwner?: { profile: string; owner: string };
};

function fallbackProviderObservations(
  status: UsageStatusPayload,
  profileLabel: string,
  options: AuthObservationOptions,
): AuthProviderObservation[] {
  const hasCredential =
    options.hasCredential ?? ((profile, provider) => providersIn(profile).includes(provider));
  const byLabel = new Map(status.profiles.map((profile) => [profile.profileLabel, profile]));
  return [...PROFILE_FALLBACK_PROVIDERS].flatMap((provider) => {
    const owner = fallbackCredentialOwner(
      profileLabel,
      options.profileOrder ?? [],
      (profile) => hasCredential(profile, provider),
      options.route === undefined ? undefined : { providerId: provider, route: options.route },
    );
    if (owner === undefined) return [];
    // shortcut: only Anthropic reports fallback-provider usage today; add a per-provider
    // usage field on ProfileUsageStatus when a second fallback provider gains usage.
    const usage = provider === "anthropic" ? (byLabel.get(owner)?.anthropicUsage ?? []) : [];
    return [
      {
        provider,
        ...(owner === profileLabel ? {} : { borrowedFrom: owner }),
        windows: usage.flatMap((window) =>
          window.windowId === undefined
            ? []
            : [
                {
                  windowId: window.windowId,
                  remaining: window.remaining,
                  ...(window.allowanceResetAt === undefined
                    ? {}
                    : { allowanceResetAt: window.allowanceResetAt }),
                  ...(window.detail === undefined ? {} : { detail: window.detail }),
                },
              ],
        ),
      },
    ];
  });
}

function observedProfileWindows(profile: ProfileUsageStatus) {
  const observation = profile[AUTH_USAGE_OBSERVATION];
  if (observation === undefined) return [];
  const observedWindows =
    observation.windows.length > 0
      ? observation.windows
      : profile.usage.map((window, index) => ({
          ...window,
          windowId: index === 0 ? "primary" : index === 1 ? "secondary" : `window-${index + 1}`,
        }));
  return observedWindows.flatMap((window) =>
    window.windowId === undefined
      ? []
      : [
          {
            windowId: window.windowId,
            remaining: window.remaining,
            ...(window.allowanceResetAt === undefined
              ? {}
              : { allowanceResetAt: window.allowanceResetAt }),
          },
        ],
  );
}

export function authObservations(
  status: UsageStatusPayload,
  providerId: string,
  options: AuthObservationOptions = {},
): AuthProfileObservation[] {
  const failures = new Set(status.diagnostics.map(({ profileLabel }) => profileLabel));
  const byLabel = new Map(status.profiles.map((profile) => [profile.profileLabel, profile]));
  const borrowed = options.profileProviderOwner;
  return status.profiles.flatMap((profile) => {
    const observation = profile[AUTH_USAGE_OBSERVATION];
    if (observation === undefined) return [];
    const ownerProfile =
      borrowed !== undefined &&
      borrowed.profile === profile.profileLabel &&
      borrowed.owner !== profile.profileLabel
        ? byLabel.get(borrowed.owner)
        : undefined;
    const providers: AuthProviderObservation[] = [
      // The bound profile's Codex requests use another profile's login after a rotation.
      ...(ownerProfile === undefined
        ? []
        : [
            {
              provider: providerId,
              borrowedFrom: ownerProfile.profileLabel,
              windows: observedProfileWindows(ownerProfile),
            },
          ]),
      ...fallbackProviderObservations(status, profile.profileLabel, options),
    ];
    return [
      {
        profileLabel: profile.profileLabel,
        provider: providerId,
        windows: observedProfileWindows(profile),
        ...(observation.bankedResetCount === undefined
          ? {}
          : { bankedResetCount: observation.bankedResetCount }),
        ...(observation.bankedExpiryAt === undefined
          ? {}
          : { bankedExpiryAt: observation.bankedExpiryAt }),
        observedAt: observation.observedAt,
        staleAt: observation.staleAt,
        ...(providers.length === 0 ? {} : { providers }),
        ...(failures.has(profile.profileLabel) ? { error: "usage" as const } : {}),
      },
    ];
  });
}

export default function authProfiles(
  pi: ExtensionAPI,
  dependencies: AuthProfileDependencies = {},
): void {
  const loginBoundaries = new Map<InternalRuntime, () => void>();
  const chooseProfile = dependencies.selectProfile ?? selectProfile;
  const now = dependencies.now ?? Date.now;
  const providerAdapter = dependencies.providerAdapter ?? createOpenAiCodexProfileAdapter();
  const usageCollector = dependencies.usageCollector ?? collectUsageStatus;
  let activeProfile = DEFAULT_PROFILE;
  let sessionProfile: string | undefined;
  let startupSelection: StartupSelection | undefined;
  let activeSelection: ProfileSelection | undefined;
  // Each provider rotates its own credential owner; the bound profile never moves on a
  // usage limit. The live store reads this route on every request.
  const codexProviderId = providerAdapter.providerId;
  const fallbackExhaustedUntil = new Map<string, number>();
  const authRejectedOwners = new Set<string>();
  // Limits already handled, including ones with no confirmed alternate, so repeated
  // responses from an exhausted owner do not refetch usage until it resets.
  const limitSeenUntil = new Map<string, number>();
  const fallbackPins = new Map<string, { owner: string; until: number }>();
  const fallbackRequestOwners = new Map<string, string>();
  const fallbackKey = (providerId: string, owner: string) => `${providerId}\0${owner}`;
  const fallbackRoute: FallbackOwnerRoute = {
    pinned(providerId) {
      const pin = fallbackPins.get(providerId);
      return pin !== undefined && pin.until > now() ? pin.owner : undefined;
    },
    isExhausted(providerId, owner) {
      return (
        authRejectedOwners.has(fallbackKey(providerId, owner)) ||
        (fallbackExhaustedUntil.get(fallbackKey(providerId, owner)) ?? 0) > now()
      );
    },
  };
  const holdsFallbackCredential = (profile: string, providerId: string) =>
    providersIn(profile).includes(providerId);
  /** The profile whose credential the live store currently uses for `providerId`. */
  const currentFallbackOwner = (providerId: string) =>
    fallbackCredentialOwner(
      activeProfile,
      activeSelection?.profileOrder ?? [],
      (profile) => holdsFallbackCredential(profile, providerId),
      { providerId, route: fallbackRoute },
    );
  // Without any Codex credential on file the bound profile still serves requests.
  const codexServingOwner = () => currentFallbackOwner(codexProviderId) ?? activeProfile;

  const seenOwners = (providerId: string): Set<string> => {
    const currentTime = now();
    const prefix = fallbackKey(providerId, "");
    return new Set(
      [...limitSeenUntil]
        .filter(([key, until]) => key.startsWith(prefix) && until > currentTime)
        .map(([key]) => key.slice(prefix.length)),
    );
  };
  const pruneExpiredLimits = (currentTime: number) => {
    for (const map of [fallbackExhaustedUntil, limitSeenUntil]) {
      for (const [key, expiry] of map) if (expiry <= currentTime) map.delete(key);
    }
  };
  /**
   * Move `providerId` from an exhausted owner to `next` until the exhausted owner resets.
   * The pin skips unconfirmed owners ahead of `next` only until an earlier exhausted
   * owner resets; the profile order then applies again.
   */
  const switchOwner = (
    providerId: string,
    exhaustedOwner: string,
    next: string,
    resetAt: number,
  ) => {
    const currentTime = now();
    pruneExpiredLimits(currentTime);
    fallbackExhaustedUntil.set(fallbackKey(providerId, exhaustedOwner), resetAt);
    const chain = fallbackOwnerChain(activeProfile, activeSelection?.profileOrder ?? []);
    const earlierResets = chain.slice(0, Math.max(0, chain.indexOf(next))).flatMap((owner) => {
      const expiry = fallbackExhaustedUntil.get(fallbackKey(providerId, owner));
      return expiry !== undefined && expiry > currentTime ? [expiry] : [];
    });
    fallbackPins.set(providerId, {
      owner: next,
      until: earlierResets.length > 0 ? Math.min(...earlierResets) : resetAt,
    });
  };
  let fallbackPromise: Promise<void> | undefined;
  let publishedProfileStatus: string | undefined;
  let profileOperationTail: Promise<void> = Promise.resolve();
  let authStartupState: AuthStartupState = { profileOrder: [], observations: [] };
  let lastUsageStatus: UsageStatusPayload | undefined;
  let usageGeneration = 0;
  let usageContext: Pick<ExtensionContext, "mode"> | undefined;
  // Fallback-provider rows depend on the effective order, so observations are rebuilt
  // whenever either the usage status or the active selection changes.
  const observeUsage = (
    status: UsageStatusPayload,
    profileOrder: readonly string[] = authStartupState.profileOrder,
  ) => {
    lastUsageStatus = status;
    return authObservations(status, providerAdapter.providerId, {
      profileOrder,
      route: fallbackRoute,
      profileProviderOwner: { profile: activeProfile, owner: codexServingOwner() },
    });
  };
  const authStartupOwner = pi.events
    ? new AuthStartupOwner(pi.events, () => authStartupState)
    : undefined;
  const runGit: GitRunner = async (cwd, args) => {
    const result = await pi.exec("git", ["-C", cwd, ...args], { timeout: 2_000 });
    if (result.code !== 0) return undefined;
    const output = result.stdout.trim();
    return output === "" ? undefined : output;
  };

  const serializeProfileOperation = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = profileOperationTail.then(operation);
    profileOperationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const chooseCurrentProfile = (
    ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted">,
  ): Promise<ProfileSelection> =>
    chooseProfile(ctx, {
      ...(sessionProfile === undefined ? {} : { preferredProfile: sessionProfile }),
      providerAdapter,
      runGit,
      onUsageStatus(status) {
        authStartupState = {
          ...authStartupState,
          observations: observeUsage(status),
        };
      },
    });

  const collectAndPublishUsage = async (): Promise<UsageStatusPayload> => {
    const generation = ++usageGeneration;
    const publish = (status: UsageStatusPayload) => {
      if (generation !== usageGeneration) return;
      authStartupState = {
        ...authStartupState,
        activeProfile,
        observations: observeUsage(status),
      };
      authStartupOwner?.update();
    };
    const status = await usageCollector({
      activeProfile,
      includeDefault: true,
      providerAdapter,
      staleWhileRevalidate: true,
      onRevalidated(status) {
        publish(status);
        if (generation === usageGeneration && usageContext) {
          publishWezTermChange(usageContext, "usage", String(now()));
        }
      },
    });
    publish(status);
    return status;
  };

  const publishProfileStatus = (
    ctx: Pick<ExtensionContext, "mode" | "ui">,
    options: { onlyIfChanged?: boolean } = {},
  ) => {
    const codexOwner = currentFallbackOwner(codexProviderId);
    const label =
      codexOwner === undefined || codexOwner === activeProfile
        ? activeProfile
        : `${activeProfile} · Codex via ${codexOwner}`;
    if (options.onlyIfChanged === true && label === publishedProfileStatus) return;
    publishedProfileStatus = label;
    ctx.ui.setStatus(PROFILE_STATUS_KEY, label);
    // WezTerm's status shows Codex usage for this value, so it follows the Codex owner.
    publishWezTermChange(ctx, "profile", codexOwner ?? activeProfile);
  };

  const describeActive = (selection: ProfileSelection): string => {
    if (selection.fallbackFrom !== undefined || selection !== activeSelection) {
      return describeSelection(selection);
    }
    const codexOwner = codexServingOwner();
    const source = describeSelection(selection);
    return codexOwner === selection.profile ? source : `${source}; Codex via ${codexOwner}`;
  };

  const credentialsInUse = (): string => {
    if (activeSelection === undefined) return "";
    const owners = [...routedProviders].flatMap((providerId) => {
      const owner = currentFallbackOwner(providerId);
      return owner === undefined ? [] : [`${providerId} → ${owner}`];
    });
    return owners.length === 0 ? "" : `Credentials in use: ${owners.join(", ")}\n`;
  };
  const activateUnlocked = async (
    ctx: Pick<ExtensionContext, "modelRegistry" | "mode" | "ui">,
    selection: ProfileSelection,
    options: BindProfileOptions = {},
  ) => {
    const { runtime } = credentialStoreBinding(ctx);
    if (!loginBoundaries.has(runtime)) {
      loginBoundaries.set(
        runtime,
        installCredentialLoginBoundary(runtime, PROFILE_LOGIN_PROVIDERS, (providerId) => {
          authRejectedOwners.delete(fallbackKey(providerId, activeProfile));
        }),
      );
    }
    // Usage-based selection chooses the Codex owner; the profile it fell back from stays
    // bound, so Anthropic and /login keep following the preferred profile.
    const { fallbackFrom, ...rest } = selection;
    const bound: ProfileSelection = { ...rest, profile: fallbackFrom ?? selection.profile };
    const previousPin = fallbackPins.get(codexProviderId);
    if (selection.profile === bound.profile) fallbackPins.delete(codexProviderId);
    else {
      fallbackPins.set(codexProviderId, {
        owner: selection.profile,
        until: Number.POSITIVE_INFINITY,
      });
    }
    let path: string;
    try {
      path = await bindProfile(ctx, bound, providerAdapter, {
        ...options,
        route: fallbackRoute,
        onInvalidOAuthRefresh(providerId, owner) {
          authRejectedOwners.add(fallbackKey(providerId, owner));
          if (fallbackPins.get(providerId)?.owner === owner) fallbackPins.delete(providerId);
        },
        onOAuthFallback(_providerId, from, to) {
          ctx.ui.notify(
            `${from} Anthropic OAuth refresh was rejected; switched Anthropic to ${to}.`,
            "warning",
          );
        },
      });
    } catch (error) {
      if (previousPin === undefined) fallbackPins.delete(codexProviderId);
      else fallbackPins.set(codexProviderId, previousPin);
      throw error;
    }
    activeProfile = bound.profile;
    activeSelection = bound;
    authStartupState = {
      ...authStartupState,
      activeProfile,
      profileOrder: bound.profileOrder,
      ...(lastUsageStatus === undefined
        ? {}
        : { observations: observeUsage(lastUsageStatus, bound.profileOrder) }),
    };
    authStartupOwner?.update();
    publishProfileStatus(ctx);
    return { ...bound, path };
  };

  const rebind = (
    ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted" | "modelRegistry" | "mode" | "ui">,
  ) =>
    serializeProfileOperation(async () => activateUnlocked(ctx, await chooseCurrentProfile(ctx)));

  const changeSessionProfile = (
    ctx: Pick<
      ExtensionContext,
      "cwd" | "isProjectTrusted" | "modelRegistry" | "mode" | "sessionManager" | "ui"
    >,
    profile: string | undefined,
  ) =>
    serializeProfileOperation(async () => {
      const previousProfile = sessionProfile;
      persistSessionProfile(pi, ctx, profile);
      sessionProfile = profile;
      try {
        return await activateUnlocked(ctx, await chooseCurrentProfile(ctx));
      } catch (switchError) {
        sessionProfile = previousProfile;
        try {
          persistSessionProfile(pi, ctx, previousProfile);
        } catch (rollbackError) {
          throw new AggregateError(
            [switchError, rollbackError],
            "Could not change or restore the session auth profile preference.",
          );
        }
        throw switchError;
      }
    });

  const resolveProfileCredential = async (
    profile: string,
  ): Promise<{ accessToken: string; accountId: string }> => {
    const credential = await providerAdapter.resolveCredential(profile);
    return { accessToken: credential.accessToken, accountId: credential.identity };
  };

  pi.on("before_model_availability", async (_event, ctx) => {
    await serializeProfileOperation(async () => {
      sessionProfile = restoreSessionProfile(ctx);
      startupSelection = undefined;
      const selection = await chooseCurrentProfile(ctx);
      await activateUnlocked(ctx, selection, { refresh: false });
      startupSelection = {
        selection,
        sessionId: ctx.sessionManager.getHeader()?.id,
        sessionProfile,
      };
    });
  });

  pi.on("session_shutdown", () => {
    usageGeneration += 1;
    usageContext = undefined;
    authStartupOwner?.dispose();
    for (const dispose of loginBoundaries.values()) dispose();
    loginBoundaries.clear();
  });

  pi.on("session_start", async (_event, ctx) => {
    usageContext = ctx;
    const resolution = await serializeProfileOperation(async () => {
      sessionProfile = restoreSessionProfile(ctx);
      const cached = startupSelection;
      startupSelection = undefined;
      const selection =
        cached !== undefined &&
        cached.sessionId === ctx.sessionManager.getHeader()?.id &&
        cached.sessionProfile === sessionProfile
          ? cached.selection
          : await chooseCurrentProfile(ctx);
      return activateUnlocked(ctx, selection);
    });
    // Usage can update the header after activation; it must not hold up interactive startup.
    void serializeProfileOperation(async () => {
      await collectAndPublishUsage();
    }).catch(() => {});
    if (resolution.selectionWarning) {
      ctx.ui.notify(
        `No alternate profile was confirmed; using ${resolution.profile}: ${resolution.selectionWarning}`,
        "warning",
      );
    }
  });

  pi.on("agent_end", () => {
    if (usageContext === undefined) return;
    void collectAndPublishUsage().catch(() => {
      // Keep the existing display when a background cache read fails.
    });
  });

  const rotateCodexOwner = async (
    ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted" | "mode" | "ui">,
    resetAt: number,
    exhaustedOwner: string,
  ): Promise<void> => {
    const currentTime = now();
    const key = fallbackKey(codexProviderId, exhaustedOwner);
    if ((limitSeenUntil.get(key) ?? 0) > currentTime) {
      await fallbackPromise;
      return;
    }
    pruneExpiredLimits(currentTime);
    limitSeenUntil.set(key, resetAt);
    if (codexServingOwner() !== exhaustedOwner) return;

    if (fallbackPromise === undefined) {
      let operation: Promise<void>;
      operation = serializeProfileOperation(async () => {
        try {
          if (codexServingOwner() !== exhaustedOwner) return;
          const excludedProfiles = seenOwners(codexProviderId);
          const next = await chooseProfile(ctx, {
            allowUnconfirmedFallback: false,
            excludedProfiles,
            forceUsageRefresh: true,
            ...(sessionProfile === undefined ? {} : { preferredProfile: sessionProfile }),
            providerAdapter,
            runGit,
          });
          const stillServing = codexServingOwner() === exhaustedOwner;
          if (
            next.fallbackReason !== "confirmed usage" ||
            excludedProfiles.has(next.profile) ||
            !stillServing
          ) {
            if (stillServing) {
              ctx.ui.notify(
                `${exhaustedOwner} reached its Codex usage limit; no alternate profile has confirmed available Codex usage.`,
                "warning",
              );
            }
            return;
          }

          switchOwner(codexProviderId, exhaustedOwner, next.profile, resetAt);
          if (lastUsageStatus !== undefined) {
            authStartupState = { ...authStartupState, observations: observeUsage(lastUsageStatus) };
            authStartupOwner?.update();
          }
          publishProfileStatus(ctx);
          ctx.ui.notify(
            `${exhaustedOwner} reached its Codex usage limit; switched Codex to ${next.profile}. Retry the request.`,
            "warning",
          );
        } catch (error) {
          ctx.ui.notify(
            `Could not switch Codex after ${exhaustedOwner} reached its usage limit: ${error instanceof Error ? error.message : String(error)}`,
            "error",
          );
        }
      }).finally(() => {
        if (fallbackPromise === operation) fallbackPromise = undefined;
      });
      fallbackPromise = operation;
    }
    await fallbackPromise;
  };

  const rotateAnthropicOwner = (
    ctx: Pick<ExtensionContext, "ui">,
    exhaustedOwner: string,
    limit: { resetAt?: number },
  ): Promise<void> =>
    serializeProfileOperation(async () => {
      const providerId = ANTHROPIC_PROVIDER_ID;
      const key = fallbackKey(providerId, exhaustedOwner);
      // A concurrent failure from the same owner was already handled.
      if ((limitSeenUntil.get(key) ?? 0) > now()) return;
      // API-key 429s are per-minute rate limits, not plan usage limits.
      const entry = readJsonFile(authPathFor(exhaustedOwner))?.[providerId];
      if (typeof entry !== "object" || entry === null || !("type" in entry)) return;
      if (entry.type !== "oauth") return;
      const chain = fallbackOwnerChain(activeProfile, activeSelection?.profileOrder ?? []).filter(
        (profile) => holdsFallbackCredential(profile, providerId),
      );
      if (!chain.some((owner) => owner !== exhaustedOwner)) return;

      let status: UsageStatusPayload;
      try {
        status = await usageCollector({
          activeProfile,
          includeDefault: true,
          profileLabels: chain,
          providerAdapter,
        });
      } catch (error) {
        ctx.ui.notify(
          `Could not check Anthropic usage after ${exhaustedOwner} reached its limit: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
        return;
      }
      const usageOf = (owner: string) =>
        status.profiles.find((profile) => profile.profileLabel === owner)?.anthropicUsage;
      const currentTime = now();
      const resetAt =
        limit.resetAt ?? anthropicExhaustionResetAt(usageOf(exhaustedOwner), currentTime);
      pruneExpiredLimits(currentTime);
      limitSeenUntil.set(key, resetAt);
      const next = chain.find(
        (owner) =>
          owner !== exhaustedOwner &&
          !fallbackRoute.isExhausted(providerId, owner) &&
          hasConfirmedAnthropicUsage(usageOf(owner)),
      );
      if (next === undefined) {
        ctx.ui.notify(
          `${exhaustedOwner} reached its Anthropic usage limit; no alternate profile has confirmed available Anthropic usage.`,
          "warning",
        );
        return;
      }

      switchOwner(providerId, exhaustedOwner, next, resetAt);
      authStartupState = { ...authStartupState, observations: observeUsage(status) };
      authStartupOwner?.update();
      ctx.ui.notify(
        `${exhaustedOwner} reached its Anthropic usage limit; switched Anthropic to ${next}. Retry the request.`,
        "warning",
      );
    });

  const routedProviders = new Set([codexProviderId, ...PROFILE_FALLBACK_PROVIDERS]);

  pi.on("before_provider_headers", async (_event, ctx) => {
    await fallbackPromise;
    await profileOperationTail;
    const provider = ctx.model?.provider;
    // Record the serving owner now: a rotation can finish before this request's error ends.
    if (provider !== undefined && routedProviders.has(provider)) {
      const owner = currentFallbackOwner(provider);
      if (owner === undefined) fallbackRequestOwners.delete(provider);
      else fallbackRequestOwners.set(provider, owner);
    }
    // Pins and exhaustion expire by time, so refresh the label when routing moved back.
    publishProfileStatus(ctx, { onlyIfChanged: true });
  });

  const requestOwner = (providerId: string) =>
    fallbackRequestOwners.get(providerId) ?? currentFallbackOwner(providerId) ?? activeProfile;

  pi.on("after_provider_response", async (event, ctx) => {
    if (ctx.model?.provider !== codexProviderId) return;
    const resetAt = providerAdapter.usageLimitResetAt(event.headers, now());
    if (resetAt === undefined) return;

    const rotation = rotateCodexOwner(ctx, resetAt, requestOwner(codexProviderId));
    // Successful responses must remain consumable while selection runs.
    if (event.status >= 400) await rotation;
  });

  pi.on("message_end", async (event, ctx) => {
    if (event.message.role !== "assistant" || event.message.stopReason !== "error") return;
    if (ctx.model?.provider === ANTHROPIC_PROVIDER_ID) {
      const limit = anthropicUsageLimitFromMessage(event.message.errorMessage, now());
      if (limit === undefined) return;
      const owner =
        fallbackRequestOwners.get(ANTHROPIC_PROVIDER_ID) ??
        currentFallbackOwner(ANTHROPIC_PROVIDER_ID);
      fallbackRequestOwners.delete(ANTHROPIC_PROVIDER_ID);
      if (owner !== undefined) await rotateAnthropicOwner(ctx, owner, limit);
      return;
    }
    if (ctx.model?.provider !== codexProviderId) return;

    const resetAt = providerAdapter.usageLimitResetAtFromMessage(event.message.errorMessage, now());
    if (resetAt === undefined) return;
    await rotateCodexOwner(ctx, resetAt, requestOwner(codexProviderId));
  });

  pi.registerCommand("profiles", {
    description: "Show usage and banked reset status for all auth profiles",
    getArgumentCompletions: (prefix) =>
      "status".startsWith(prefix) ? [{ value: "status", label: "status" }] : [],
    handler: async (args, ctx) => {
      const usage = "Usage: /profiles status";
      if (args.trim() !== "status") {
        ctx.ui.notify(usage, "warning");
        return;
      }

      try {
        await profileOperationTail;
        const status = await collectAndPublishUsage();
        ctx.ui.notify(
          formatUsageStatus(status, ctx.ui.theme, now()),
          status.diagnostics.length > 0 ? "warning" : "info",
        );
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerCommand("profile", {
    description: "Manage auth profiles: show | list | use <name> | default <name> | clear",
    getArgumentCompletions: (prefix) => {
      const words = prefix.split(/\s+/);
      const command = words[0] ?? "";
      const items =
        words.length <= 1
          ? ["show", "list", "use", "default", "clear"]
          : ["use", "default"].includes(command)
            ? listProfiles().map((name) => `${command} ${name}`)
            : [];
      return items
        .filter((item) => item.startsWith(prefix))
        .map((value) => ({ value, label: value }));
    },
    handler: async (args, ctx) => {
      const [command, rawName] = args.trim().split(/\s+/).filter(Boolean);
      const usage = "Usage: /profile [show|list|use <name>|default <name>|clear]";
      try {
        switch (command ?? "show") {
          case "show": {
            const resolution =
              activeSelection ?? (await chooseProfile(ctx, { providerAdapter, runGit }));
            const providers = providersIn(resolution.fallbackFrom ?? resolution.profile);
            const repository = resolution.repository
              ? `${resolution.repository.name} (${resolution.repository.source})`
              : "not resolved";
            const repositoryPreferences = resolution.repositoryPreferences.length
              ? resolution.repositoryPreferences.join(", ")
              : "none";
            const hostPreferences = resolution.hostPreferences.length
              ? resolution.hostPreferences.join(", ")
              : "none";
            const warning = resolution.selectionWarning
              ? `\nSelection warning: ${resolution.selectionWarning}`
              : "";
            ctx.ui.notify(
              `Auth profile: ${resolution.fallbackFrom ?? resolution.profile} (${describeActive(resolution)})\n` +
                `Host: ${resolution.host.name} (${resolution.host.source})\n` +
                `Repository: ${repository}\n` +
                `Repository order: ${repositoryPreferences}\n` +
                `Host order: ${hostPreferences}\n` +
                `Effective order: ${resolution.profileOrder.join(", ")}\n` +
                `File: ${authPathFor(resolution.fallbackFrom ?? resolution.profile)}\n` +
                credentialsInUse() +
                `Providers: ${providers.length ? providers.join(", ") : "none — run /login"}` +
                warning,
              "info",
            );
            return;
          }
          case "list": {
            const lines = listProfiles().map((name) => {
              const marker = name === activeProfile ? "* " : "  ";
              const providers = providersIn(name);
              return `${marker}${name} (${providers.length ? providers.join(", ") : "no credentials"})`;
            });
            ctx.ui.notify(lines.join("\n"), "info");
            return;
          }
          case "use": {
            if (!rawName) return ctx.ui.notify(usage, "warning");
            const profile = normalizeName(rawName);
            const { path } = await changeSessionProfile(ctx, profile);
            ctx.ui.notify(
              `Session auth profile preference set to ${profile}. Active profile: ${activeProfile}. /login now saves to ${path}`,
              "info",
            );
            return;
          }
          case "default": {
            if (!rawName) return ctx.ui.notify(usage, "warning");
            const profile = normalizeName(rawName);
            updateJsonFile(globalConfigPath(), (config) => {
              config.defaultProfile = profile;
            });
            const resolution = await rebind(ctx);
            ctx.ui.notify(
              `Global default auth profile set to ${profile}. Active profile: ${resolution.profile} (${describeActive(resolution)})`,
              "info",
            );
            return;
          }
          case "clear": {
            const resolution = await changeSessionProfile(ctx, undefined);
            ctx.ui.notify(
              `Session auth profile cleared. Active profile: ${resolution.profile} (${describeActive(resolution)})`,
              "info",
            );
            return;
          }
          default:
            ctx.ui.notify(usage, "warning");
        }
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  if (providerAdapter.providerId === "openai-codex") {
    registerResetCreditCommand(pi, {
      resolveCredential: resolveProfileCredential,
      onConsumed: () => {
        void collectAndPublishUsage().catch(() => {
          // Reset consumption succeeded even if refreshing its display fails.
        });
      },
    });
  }
}
