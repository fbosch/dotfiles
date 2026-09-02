/**
 * Vendored from @nanstey/pi-auth-profiles@0.1.1.
 * npm integrity: sha512-AMg/Xl5KVcuLTs2ig+dQx27Q3iKRd3+vae07yIfNzpf1dCcyQ7V8a3EKwvWrbwhTQjK6/+Z63wNgaeI1W4auYA==
 * Local changes: repository formatting, type-safety guards, active-profile status publishing,
 * WezTerm status invalidation, a usage-status data source, and repository-compatible JSON
 * indentation.
 * License: MIT; see LICENSE in this directory.
 */

import { existsSync } from "node:fs";
import {
  authPathFor,
  DEFAULT_PROFILE,
  globalConfigPath,
  listProfiles,
  normalizeName,
  PROFILE_STATUS_KEY,
  projectSettingsPath,
  providersIn,
  publishWezTermChange,
  readJsonFile,
  resolveProfile,
  updateJsonFile,
} from "./profile-store";
import { registerResetCreditCommand } from "./reset-credit";

export { authPathFor, resolveProfile } from "./profile-store";

/**
 * auth-profiles — per-project OAuth/API-key credential profiles for pi.
 *
 * Profiles are separate credential files:
 *   default        -> ~/.pi/agent/auth.json
 *   <name>         -> ~/.pi/agent/auth-profiles/<name>.json
 *
 * Profile selection (first match wins):
 *   1. "authProfile" in <cwd>/.pi/settings.json   (only when the project is trusted)
 *   2. "defaultProfile" in ~/.pi/agent/auth-profiles.json
 *   3. "default"
 *
 * The extension rebinds the live AuthStorage backend at session_start and on
 * /profile changes, so the built-in /login, /logout, and OAuth token refresh
 * all read and write the active profile's file — no restart required.
 *
 * Commands:
 *   /profile                 show the active profile
 *   /profile list            list profiles and their providers
 *   /profile use <name>      set this project's profile (writes .pi/settings.json)
 *   /profile default <name>  set the global fallback profile
 *   /profile clear           remove this project's profile setting
 *   /reset-credit [--dry-run] select and consume an earned reset credit
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type InternalAuthStorage = {
  constructor: { create(path?: string): InternalAuthStorage };
};

type InternalRuntime = {
  credentials?: { store?: InternalAuthStorage };
  forceRefreshAvailability?: () => Promise<unknown>;
};

/** Point the session's live credential store at the profile's file. */
async function bindProfile(
  ctx: Pick<ExtensionContext, "modelRegistry">,
  profile: string,
): Promise<string> {
  const path = authPathFor(profile);
  // Pi no longer exposes its file-auth backend to extensions. Reuse the active
  // store's factory so Pi retains its own locking, permissions, and reload logic.
  const runtime = (ctx.modelRegistry as unknown as { runtime?: InternalRuntime }).runtime;
  const store = runtime?.credentials?.store;
  const create = store?.constructor?.create;
  if (
    runtime === undefined ||
    runtime.credentials === undefined ||
    store === undefined ||
    typeof create !== "function"
  ) {
    throw new Error(
      "Auth profiles is incompatible with this version of pi: credential storage cannot be switched.",
    );
  }
  runtime.credentials.store = create.call(store.constructor, path);

  // Switching after startup otherwise leaves the model availability snapshot
  // based on the previously selected profile.
  if (typeof runtime.forceRefreshAvailability === "function") {
    await runtime.forceRefreshAvailability();
  }
  return path;
}

export default function authProfiles(pi: ExtensionAPI): void {
  let activeProfile = DEFAULT_PROFILE;

  const rebind = async (
    ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted" | "modelRegistry" | "mode" | "ui">,
  ) => {
    const { profile, source } = resolveProfile(ctx);
    const path = await bindProfile(ctx, profile);
    activeProfile = profile;
    ctx.ui.setStatus(PROFILE_STATUS_KEY, profile);
    publishWezTermChange(ctx, "profile", profile);
    return { profile, source, path };
  };

  const resolveProfileCredential = async (
    profile: string,
    ctx: ExtensionContext,
  ): Promise<{ accessToken: string; accountId: string }> => {
    const previousProfile = activeProfile;
    const profileWasSwitched = previousProfile !== profile;
    if (profileWasSwitched) {
      await bindProfile(ctx, profile);
    }

    try {
      const resolved = await ctx.modelRegistry.getProviderAuth("openai-codex");
      const stored = readJsonFile(authPathFor(profile))?.["openai-codex"];
      const storedRecord =
        typeof stored === "object" && stored !== null && !Array.isArray(stored)
          ? (stored as Record<string, unknown>)
          : undefined;
      const accountId =
        typeof storedRecord?.accountId === "string" &&
        /^[A-Za-z0-9._-]{1,200}$/.test(storedRecord.accountId)
          ? storedRecord.accountId
          : undefined;
      const accessToken = resolved?.auth.apiKey;
      if (typeof accessToken !== "string" || accessToken.length === 0 || accountId === undefined) {
        throw new Error(`Profile ${profile} has no usable OpenAI Codex OAuth credential.`);
      }
      return { accessToken, accountId };
    } finally {
      if (profileWasSwitched) {
        await bindProfile(ctx, previousProfile);
      }
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    const { profile, source } = await rebind(ctx);
    if (profile !== DEFAULT_PROFILE) {
      ctx.ui.notify(`Auth profile: ${profile} (${source})`, "info");
    }
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
            const { profile, source } = resolveProfile(ctx);
            const providers = providersIn(profile);
            ctx.ui.notify(
              `Auth profile: ${profile} (${source})\n` +
                `File: ${authPathFor(profile)}\n` +
                `Providers: ${providers.length ? providers.join(", ") : "none — run /login"}`,
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
            if (!ctx.isProjectTrusted()) {
              ctx.ui.notify(
                "Project is not trusted; cannot set a project auth profile here.",
                "error",
              );
              return;
            }
            updateJsonFile(projectSettingsPath(ctx.cwd), (settings) => {
              settings.authProfile = profile;
            });
            const { path } = await rebind(ctx);
            ctx.ui.notify(
              `Project auth profile set to ${profile}. /login now saves to ${path}`,
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
            const { profile: active, source } = await rebind(ctx);
            ctx.ui.notify(
              `Global default auth profile set to ${profile}. Active profile: ${active} (${source})`,
              "info",
            );
            return;
          }
          case "clear": {
            const path = projectSettingsPath(ctx.cwd);
            if (existsSync(path)) {
              updateJsonFile(path, (settings) => {
                delete settings.authProfile;
              });
            }
            const { profile, source } = await rebind(ctx);
            ctx.ui.notify(
              `Project auth profile cleared. Active profile: ${profile} (${source})`,
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
