import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  getAgentDir,
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
} from "@earendil-works/pi-coding-agent";
import { loadProjectReferences } from "../extensions/mentions/project-references/resolver";

const piExecutable = "/run/current-system/sw/bin/pi";
const nonoExecutable = "/run/current-system/sw/bin/nono";

function existingDirectory(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const canonical = realpathSync(path);
  if (!statSync(canonical).isDirectory()) throw new Error(`Not a directory: ${path}`);
  return canonical;
}

export function nonoProfilePath(
  systemProfile = "/etc/nono/pi.json",
  stowProfile = resolve(import.meta.dir, "nono", "pi.json"),
): string {
  try {
    lstatSync(systemProfile);
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
    // shortcut: retain old-host support until every development host has the Nix profile;
    // remove this fallback before selective protection can change the policy.
    if (!statSync(stowProfile).isFile()) throw new Error(`Not a nono profile file: ${stowProfile}`);
    return stowProfile;
  }
  if (!statSync(systemProfile).isFile())
    throw new Error(`Not a nono profile file: ${systemProfile}`);
  return systemProfile;
}

export function launchArguments(
  cwd: string,
  agentDir: string,
  home: string,
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const trusted =
    !hasTrustRequiringProjectResources(cwd) || new ProjectTrustStore(agentDir).get(cwd) === true;
  const references = loadProjectReferences(cwd, trusted, home, agentDir);
  const grants = new Set<string>();
  for (const reference of references) {
    const path = existingDirectory(reference.path);
    if (path !== undefined) grants.add(path);
  }
  // Stow links config and executable helpers into the repo; grant their canonical targets too.
  for (const path of [agentDir, join(home, ".agents", "skills"), join(home, ".cache", "pi")]) {
    const canonical = existingDirectory(path);
    if (canonical !== undefined) grants.add(canonical);
  }
  const configHome = environment.XDG_CONFIG_HOME || join(home, ".config");
  const dataHome = environment.XDG_DATA_HOME || join(home, ".local", "share");
  const cacheHome = environment.XDG_CACHE_HOME || join(home, ".cache");
  const integrationGrants: string[] = [];

  // direnv checks approval hashes here; keep the grant narrow and preserve XDG symlink aliases.
  const direnvAllowPath = join(dataHome, "direnv", "allow");
  const hasDirenvAllowDirectory = existingDirectory(direnvAllowPath) !== undefined;
  for (const path of [
    join(home, ".pi-lens"),
    environment.PI_HASHLINE_DIR || join(configHome, "pi-hashline-edit-pro"),
    // LMDB needs writable environments, including lock files, even when opening for searches.
    environment.FFF_FRECENCY_DB || join(cacheHome, "nvim", "fff_nvim"),
    environment.FFF_HISTORY_DB || join(dataHome, "nvim", "fff_queries"),
  ]) {
    if (existingDirectory(path) !== undefined) integrationGrants.push("--allow", path);
  }
  // Preserve the symlink alias: granting only its target does not cover macOS alias reads.
  for (const path of [
    join(configHome, "fbb", "data", "typos.abolish"),
    join(configHome, "nix", "git", "config"),
  ]) {
    if (existsSync(path) && statSync(path).isFile()) integrationGrants.push("--read-file", path);
  }
  // Direct Podman access is intentional; do not expose container storage or credential directories.
  const podmanConnections = join(configHome, "containers", "podman-connections.json");
  if (existsSync(podmanConnections) && statSync(podmanConnections).isFile()) {
    for (const path of [
      podmanConnections,
      join(dataHome, "containers", "podman", "machine", "machine"),
    ]) {
      if (existsSync(path) && statSync(path).isFile()) integrationGrants.push("--read-file", path);
    }
    const knownHosts = join(home, ".ssh", "known_hosts");
    if (existsSync(knownHosts) && statSync(knownHosts).isFile()) {
      // Exempt only public host keys from the default SSH credential protection.
      integrationGrants.push("--read-file", knownHosts, "--bypass-protection", knownHosts);
    }
  }
  const profile = nonoProfilePath();
  return [
    "run",
    "--profile",
    profile,
    "--allow-cwd",
    "--suppress-save-prompt",
    "/",
    ...integrationGrants,
    ...(hasDirenvAllowDirectory ? ["--read", direnvAllowPath] : []),
    ...[...grants].flatMap((path) => ["--allow", path]),
    "--",
    piExecutable,
  ];
}

export function launchEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  if (platform !== "darwin" || environment.XDG_RUNTIME_DIR) return environment;
  // The remote Podman client otherwise attempts to create /var/run/user on macOS.
  return { ...environment, XDG_RUNTIME_DIR: environment.TMPDIR || tmpdir() };
}

export function launchCommand(
  args: string[],
  cwd: string,
  agentDir: string,
  home: string,
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const bypassSandbox = args[0] === "--no-sandbox";
  const piArgs = bypassSandbox ? args.slice(1) : args;
  if (bypassSandbox) return [piExecutable, ...piArgs];
  return [nonoExecutable, ...launchArguments(cwd, agentDir, home, environment), ...piArgs];
}

if (import.meta.main) {
  try {
    if (!existsSync(piExecutable)) throw new Error(`Pi executable missing: ${piExecutable}`);
    const agentDir = process.env.PI_CODING_AGENT_DIR ?? getAgentDir();
    // Capability manifests are inherited metadata, not proof of kernel confinement.
    const command = launchCommand(process.argv.slice(2), process.cwd(), agentDir, homedir());
    if (command[0] === nonoExecutable && !existsSync(nonoExecutable)) {
      throw new Error(`nono executable missing: ${nonoExecutable}`);
    }
    const child = Bun.spawnSync(command, {
      env: command[0] === nonoExecutable ? launchEnvironment() : process.env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    process.exit(child.exitCode);
  } catch (error) {
    console.error(`pi sandbox launch: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
