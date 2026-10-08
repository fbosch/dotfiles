import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
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

  // direnv checks approved envrc hashes here; keep the grant narrower than XDG_DATA_HOME.
  const direnvAllowDirectory = existingDirectory(join(dataHome, "direnv", "allow"));
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
  const profile = resolve(import.meta.dir, "nono", "pi.json");
  return [
    "run",
    "--profile",
    profile,
    "--allow-cwd",
    "--suppress-save-prompt",
    "/",
    ...integrationGrants,
    ...(direnvAllowDirectory === undefined ? [] : ["--read", direnvAllowDirectory]),
    ...[...grants].flatMap((path) => ["--allow", path]),
    "--",
    piExecutable,
  ];
}

export function launchCommand(
  args: string[],
  cwd: string,
  agentDir: string,
  home: string,
  insideNono: boolean,
): string[] {
  const bypassSandbox = args[0] === "--no-sandbox";
  const piArgs = bypassSandbox ? args.slice(1) : args;
  if (insideNono || bypassSandbox) return [piExecutable, ...piArgs];
  return [nonoExecutable, ...launchArguments(cwd, agentDir, home), ...piArgs];
}

if (import.meta.main) {
  try {
    if (!existsSync(piExecutable)) throw new Error(`Pi executable missing: ${piExecutable}`);
    const agentDir = process.env.PI_CODING_AGENT_DIR ?? getAgentDir();
    // nono propagates this capability manifest to children; a nested Pi inherits the boundary.
    const insideNono = Boolean(process.env.NONO_CAP_FILE);
    const command = launchCommand(
      process.argv.slice(2),
      process.cwd(),
      agentDir,
      homedir(),
      insideNono,
    );
    if (command[0] === nonoExecutable && !existsSync(nonoExecutable)) {
      throw new Error(`nono executable missing: ${nonoExecutable}`);
    }
    const child = Bun.spawnSync(command, {
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
