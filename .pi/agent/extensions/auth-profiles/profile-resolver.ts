import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { hostname as systemHostname } from "node:os";
import { basename, resolve as resolvePath } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { DEFAULT_PROFILE, globalConfigPath, normalizeName } from "./profile-store";

const GIT_TIMEOUT_MS = 2_000;
const GIT_MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_PROFILE_PREFERENCES = 16;
const MAX_MAPPING_ENTRIES = 256;
const MAX_CONFIG_BYTES = 256 * 1024;

type ProfileContext = Pick<ExtensionContext, "cwd" | "isProjectTrusted">;

export type GitRunner = (cwd: string, args: readonly string[]) => Promise<string | undefined>;

export type HostIdentity = {
  name: string;
  source: "NH_DARWIN_HOST" | "system hostname";
};

export type RepositoryIdentity = {
  name: string;
  root: string;
  source: "origin" | "worktree" | "cwd";
};

export type AuthProfilesConfig = {
  defaultProfile?: string;
  hostDefaults: Record<string, string[]>;
  repositoryPreferences: Record<string, string[]>;
};

export type ProfileResolution = {
  profile: string;
  profileOrder: string[];
  source: "session" | "repository" | "host default" | "global default" | "built-in default";
  host: HostIdentity;
  hostPreferences: string[];
  repository?: RepositoryIdentity;
  repositoryPreferences: string[];
};

export type ResolveProfileOptions = {
  agentDir?: string;
  env?: NodeJS.ProcessEnv;
  hostname?: () => string;
  platform?: NodeJS.Platform;
  runGit?: GitRunner;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function orderedProfiles(...groups: readonly string[][]): string[] {
  return [...new Set(groups.flat())];
}

function configuredProfile(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty profile name.`);
  }
  return normalizeName(value);
}

function normalizedHostName(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "" ||
    normalized.length > 255 ||
    /^[a-z0-9][a-z0-9._-]*$/.test(normalized) === false
  ) {
    throw new Error(`${label} is not a valid host name.`);
  }
  return normalized;
}

function repositoryName(value: string, label: string): string {
  const hasControlCharacter = [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f;
  });
  if (value === "" || value.trim() !== value || value.length > 512 || hasControlCharacter) {
    throw new Error(`${label} is not a valid repository name.`);
  }
  return value;
}

function profilePreferenceList(
  value: unknown,
  label: string,
  options: { allowScalar: boolean },
): string[] {
  const values = options.allowScalar && typeof value === "string" ? [value] : value;
  if (Array.isArray(values) === false || values.length === 0) {
    throw new Error(`${label} must be a non-empty array.`);
  }
  if (values.length > MAX_PROFILE_PREFERENCES) {
    throw new Error(`${label} cannot contain more than ${MAX_PROFILE_PREFERENCES} profiles.`);
  }

  const profiles = values.map((profile, index) => configuredProfile(profile, `${label}[${index}]`));
  if (new Set(profiles).size !== profiles.length) {
    throw new Error(`${label} contains duplicate profiles.`);
  }
  return profiles;
}

function parseHostDefaults(value: unknown): Record<string, string[]> {
  if (value === undefined) return {};
  if (isRecord(value) === false) {
    throw new Error("hostDefaults must be a JSON object.");
  }

  const entries = Object.entries(value);
  if (entries.length > MAX_MAPPING_ENTRIES) {
    throw new Error(`hostDefaults cannot contain more than ${MAX_MAPPING_ENTRIES} hosts.`);
  }

  const defaults = Object.create(null) as Record<string, string[]>;
  for (const [rawHost, rawProfiles] of entries) {
    const host = normalizedHostName(rawHost, `hostDefaults key ${JSON.stringify(rawHost)}`);
    if (Object.hasOwn(defaults, host)) {
      throw new Error(`hostDefaults contains duplicate host name ${JSON.stringify(host)}.`);
    }
    defaults[host] = profilePreferenceList(rawProfiles, `hostDefaults.${rawHost}`, {
      allowScalar: true,
    });
  }
  return defaults;
}

function parseRepositoryPreferences(value: unknown): Record<string, string[]> {
  if (value === undefined) return {};
  if (isRecord(value) === false) {
    throw new Error("repositoryPreferences must be a JSON object.");
  }

  const entries = Object.entries(value);
  if (entries.length > MAX_MAPPING_ENTRIES) {
    throw new Error(
      `repositoryPreferences cannot contain more than ${MAX_MAPPING_ENTRIES} repositories.`,
    );
  }

  const preferences = Object.create(null) as Record<string, string[]>;
  for (const [rawRepository, rawProfiles] of entries) {
    const repository = repositoryName(
      rawRepository,
      `repositoryPreferences key ${JSON.stringify(rawRepository)}`,
    );
    preferences[repository] = profilePreferenceList(
      rawProfiles,
      `repositoryPreferences.${repository}`,
      { allowScalar: false },
    );
  }
  return preferences;
}

export function readAuthProfilesConfig(agentDir = getAgentDir()): AuthProfilesConfig {
  const path = globalConfigPath(agentDir);
  if (existsSync(path) === false) {
    return { hostDefaults: {}, repositoryPreferences: {} };
  }

  let value: unknown;
  try {
    if (statSync(path).size > MAX_CONFIG_BYTES) {
      throw new Error(`configuration cannot exceed ${MAX_CONFIG_BYTES} bytes`);
    }
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read ${path}: ${message}`);
  }
  if (isRecord(value) === false) {
    throw new Error(`${path} must contain a JSON object.`);
  }

  const defaultProfile =
    value.defaultProfile === undefined
      ? undefined
      : configuredProfile(value.defaultProfile, "defaultProfile");
  return {
    ...(defaultProfile === undefined ? {} : { defaultProfile }),
    hostDefaults: parseHostDefaults(value.hostDefaults),
    repositoryPreferences: parseRepositoryPreferences(value.repositoryPreferences),
  };
}

