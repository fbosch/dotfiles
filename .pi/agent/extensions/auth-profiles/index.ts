/**
 * Vendored from @nanstey/pi-auth-profiles@0.1.1.
 * npm integrity: sha512-AMg/Xl5KVcuLTs2ig+dQx27Q3iKRd3+vae07yIfNzpf1dCcyQ7V8a3EKwvWrbwhTQjK6/+Z63wNgaeI1W4auYA==
 * Local changes: repository formatting, type-safety guards, active-profile status publishing,
 * WezTerm status invalidation, a usage-status data source, a reset-credit command, and
 * repository-compatible JSON indentation.
 * License: MIT; see LICENSE in this directory.
 */

import type { GitRunner } from "./profile-resolver";
import {
  codexUsageLimitResetAt,
  codexUsageLimitResetAtFromMessage,
  type ProfileSelection,
  selectProfile,
} from "./profile-selector";
import {
  accountIdFor,
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
import { registerResetCreditCommand } from "./reset-credit";
import { persistSessionProfile, restoreSessionProfile } from "./session-profile";

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
 *   /reset-credit [--dry-run] select and consume an earned reset credit
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type InternalAuthStorage = {
  constructor: { create(path?: string): InternalAuthStorage };
};

type InternalCredentials = { store?: InternalAuthStorage };

type InternalRuntime = {
  credentials?: InternalCredentials;
};

type AuthProfileDependencies = {
  now?: () => number;
  selectProfile?: typeof selectProfile;
};

function credentialStoreBinding(ctx: Pick<ExtensionContext, "modelRegistry">): {
  credentials: InternalCredentials;
  store: InternalAuthStorage;
} {
  // Pi no longer exposes its file-auth backend to extensions. Reuse the active
  // store's factory so Pi retains its own locking, permissions, and reload logic.
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
): Promise<string> {
  const path = authPathFor(profile);
  const { credentials, store } = credentialStoreBinding(ctx);
  const create = store.constructor?.create;
  if (typeof create !== "function") {
    throw new Error(
      "Auth profiles is incompatible with this version of pi: credential storage cannot be switched.",
    );
  }

  credentials.store = create.call(store.constructor, path);
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

export default function authProfiles(
  pi: ExtensionAPI,
  dependencies: AuthProfileDependencies = {},
): void {
  const chooseProfile = dependencies.selectProfile ?? selectProfile;
  const now = dependencies.now ?? Date.now;
  let activeProfile = DEFAULT_PROFILE;
  let sessionProfile: string | undefined;
  let activeSelection: ProfileSelection | undefined;
  const exhaustedUntil = new Map<string, number>();
  let fallbackPromise: Promise<void> | undefined;
  let lastProviderResponseProfile: string | undefined;
  const runGit: GitRunner = async (cwd, args) => {
    const result = await pi.exec("git", ["-C", cwd, ...args], { timeout: 2_000 });
    if (result.code !== 0) return undefined;
    const output = result.stdout.trim();
    return output === "" ? undefined : output;
  };

  const activate = async (
    ctx: Pick<ExtensionContext, "modelRegistry" | "mode" | "ui">,
    selection: ProfileSelection,
  ) => {
    const path = await bindProfile(ctx, selection.profile);
    activeProfile = selection.profile;
    activeSelection = selection;
    ctx.ui.setStatus(PROFILE_STATUS_KEY, selection.profile);
    publishWezTermChange(ctx, "profile", selection.profile);
    return { ...selection, path };
  };

  const rebind = async (
    ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted" | "modelRegistry" | "mode" | "ui">,
  ) =>
    activate(
      ctx,
      await chooseProfile(ctx, {
        ...(sessionProfile === undefined ? {} : { preferredProfile: sessionProfile }),
        runGit,
      }),
    );

  const changeSessionProfile = async (
    ctx: Pick<
      ExtensionContext,
      "cwd" | "isProjectTrusted" | "modelRegistry" | "mode" | "sessionManager" | "ui"
    >,
    profile: string | undefined,
  ) => {
    const previousProfile = sessionProfile;
    persistSessionProfile(pi, ctx, profile);
    sessionProfile = profile;
    try {
      return await rebind(ctx);
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
  };

  const resolveProfileCredential = async (
    profile: string,
    ctx: ExtensionContext,
  ): Promise<{ accessToken: string; accountId: string }> => {
    const previousProfile = activeProfile;
    const profileWasSwitched = previousProfile !== profile;
    const originalStore = credentialStoreBinding(ctx).store;
    if (profileWasSwitched) {
      await bindProfile(ctx, profile);
    }

    try {
      const resolved = await ctx.modelRegistry.getProviderAuth("openai-codex");
      const accountId = accountIdFor(profile);
      const accessToken = resolved?.auth.apiKey;
      if (typeof accessToken !== "string" || accessToken.length === 0 || accountId === undefined) {
        throw new Error(`Profile ${profile} has no usable OpenAI Codex OAuth credential.`);
      }
      return { accessToken, accountId };
    } finally {
      if (profileWasSwitched) {
        const { credentials } = credentialStoreBinding(ctx);
        credentials.store = originalStore;
        await ctx.modelRegistry.refresh({ allowNetwork: false });
      }
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    sessionProfile = restoreSessionProfile(ctx);
    const resolution = await rebind(ctx);
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
      operation = (async () => {
        try {
          const next = await chooseProfile(ctx, {
            allowUnconfirmedFallback: false,
            excludedProfiles: new Set(exhaustedUntil.keys()),
            forceUsageRefresh: true,
            ...(sessionProfile === undefined ? {} : { preferredProfile: sessionProfile }),
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

          await activate(ctx, next);
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
      })().finally(() => {
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
  });

  pi.on("after_provider_response", async (event, ctx) => {
    if (ctx.model?.provider !== "openai-codex") return;

    const responseProfile = activeProfile;
    lastProviderResponseProfile = responseProfile;
    const resetAt = codexUsageLimitResetAt(event.headers, now());
    if (resetAt === undefined) return;

    const rotation = rotateAfterExhaustion(ctx, resetAt, responseProfile);
    // Successful responses must remain consumable while selection runs.
    if (event.status >= 400) await rotation;
  });

  pi.on("message_end", async (event, ctx) => {
    if (
      ctx.model?.provider !== "openai-codex" ||
      event.message.role !== "assistant" ||
      event.message.stopReason !== "error"
    ) {
      return;
    }

    const resetAt = codexUsageLimitResetAtFromMessage(event.message.errorMessage, now());
    if (resetAt === undefined) return;
    const responseProfile = lastProviderResponseProfile ?? activeProfile;
    lastProviderResponseProfile = undefined;
    await rotateAfterExhaustion(ctx, resetAt, responseProfile);
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
            const resolution = activeSelection ?? (await chooseProfile(ctx, { runGit }));
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

  registerResetCreditCommand(pi, { resolveCredential: resolveProfileCredential });
}
