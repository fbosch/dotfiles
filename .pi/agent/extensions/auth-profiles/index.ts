/**
 * Vendored from @nanstey/pi-auth-profiles@0.1.1.
 * npm integrity: sha512-AMg/Xl5KVcuLTs2ig+dQx27Q3iKRd3+vae07yIfNzpf1dCcyQ7V8a3EKwvWrbwhTQjK6/+Z63wNgaeI1W4auYA==
 * Local changes: repository formatting, type-safety guards, active-profile status publishing,
 * WezTerm status invalidation, a usage-status data source, a reset-credit command, and
 * repository-compatible JSON indentation.
 * License: MIT; see LICENSE in this directory.
 */

import type { CredentialStore } from "@earendil-works/pi-ai";
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
  updateJsonFile,
} from "./profile-store";
import type { ProfileProviderAdapter } from "./provider-adapter";
import { createOpenAiCodexProfileAdapter } from "./providers/openai-codex";
import { registerResetCreditCommand } from "./reset-credit";
import { persistSessionProfile, restoreSessionProfile } from "./session-profile";
import {
  collectUsageStatus,
  type ProfileUsageStatus,
  type UsageStatusPayload,
} from "./usage-status-service";

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
 * New sessions start from automatic routing, and exhausted profiles rotate to the
 * next account with confirmed Codex usage without redeeming reset credits.
 *
 * The extension rebinds the live AuthStorage backend at session_start and on
 * /profile changes, so the built-in /login, /logout, and OAuth token refresh
 * all read and write the active profile's file — no restart required.
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
} {
  // Pi no longer exposes its credential runtime to extensions, so this is the
  // narrow compatibility boundary used to replace only its active store.
  const runtime = (ctx.modelRegistry as unknown as { runtime?: InternalRuntime }).runtime;
  const credentials = runtime?.credentials;
  const store = credentials?.store;
  if (credentials === undefined || store === undefined) {
    throw new Error(
      "Auth profiles is incompatible with this version of pi: credential storage cannot be switched.",
    );
  }
  return { credentials, store };
}

/** Point the session's live credential store at the profile's file. */
async function bindProfile(
  ctx: Pick<ExtensionContext, "modelRegistry">,
  profile: string,
  adapter: ProfileProviderAdapter,
): Promise<string> {
  const path = authPathFor(profile);
  const { credentials, store } = credentialStoreBinding(ctx);
  credentials.store = await adapter.createCredentialStore(profile);
  try {
    // Keep provider availability in sync with the newly selected credential file.
    await ctx.modelRegistry.refresh({ allowNetwork: false });
  } catch (switchError) {
    credentials.store = store;
    try {
      await ctx.modelRegistry.refresh({ allowNetwork: false });
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
  return selection.fallbackFrom ? `${source}; ${selection.fallbackFrom} unavailable` : source;
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
      return `  ${label.padEnd(13)}${formatUsageWindow(theme, window)}`;
    });
    return [
      `${marker} ${name} ${state}`,
      ...usageLines,
      `  ${"reset tokens".padEnd(13)}${formatResetTokens(theme, profile, currentTime)}`,
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
            `  ${theme.fg("muted", `${profileLabel}:`)} ${code.replaceAll("-", " ")}`,
        ),
      ].join("\n"),
    );
  }
  return sections.join("\n\n");
}

