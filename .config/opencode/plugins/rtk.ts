import type { Plugin } from "@opencode-ai/plugin";

export const RtkOpenCodePlugin: Plugin = async ({ $ }) => {
  try {
    await $`which rtk`.quiet();
  } catch {
    console.warn("[rtk] rtk binary not found in PATH - plugin disabled");
    return {};
  }

  return {
    "tool.execute.before": async (input, output) => {
      const tool = String(input?.tool ?? "").toLowerCase();
      if (tool !== "bash" && tool !== "shell") {
        return;
      }

      const args = output?.args;
      if (typeof args !== "object" || args === null) {
        return;
      }

      const command = (args as { command?: unknown }).command;
      if (typeof command !== "string" || command.length === 0) {
        return;
      }

      try {
        const result = await $`rtk rewrite ${command}`.quiet().nothrow();
        const rewritten = String(result.stdout).trim();

        if (rewritten.length === 0 || rewritten === command) {
          return;
        }

        (args as { command: string }).command = rewritten;
      } catch {
        return;
      }
    },
  };
};

export default RtkOpenCodePlugin;
