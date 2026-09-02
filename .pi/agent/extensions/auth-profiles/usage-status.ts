import { resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { collectUsageStatus } from "./usage-status-service";

export * from "./usage-status-service";

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
    process.stdout.write(`${JSON.stringify(await collectUsageStatus({ agentDir, cwd }))}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`auth profile usage: ${message}\n`);
    return error instanceof UsageError ? 2 : 1;
  }
}

// Pi's compiled Jiti loader cannot import modules containing import.meta; keep this CLI-only.
if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