export default function authProfiles(
  pi: ExtensionAPI,
  dependencies: AuthProfileDependencies = {},
): void {
  const chooseProfile = dependencies.selectProfile ?? selectProfile;
  const now = dependencies.now ?? Date.now;
  const providerAdapter = dependencies.providerAdapter ?? createOpenAiCodexProfileAdapter();
  const usageCollector = dependencies.usageCollector ?? collectUsageStatus;
  let activeProfile = DEFAULT_PROFILE;
  let sessionProfile: string | undefined;
  let activeSelection: ProfileSelection | undefined;
  const exhaustedUntil = new Map<string, number>();
  let fallbackPromise: Promise<void> | undefined;
  let lastProviderResponseProfile: string | undefined;
  let profileOperationTail: Promise<void> = Promise.resolve();
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
    });

  const activateUnlocked = async (
    ctx: Pick<ExtensionContext, "modelRegistry" | "mode" | "ui">,
    selection: ProfileSelection,
  ) => {
    const path = await bindProfile(ctx, selection.profile, providerAdapter);
    activeProfile = selection.profile;
    activeSelection = selection;
    ctx.ui.setStatus(PROFILE_STATUS_KEY, selection.profile);
    publishWezTermChange(ctx, "profile", selection.profile);
    return { ...selection, path };
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

  pi.on("session_start", async (_event, ctx) => {
    const resolution = await serializeProfileOperation(async () => {
      sessionProfile = restoreSessionProfile(ctx);
      return activateUnlocked(ctx, await chooseCurrentProfile(ctx));
    });
    if (resolution.selectionWarning) {
      ctx.ui.notify(
        `Auth profile usage selection unavailable; using ${resolution.profile}: ${resolution.selectionWarning}`,
        "warning",
      );
    }
    if (resolution.profile !== DEFAULT_PROFILE) {
      ctx.ui.notify(
        `Auth profile: ${resolution.profile} (${describeSelection(resolution)})`,
        "info",
      );
    }
  });

  const rotateAfterExhaustion = async (
    ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted" | "modelRegistry" | "mode" | "ui">,
    resetAt: number,
    exhaustedProfile = activeProfile,
  ): Promise<void> => {
    const currentTime = now();
    if ((exhaustedUntil.get(exhaustedProfile) ?? 0) > currentTime) {
      await fallbackPromise;
      return;
    }
    exhaustedUntil.set(exhaustedProfile, resetAt);
    for (const [profile, expiry] of exhaustedUntil) {
      if (expiry <= currentTime) exhaustedUntil.delete(profile);
    }
    if (activeProfile !== exhaustedProfile) return;

    if (fallbackPromise === undefined) {
      let operation: Promise<void>;
      operation = serializeProfileOperation(async () => {
        try {
          if (activeProfile !== exhaustedProfile) return;
          const next = await chooseProfile(ctx, {
            allowUnconfirmedFallback: false,
            excludedProfiles: new Set(exhaustedUntil.keys()),
            forceUsageRefresh: true,
            ...(sessionProfile === undefined ? {} : { preferredProfile: sessionProfile }),
            providerAdapter,
            runGit,
          });
          if (
            next.fallbackReason !== "confirmed usage" ||
            exhaustedUntil.has(next.profile) ||
            activeProfile !== exhaustedProfile
          ) {
            if (activeProfile === exhaustedProfile) {
              ctx.ui.notify(
                `${exhaustedProfile} exhausted; no alternate auth profile has confirmed usage.`,
                "warning",
              );
            }
            return;
          }

          await activateUnlocked(ctx, next);
          ctx.ui.notify(
            `${exhaustedProfile} exhausted; switched to ${next.profile}. Retry the request.`,
            "warning",
          );
        } catch (error) {
          ctx.ui.notify(
            `${exhaustedProfile} exhausted; auth profile fallback failed: ${error instanceof Error ? error.message : String(error)}`,
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

  pi.on("turn_start", () => {
    lastProviderResponseProfile = undefined;
  });

  pi.on("before_provider_headers", async () => {
    await fallbackPromise;
    await profileOperationTail;
  });

  pi.on("after_provider_response", async (event, ctx) => {
    if (ctx.model?.provider !== providerAdapter.providerId) return;

    const responseProfile = activeProfile;
    lastProviderResponseProfile = responseProfile;
    const resetAt = providerAdapter.usageLimitResetAt(event.headers, now());
    if (resetAt === undefined) return;

    const rotation = rotateAfterExhaustion(ctx, resetAt, responseProfile);
    // Successful responses must remain consumable while selection runs.
    if (event.status >= 400) await rotation;
  });

  pi.on("message_end", async (event, ctx) => {
    if (
      ctx.model?.provider !== providerAdapter.providerId ||
      event.message.role !== "assistant" ||
      event.message.stopReason !== "error"
    ) {
      return;
    }

    const resetAt = providerAdapter.usageLimitResetAtFromMessage(event.message.errorMessage, now());
    if (resetAt === undefined) return;
    const responseProfile = lastProviderResponseProfile ?? activeProfile;
    lastProviderResponseProfile = undefined;
    await rotateAfterExhaustion(ctx, resetAt, responseProfile);
  });

  pi.registerCommand("profiles", {
    description: "Show usage and reset-token status for all auth profiles",
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
        const status = await usageCollector({
          activeProfile,
          includeDefault: true,
          providerAdapter,
        });
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
            const providers = providersIn(resolution.profile);
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
              `Auth profile: ${resolution.profile} (${describeSelection(resolution)})\n` +
                `Host: ${resolution.host.name} (${resolution.host.source})\n` +
                `Repository: ${repository}\n` +
                `Repository order: ${repositoryPreferences}\n` +
                `Host order: ${hostPreferences}\n` +
                `Effective order: ${resolution.profileOrder.join(", ")}\n` +
                `File: ${authPathFor(resolution.profile)}\n` +
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
              `Global default auth profile set to ${profile}. Active profile: ${resolution.profile} (${describeSelection(resolution)})`,
              "info",
            );
            return;
          }
          case "clear": {
            const resolution = await changeSessionProfile(ctx, undefined);
            ctx.ui.notify(
              `Session auth profile cleared. Active profile: ${resolution.profile} (${describeSelection(resolution)})`,
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
    registerResetCreditCommand(pi, { resolveCredential: resolveProfileCredential });
  }
}