export function resolveHostIdentity(
  options: Pick<ResolveProfileOptions, "env" | "hostname" | "platform"> = {},
): HostIdentity {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (platform === "darwin" && env.NH_DARWIN_HOST !== undefined) {
    return {
      name: normalizedHostName(env.NH_DARWIN_HOST, "NH_DARWIN_HOST"),
      source: "NH_DARWIN_HOST",
    };
  }
  return {
    name: normalizedHostName((options.hostname ?? systemHostname)(), "system hostname"),
    source: "system hostname",
  };
}

export function repositoryNameFromOrigin(origin: string): string | undefined {
  const normalized = origin.trim().replace(/\/+$/, "");
  if (normalized === "") return undefined;

  const component = normalized
    .split(/[/:]/)
    .at(-1)
    ?.replace(/\.git$/, "");
  if (!component) return undefined;
  try {
    return decodeURIComponent(component);
  } catch {
    return component;
  }
}

export const runGitCommand: GitRunner = async (cwd, args) =>
  new Promise((resolveOutput) => {
    execFile(
      "git",
      ["-C", cwd, ...args],
      {
        encoding: "utf8",
        maxBuffer: GIT_MAX_OUTPUT_BYTES,
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          resolveOutput(undefined);
          return;
        }
        const output = stdout.trim();
        resolveOutput(output === "" ? undefined : output);
      },
    );
  });

async function safeRunGit(
  runGit: GitRunner,
  cwd: string,
  args: readonly string[],
): Promise<string | undefined> {
  try {
    return await runGit(cwd, args);
  } catch {
    return undefined;
  }
}

export async function resolveRepositoryIdentity(
  cwd: string,
  runGit: GitRunner = runGitCommand,
): Promise<RepositoryIdentity> {
  const absoluteCwd = resolvePath(cwd);
  const reportedRoot = await safeRunGit(runGit, absoluteCwd, ["rev-parse", "--show-toplevel"]);
  const root = reportedRoot ? resolvePath(absoluteCwd, reportedRoot) : absoluteCwd;
  const origin = reportedRoot
    ? await safeRunGit(runGit, root, ["remote", "get-url", "origin"])
    : undefined;
  const originName = origin ? repositoryNameFromOrigin(origin) : undefined;
  if (originName) {
    try {
      return { name: repositoryName(originName, "Git origin repository"), root, source: "origin" };
    } catch {
      // An invalid remote-derived label cannot participate in profile selection.
    }
  }

  const fallback = basename(root) || root;
  return {
    name: repositoryName(fallback, reportedRoot ? "worktree repository" : "cwd repository"),
    root,
    source: reportedRoot ? "worktree" : "cwd",
  };
}

export async function resolveProfile(
  ctx: ProfileContext,
  options: ResolveProfileOptions = {},
): Promise<ProfileResolution> {
  const agentDir = options.agentDir ?? getAgentDir();
  const config = readAuthProfilesConfig(agentDir);
  const host = resolveHostIdentity(options);
  const hostPreferences = config.hostDefaults[host.name] ?? [];
  const projectTrusted = ctx.isProjectTrusted();

  let repository: RepositoryIdentity | undefined;
  let repositoryPreferences: string[] = [];
  if (projectTrusted) {
    repository = await resolveRepositoryIdentity(ctx.cwd, options.runGit ?? runGitCommand);
    repositoryPreferences = config.repositoryPreferences[repository.name] ?? [];
    const profile = repositoryPreferences[0];
    if (profile !== undefined) {
      return {
        profile,
        profileOrder: orderedProfiles(
          repositoryPreferences,
          hostPreferences,
          config.defaultProfile ? [config.defaultProfile] : [],
          [DEFAULT_PROFILE],
        ),
        source: "repository",
        host,
        hostPreferences,
        repository,
        repositoryPreferences,
      };
    }
  }

  const automaticProfileOrder = orderedProfiles(
    hostPreferences,
    config.defaultProfile ? [config.defaultProfile] : [],
    [DEFAULT_PROFILE],
  );
  const hostProfile = hostPreferences[0];
  if (hostProfile !== undefined) {
    return {
      profile: hostProfile,
      profileOrder: automaticProfileOrder,
      source: "host default",
      host,
      hostPreferences,
      ...(repository === undefined ? {} : { repository }),
      repositoryPreferences,
    };
  }
  if (config.defaultProfile !== undefined) {
    return {
      profile: config.defaultProfile,
      profileOrder: automaticProfileOrder,
      source: "global default",
      host,
      hostPreferences,
      ...(repository === undefined ? {} : { repository }),
      repositoryPreferences,
    };
  }
  return {
    profile: DEFAULT_PROFILE,
    profileOrder: automaticProfileOrder,
    source: "built-in default",
    host,
    hostPreferences,
    ...(repository === undefined ? {} : { repository }),
    repositoryPreferences,
  };
}

export function describeProfileSource(resolution: ProfileResolution): string {
  if (resolution.source === "repository" && resolution.repository) {
    return `repository ${resolution.repository.name}`;
  }
  if (resolution.source === "host default") {
    return `host ${resolution.host.name}`;
  }
  return resolution.source;
}
