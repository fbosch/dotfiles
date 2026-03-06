import { tool, type Plugin, type PluginInput } from "@opencode-ai/plugin";
import { Bash, OverlayFs } from "just-bash";

export const JustBashPlugin: Plugin = async (input: PluginInput) => {
  if (typeof input.directory !== "string" || input.directory.length === 0) {
    throw new Error("just-bash plugin requires a session directory");
  }

  const overlay = new OverlayFs({ root: input.directory });
  const bashEnv = new Bash({
    fs: overlay,
    cwd: overlay.getMountPoint(),
  });

  return {
    tool: {
      bash: tool({
        description: "Run bash commands in an in-memory OverlayFS sandbox",
        args: {
          command: tool.schema.string().describe("The command to execute"),
          description: tool.schema
            .string()
            .describe("Short description of what this command does"),
          timeout: tool.schema
            .number()
            .optional()
            .describe("Timeout in milliseconds (accepted for compatibility)"),
          workdir: tool.schema
            .string()
            .optional()
            .describe("Working directory for this command"),
        },
        async execute(args) {
          try {
            const result = await bashEnv.exec(
              args.command,
              args.workdir ? { cwd: args.workdir } : undefined,
            );
            return `${result.stdout}${result.stderr}`;
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Unknown execution error";
            return `just-bash execution failed: ${message}`;
          }
        },
      }),
    },
  };
};
