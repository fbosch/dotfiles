import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { CredentialStore } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir, getPackageDir } from "@earendil-works/pi-coding-agent";
import { isRecord } from "../shared/is-record";

// shortcut: AuthStorage is private; use the loaded runtime, including its sandbox lock fixes,
// until Pi exposes a public file-backed CredentialStore constructor. Never load the development SDK here.
const AUTH_STORAGE_MODULE_URL = pathToFileURL(
  join(getPackageDir(), "dist/core/auth-storage.js"),
).href;

type AuthStorageModule = {
  AuthStorage: { create(path?: string): CredentialStore };
  ReadOnlyAuthStorage: new (path?: string) => CredentialStore;
};

/**
 * Pi's file-backed credential store for `path`. Credential reads go through it rather than the
 * file, so they work unchanged where Pi hides secrets behind references.
 */
export async function createCredentialStore(path: string): Promise<CredentialStore> {
  const module = (await import(AUTH_STORAGE_MODULE_URL)) as AuthStorageModule;
  return module.AuthStorage.create(path);
}

/** A read-only view of the credential file at `path` that never creates it. */
export async function readCredentialStore(path: string): Promise<CredentialStore> {
  const module = (await import(AUTH_STORAGE_MODULE_URL)) as AuthStorageModule;
  return new module.ReadOnlyAuthStorage(path);
}

export const DEFAULT_PROFILE = "default";

const PROFILE_STATUS_KEY = "auth-profile";
const WEZTERM_PROFILE_USER_VAR = "pi_profile_changed";
const WEZTERM_USAGE_USER_VAR = "pi_usage_changed";

const profilesDir = (agentDir = getAgentDir()) => join(agentDir, "auth-profiles");
export const globalConfigPath = (agentDir = getAgentDir()) => join(agentDir, "auth-profiles.json");

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
    return isRecord(value) ? value : undefined;
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

export type StoredCredential = { type: "oauth" | "api_key"; accountId?: string };

/** Non-secret metadata of a profile's stored credentials, keyed by provider. */
export async function storedCredentials(
  profile: string,
  agentDir = getAgentDir(),
): Promise<Map<string, StoredCredential>> {
  const credentials = new Map<string, StoredCredential>();
  let store: CredentialStore;
  try {
    store = await readCredentialStore(authPathFor(profile, agentDir));
  } catch {
    return credentials;
  }
  for (const { providerId, type } of await store.list().catch(() => [])) {
    const credential = await store.read(providerId).catch(() => undefined);
    const accountId = isRecord(credential) ? credential.accountId : undefined;
    credentials.set(providerId, {
      type,
      ...(typeof accountId === "string" && /^[A-Za-z0-9._-]{1,200}$/.test(accountId)
        ? { accountId }
        : {}),
    });
  }
  return credentials;
}

export async function providersIn(profile: string, agentDir = getAgentDir()): Promise<string[]> {
  return [...(await storedCredentials(profile, agentDir)).keys()];
}

export async function accountIdFor(
  profile: string,
  agentDir = getAgentDir(),
): Promise<string | undefined> {
  return (await storedCredentials(profile, agentDir)).get("openai-codex")?.accountId;
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
