import type { Plugin } from "@opencode-ai/plugin";

const REWRITABLE_TOOLS = new Set(["bash", "host_exec"]);

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
  try {
    await $`which rtk`.quiet();
  } catch {
    return {};
  }

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

      const result = await $`rtk rewrite ${command}`.quiet().nothrow();
      const rewritten = String(result.stdout).trim();

      if (rewritten.length === 0 || rewritten === command) {
        return;
      }

      args.command = rewritten;
    },
  };
};
