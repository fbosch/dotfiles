import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin";
import JustBashPlugin from "opencode-just-bash";
import MachineContextPlugin from "opencode-machine-context";
import RtkPlugin from "opencode-rtk";

function assertKeys(name: string, hooks: Hooks, expected: string[]) {
  const unexpected = Object.keys(hooks).filter((key) => expected.includes(key) === false);
  if (unexpected.length === 0) {
    return;
  }

  throw new Error(`${name} returned unsupported hooks: ${unexpected.join(", ")}`);
}

export const ComposerPlugin: Plugin = async (input: PluginInput) => {
  const [machineContext, justBash, rtk] = await Promise.all([
    MachineContextPlugin(input),
    JustBashPlugin(input),
    RtkPlugin(input),
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

  return hooks;
};
