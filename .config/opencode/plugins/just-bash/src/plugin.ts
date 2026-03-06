import { tool, type Plugin, type PluginInput } from "@opencode-ai/plugin";
import { Bash, OverlayFs } from "just-bash";

export const JustBashPlugin: Plugin = async (input: PluginInput) => {
  if (typeof input.directory !== "string" || input.directory.length === 0) {
    throw new Error("just-bash plugin requires a session directory");
  }

  const overlay = new OverlayFs({ root: input.directory });
  const mountPoint = overlay.getMountPoint();
  const bashEnv = new Bash({
    fs: overlay,
    cwd: mountPoint,
    env: {
      HOME: mountPoint,
      PROJECT_ROOT: mountPoint,
    },
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
            .describe("Timeout in milliseconds"),
          workdir: tool.schema
            .string()
            .optional()
            .describe("Working directory for this command"),
        },
        async execute(args) {
          const controller =
            args.timeout !== undefined ? new AbortController() : undefined;
          const timeoutHandle =
            args.timeout !== undefined
              ? setTimeout(() => controller?.abort(), args.timeout)
              : undefined;

          try {
            const result = await bashEnv.exec(
              args.command,
              {
                ...(args.workdir !== undefined ? { cwd: args.workdir } : {}),
                ...(controller !== undefined ? { signal: controller.signal } : {}),
              },
            );
            const output = `${result.stdout}${result.stderr}`;

            if (result.exitCode === 0) {
              return output;
            }

            return `Exit ${result.exitCode}\n${output}`;
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Unknown execution error";
            return `just-bash execution failed: ${message}`;
          } finally {
            if (timeoutHandle !== undefined) {
              clearTimeout(timeoutHandle);
            }
          }
        },
      }),
    },
  };
};
