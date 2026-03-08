import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin";
import JustBashPlugin from "opencode-just-bash";
import MachineContextPlugin from "opencode-machine-context";
import RtkPlugin from "opencode-rtk";
import { performance } from "node:perf_hooks";

const STARTUP_TIMING_ENABLED = process.env.OPENCODE_STARTUP_TIMING === "1";

function logStartupTiming(scope: string, start: number) {
  if (STARTUP_TIMING_ENABLED === false) {
    return;
  }

  const elapsed = (performance.now() - start).toFixed(1);
  process.stderr.write(`[opencode startup] ${scope}: ${elapsed}ms\n`);
}

function assertKeys(name: string, hooks: Hooks, expected: string[]) {
  const unexpected = Object.keys(hooks).filter((key) => expected.includes(key) === false);
  if (unexpected.length === 0) {
    return;
  }

  throw new Error(`${name} returned unsupported hooks: ${unexpected.join(", ")}`);
}

export const ComposerPlugin: Plugin = async (input: PluginInput) => {
  const start = performance.now();
  const machineContextTask = (async () => {
    const taskStart = performance.now();

    try {
      return await MachineContextPlugin(input);
    } finally {
      logStartupTiming("composer.machine-context", taskStart);
    }
  })();
  const justBashTask = (async () => {
    const taskStart = performance.now();

    try {
      return await JustBashPlugin(input);
    } finally {
      logStartupTiming("composer.just-bash", taskStart);
    }
  })();
  const rtkTask = (async () => {
    const taskStart = performance.now();

    try {
      return await RtkPlugin(input);
    } finally {
      logStartupTiming("composer.rtk", taskStart);
    }
  })();
  const [machineContext, justBash, rtk] = await Promise.all([
    machineContextTask,
    justBashTask,
    rtkTask,
  ]);

  assertKeys("machine-context", machineContext, ["experimental.chat.messages.transform"]);
  assertKeys("just-bash", justBash, ["tool"]);
  assertKeys("rtk", rtk, ["tool.execute.before"]);

  const hooks: Hooks = {};

  if (machineContext["experimental.chat.messages.transform"] !== undefined) {
    hooks["experimental.chat.messages.transform"] =
      machineContext["experimental.chat.messages.transform"];
  }

  if (justBash.tool !== undefined) {
    hooks.tool = justBash.tool;
  }

  if (rtk["tool.execute.before"] !== undefined) {
    hooks["tool.execute.before"] = rtk["tool.execute.before"];
  }

  logStartupTiming("composer.total", start);
  return hooks;
};
