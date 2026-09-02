/**
 * Vendored from @nanstey/pi-auth-profiles@0.1.1.
 * npm integrity: sha512-AMg/Xl5KVcuLTs2ig+dQx27Q3iKRd3+vae07yIfNzpf1dCcyQ7V8a3EKwvWrbwhTQjK6/+Z63wNgaeI1W4auYA==
 * Local changes: repository formatting, type-safety guards, active-profile status publishing,
 * WezTerm status invalidation, a usage-status data source, and repository-compatible JSON
 * indentation.
 * License: MIT; see LICENSE in this directory.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const DEFAULT_PROFILE = "default";
const PROFILE_STATUS_KEY = "auth-profile";
const WEZTERM_PROFILE_USER_VAR = "pi_profile_changed";

const profilesDir = (agentDir = getAgentDir()) => join(agentDir, "auth-profiles");
const globalConfigPath = (agentDir = getAgentDir()) => join(agentDir, "auth-profiles.json");
const projectSettingsPath = (cwd: string) => join(cwd, ".pi", "settings.json");

export function normalizeName(name: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return DEFAULT_PROFILE;
  if (trimmed !== DEFAULT_PROFILE && !/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new Error(
      `Invalid profile name "${trimmed}". Use letters, numbers, dots, underscores, and dashes.`,
    );
  }
  if (trimmed === "." || trimmed === "..") {
    throw new Error(`Invalid profile name "${trimmed}".`);
  }
  return trimmed;
}

export function authPathFor(profile: string, agentDir = getAgentDir()): string {
  return profile === DEFAULT_PROFILE
    ? join(agentDir, "auth.json")
    : join(profilesDir(agentDir), `${profile}.json`);
}

function readJsonFile(path: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

export function resolveProfile(
  ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted">,
  agentDir = getAgentDir(),
): {
  profile: string;
  source: string;
} {
  if (ctx.isProjectTrusted()) {
    const project = readJsonFile(projectSettingsPath(ctx.cwd))?.authProfile;
    if (typeof project === "string" && project.trim()) {
      return { profile: normalizeName(project), source: "project" };
    }
  }
  const global = readJsonFile(globalConfigPath(agentDir))?.defaultProfile;
  if (typeof global === "string" && global.trim()) {
    return { profile: normalizeName(global), source: "global default" };
  }
  return { profile: DEFAULT_PROFILE, source: "built-in default" };
}

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

export function listProfiles(agentDir = getAgentDir()): string[] {
  const names = [DEFAULT_PROFILE];
  if (existsSync(profilesDir(agentDir))) {
    for (const file of readdirSync(profilesDir(agentDir)).sort()) {
      if (file.endsWith(".json") && !file.endsWith(".lock")) {
        names.push(file.slice(0, -".json".length));
      }
    }
  }
  return names;
}

function providersIn(profile: string): string[] {
  return Object.keys(readJsonFile(authPathFor(profile)) ?? {});
}

function publishProfileChange(ctx: Pick<ExtensionContext, "mode">, profile: string): void {
  if (ctx.mode !== "tui" || !process.stdout.isTTY) return;

  const encoded = Buffer.from(profile).toString("base64");
  const sequence = `\u001b]1337;SetUserVar=${WEZTERM_PROFILE_USER_VAR}=${encoded}\u0007`;
  process.stdout.write(process.env.TMUX ? `\u001bPtmux;\u001b${sequence}\u001b\\` : sequence);
}

function updateJsonFile(path: string, update: (data: Record<string, unknown>) => void): void {
  let data: Record<string, unknown> = {};
  if (existsSync(path)) {
    const parsed = readJsonFile(path);
    if (parsed === undefined) {
      throw new Error(`${path} exists but is not valid JSON; not overwriting it.`);
    }
    data = parsed;
  }
  update(data);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
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
    publishProfileChange(ctx, profile);
    return { profile, source, path };
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
}
