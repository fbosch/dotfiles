import { spawn } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { selectProfile } from "./profile-selector";
import { projectIsTrusted } from "./project-trust";
import {
  type CollectUsageStatusOptions,
  collectUsageStatus,
  defaultCachePath,
  type UsageStatusPayload,
  usageStatusNeedsRevalidation,
} from "./usage-status-service";

export * from "./usage-status-service";

const REVALIDATE_ENV = "FBB_PI_USAGE_REVALIDATE";
const REFRESH_LEASE_MS = 120_000;

class UsageError extends Error {}

function parseArgs(args: string[]): { agentDir: string; cwd: string; help: boolean } {
  let agentDir = getAgentDir();
  let cwd = process.cwd();
  let help = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "-h" || argument === "--help") {
      help = true;
      continue;
    }
    if (argument === "--agent-dir") {
      const value = args[index + 1];
      if (!value) throw new UsageError("--agent-dir requires a path");
      agentDir = resolve(value);
      index += 1;
      continue;
    }
    if (argument === "--cwd") {
      const value = args[index + 1];
      if (!value) throw new UsageError("--cwd requires a path");
      cwd = resolve(value);
      index += 1;
      continue;
    }
    throw new UsageError(`unknown argument: ${argument}`);
  }
  return { agentDir, cwd, help };
}

export async function readUsageStatusForCli(
  options: CollectUsageStatusOptions,
  scheduleRefresh: () => void,
): Promise<UsageStatusPayload> {
  const status = await collectUsageStatus({ ...options, cacheOnly: true });
  if (usageStatusNeedsRevalidation(status)) scheduleRefresh();
  return status;
}

export async function revalidateUsageStatus(options: CollectUsageStatusOptions): Promise<void> {
  const lockPath = `${options.cachePath ?? defaultCachePath()}.refresh.lock`;
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
  let descriptor: number;
  try {
    descriptor = openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    // An interrupted worker must not prevent later status events from revalidating.
    try {
      if (Date.now() - statSync(lockPath).mtimeMs < REFRESH_LEASE_MS) return;
      unlinkSync(lockPath);
      descriptor = openSync(lockPath, "wx", 0o600);
    } catch (retryError) {
      if (
        retryError instanceof Error &&
        "code" in retryError &&
        ["EEXIST", "ENOENT"].includes(String(retryError.code))
      )
        return;
      throw retryError;
    }
  }
  const token = `${process.pid}:${crypto.randomUUID()}`;
  let cleanupError: unknown;
  try {
    writeFileSync(descriptor, token);
    await collectUsageStatus(options);
  } finally {
    closeSync(descriptor);
    try {
      if (readFileSync(lockPath, "utf8") === token) unlinkSync(lockPath);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
        cleanupError = error;
    }
  }
  if (cleanupError !== undefined) throw cleanupError;
}

function scheduleRefresh(args: string[]): void {
  const worker = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, [REVALIDATE_ENV]: "1" },
  });
  worker.on("error", (error) => {
    process.stderr.write(`auth profile usage refresh: ${error.message}\n`);
  });
  worker.unref();
}

async function main(args: string[]): Promise<number> {
  try {
    const { agentDir, cwd, help } = parseArgs(args);
    if (help) {
      process.stdout.write(
        "Usage: bun usage-status.ts [--agent-dir PATH] [--cwd PATH]\n\n" +
          "Emit Pi auth-profile Codex usage as JSON.\n",
      );
      return 0;
    }
    const resolution = await selectProfile(
      { cwd, isProjectTrusted: () => projectIsTrusted(cwd, agentDir) },
      {
        agentDir,
        // Display-only resolution must not fetch before the cached status is printed.
        usageCollector: (options) => collectUsageStatus({ ...options, cacheOnly: true }),
      },
    );
    const options = { activeProfile: resolution.profile, agentDir };
    if (process.env[REVALIDATE_ENV] === "1") {
      await revalidateUsageStatus(options);
      return 0;
    }
    const status = await readUsageStatusForCli(options, () => scheduleRefresh(args));
    process.stdout.write(`${JSON.stringify(status)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`auth profile usage: ${message}\n`);
    return error instanceof UsageError ? 2 : 1;
  }
}

// Pi's compiled Jiti loader cannot import modules containing import.meta; keep this CLI-only.
if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
