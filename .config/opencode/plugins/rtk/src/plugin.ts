import type { Plugin } from "@opencode-ai/plugin";
import { performance } from "node:perf_hooks";

const REWRITABLE_TOOLS = new Set(["bash", "host_exec"]);
const STARTUP_TIMING_ENABLED = process.env.OPENCODE_STARTUP_TIMING === "1";

function logStartupTiming(scope: string, start: number) {
  if (STARTUP_TIMING_ENABLED === false) {
    return;
  }

  const elapsed = (performance.now() - start).toFixed(1);
  process.stderr.write(`[opencode startup] ${scope}: ${elapsed}ms\n`);
}

function getCommandArgs(args: unknown): Record<string, unknown> | undefined {
  if (typeof args !== "object" || args === null) {
    return undefined;
  }

  return args as Record<string, unknown>;
}

function getCommand(args: Record<string, unknown>): string | undefined {
  const command = args.command;
  if (typeof command !== "string" || command.length === 0) {
    return undefined;
  }

  return command;
}

export const RtkPlugin: Plugin = async ({ $ }) => {
  const start = performance.now();
  let availabilityPromise: Promise<boolean> | undefined;

  function isRtkAvailable() {
    if (availabilityPromise !== undefined) {
      return availabilityPromise;
    }

    availabilityPromise = (async () => {
      const probeStart = performance.now();

      try {
        await $`which rtk`.quiet();
        return true;
      } catch {
        return false;
      } finally {
        logStartupTiming("rtk.probe", probeStart);
      }
    })();

    return availabilityPromise;
  }

  logStartupTiming("rtk.total", start);
  return {
    "tool.execute.before": async (input, output) => {
      const tool = String(input?.tool ?? "").toLowerCase();
      if (REWRITABLE_TOOLS.has(tool) === false) {
        return;
      }

      const args = getCommandArgs(output?.args);
      if (args === undefined) {
        return;
      }

      const command = getCommand(args);
      if (command === undefined) {
        return;
      }

      if (command.startsWith("rtk ")) {
        return;
      }

      if ((await isRtkAvailable()) === false) {
        return;
      }

      const result = await $`rtk rewrite ${command}`.quiet().nothrow();
      const rewritten = String(result.stdout).trim();

      if (rewritten.length === 0 || rewritten === command) {
        return;
      }

      args.command = rewritten;
    },
  };
};
