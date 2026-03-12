import type { Plugin } from "@opencode-ai/plugin";

// RTK OpenCode plugin — rewrites commands to use rtk for token savings.
// Requires: rtk >= 0.23.0 in PATH.
//
// This is a thin delegating plugin: all rewrite logic lives in `rtk rewrite`,
// which is the single source of truth (src/discover/registry.rs).
// To add or change rewrite rules, edit the Rust registry — not this file.

export const RtkOpenCodePlugin: Plugin = async ({ $ }) => {
  try {
    await $`which rtk`.quiet();
  } catch {
    console.warn("[rtk] rtk binary not found in PATH — plugin disabled");
    return {};
  }

  return {
    "tool.execute.before": async (input, output) => {
      const tool = String(input?.tool ?? "").toLowerCase();
      if (tool !== "bash" && tool !== "shell" && tool !== "host_exec") return;
      const args = output?.args;
      if (!args || typeof args !== "object") return;

      const command = (args as Record<string, unknown>).command;
      if (typeof command !== "string" || !command) return;

      try {
        const result = await $`rtk rewrite ${command}`.quiet().nothrow();
        const rewritten = String(result.stdout).trim();
        if (rewritten && rewritten !== command) {
          (args as Record<string, unknown>).command = rewritten;
        }
      } catch {
        // rtk rewrite failed — pass through unchanged
      }
    },
    "tool.execute.after": async (input, output) => {
      const tool = String(input?.tool ?? "").toLowerCase();
      if (tool !== "bash" && tool !== "shell") return;
      if (!output || typeof output !== "object") return;

      const result = output as Record<string, unknown>;
      const rawOutput = result.output;
      if (typeof rawOutput !== "string" || rawOutput.length === 0) return;

      const temp = await $`mktemp`.quiet().nothrow();
      const file = String(temp.stdout).trim();
      if (temp.exitCode !== 0 || file.length === 0) return;

      try {
        const written = await $`sh -c 'printf %s "$1" > "$2"' sh ${rawOutput} ${file}`
          .quiet()
          .nothrow();
        if (written.exitCode !== 0) return;

        const summarized = await $`rtk summary cat ${file}`.quiet().nothrow();
        if (summarized.exitCode !== 0) return;

        const nextOutput = String(summarized.stdout).trim();
        if (nextOutput.length === 0 || nextOutput === rawOutput) return;

        result.output = nextOutput;
      } catch {
        return;
      } finally {
        await $`rm -f ${file}`.quiet().nothrow();
      }
    },
  };
};
