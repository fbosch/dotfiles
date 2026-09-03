import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const DEFAULT_PROFILE = "default";

const PROFILE_STATUS_KEY = "auth-profile";
const WEZTERM_PROFILE_USER_VAR = "pi_profile_changed";
const WEZTERM_USAGE_USER_VAR = "pi_usage_changed";

const profilesDir = (agentDir = getAgentDir()) => join(agentDir, "auth-profiles");
export const globalConfigPath = (agentDir = getAgentDir()) => join(agentDir, "auth-profiles.json");
export const projectSettingsPath = (cwd: string) => join(cwd, ".pi", "settings.json");

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

export function readJsonFile(path: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function listProfiles(agentDir = getAgentDir()): string[] {
  const names = new Set([DEFAULT_PROFILE]);
  if (existsSync(profilesDir(agentDir))) {
    for (const file of readdirSync(profilesDir(agentDir)).sort()) {
      if (file.endsWith(".json") && !file.endsWith(".lock")) {
        names.add(file.slice(0, -".json".length));
      }
    }
  }
  return [...names];
}

export function providersIn(profile: string, agentDir = getAgentDir()): string[] {
  return Object.keys(readJsonFile(authPathFor(profile, agentDir)) ?? {});
}

export function accountIdFor(profile: string, agentDir = getAgentDir()): string | undefined {
  const provider = readJsonFile(authPathFor(profile, agentDir))?.["openai-codex"];
  if (typeof provider !== "object" || provider === null || Array.isArray(provider)) {
    return undefined;
  }
  const accountId = (provider as Record<string, unknown>).accountId;
  return typeof accountId === "string" && /^[A-Za-z0-9._-]{1,200}$/.test(accountId)
    ? accountId
    : undefined;
}

export function updateJsonFile(
  path: string,
  update: (data: Record<string, unknown>) => void,
): void {
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

export function publishWezTermChange(
  ctx: Pick<ExtensionContext, "mode">,
  variable: "profile" | "usage",
  value: string,
): void {
  if (ctx.mode !== "tui" || !process.stdout.isTTY) return;

  const name = variable === "profile" ? WEZTERM_PROFILE_USER_VAR : WEZTERM_USAGE_USER_VAR;
  const encoded = Buffer.from(value).toString("base64");
  const sequence = `\u001b]1337;SetUserVar=${name}=${encoded}\u0007`;
  try {
    process.stdout.write(process.env.TMUX ? `\u001bPtmux;\u001b${sequence}\u001b\\` : sequence);
  } catch {
    // WezTerm notification is optional; the command result remains authoritative.
  }
}

export { PROFILE_STATUS_KEY };
