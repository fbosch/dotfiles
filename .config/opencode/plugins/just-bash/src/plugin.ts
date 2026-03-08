import { tool, type Plugin, type PluginInput } from "@opencode-ai/plugin";
import { Bash, OverlayFs } from "just-bash";
import { join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

interface HostExecConfig {
  allowlist?: string[];
  denylist?: string[];
  timeout?: number;
  env?: Record<string, string>;
}

interface SandboxConfig {
  env?: Record<string, string>;
  maxCallDepth?: number;
}

interface PluginConfig {
  sandbox?: SandboxConfig;
  hostExec?: HostExecConfig;
}

const SHELL_OPERATORS = /\s*(?:&&|\|\||[;|])\s*/;

function extractCommands(command: string): string[] {
  const subshellPattern = /\$\(|`/;
  if (subshellPattern.test(command)) {
    return [];
  }

  return command
    .split(SHELL_OPERATORS)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      const withoutEnvVars = segment.replace(/^(?:\w+=\S*\s+)+/, "");
      return withoutEnvVars.split(/\s+/)[0];
    });
}

function validateCommand(command: string, allowlist: string[]): string | undefined {
  const commands = extractCommands(command);

  if (commands.length === 0) {
    return "Command contains subshells ($() or backticks) which are not allowed";
  }

  const denied = commands.filter(
    (cmd) => allowlist.includes(cmd) === false,
  );

  if (denied.length > 0) {
    return `Command(s) not in allowlist: ${denied.join(", ")}. Allowed: ${allowlist.join(", ")}`;
  }

  return undefined;
}

function execHost(
  command: string,
  options: { cwd?: string; timeout?: number; env?: Record<string, string> },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("sh", ["-c", command], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeoutHandle =
      options.timeout !== undefined
        ? setTimeout(() => {
            timedOut = true;
            proc.kill("SIGTERM");
          }, options.timeout)
        : undefined;

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      reject(err);
    });

    proc.on("close", (code) => {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      if (timedOut) {
        resolve({ stdout, stderr: `${stderr}\nProcess timed out`, exitCode: 124 });
        return;
      }
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

function stripJsoncComments(text: string): string {
  return text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

async function loadConfig(configDir: string): Promise<PluginConfig> {
  for (const filename of ["just-bash.jsonc", "just-bash.json"]) {
    try {
      const raw = await readFile(join(configDir, filename), "utf-8");
      return JSON.parse(stripJsoncComments(raw));
    } catch {
      continue;
    }
  }
  return {};
}

async function loadJsonFile(path: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(stripJsoncComments(raw));
  } catch {
    return {};
  }
}

function expandHome(pattern: string): string {
  const home = process.env.HOME ?? "";
  return pattern
    .replace(/^\$HOME(?=\/|$)/, home)
    .replace(/^~(?=\/|$)/, home);
}

interface OpencodePermissions {
  allowedCommands: string[];
  deniedCommands: string[];
  allowedDirectories: string[];
}

function extractCommandName(pattern: string): string | undefined {
  const match = pattern.match(/^(\w[\w-]*)(?:\s+\*)?$/);
  return match ? match[1] : undefined;
}

function extractPermissionEntries(
  config: Record<string, unknown>,
  field: string,
): Record<string, string> {
  const permission = config.permission as Record<string, unknown> | undefined;
  if (typeof permission !== "object" || permission === null) return {};

  const value = permission[field];
  if (typeof value !== "object" || value === null) return {};

  return value as Record<string, string>;
}

async function loadOpencodePermissions(
  projectDir: string,
  globalConfigDir: string,
): Promise<OpencodePermissions> {
  const [projectConfig, globalConfig] = await Promise.all([
    loadJsonFile(join(projectDir, "opencode.json")),
    loadJsonFile(join(globalConfigDir, "opencode.json")),
  ]);

  const allowedCommands: string[] = [];
  const deniedCommands: string[] = [];
  const allowedDirectories: string[] = [];

  for (const config of [globalConfig, projectConfig]) {
    const bashRules = extractPermissionEntries(config, "bash");
    for (const [pattern, rule] of Object.entries(bashRules)) {
      const cmd = extractCommandName(pattern);
      if (cmd === undefined) continue;

      if (rule === "allow") {
        allowedCommands.push(cmd);
      } else if (rule === "deny") {
        deniedCommands.push(cmd);
      }
    }

    const dirRules = extractPermissionEntries(config, "external_directory");
    for (const [pattern, rule] of Object.entries(dirRules)) {
      if (rule === "allow") {
        allowedDirectories.push(expandHome(pattern));
      }
    }
  }

  return { allowedCommands, deniedCommands, allowedDirectories };
}

export const JustBashPlugin: Plugin = async (input: PluginInput) => {
  if (typeof input.directory !== "string" || input.directory.length === 0) {
    throw new Error("just-bash plugin requires a session directory");
  }

  const configDir = join(process.env.HOME ?? "", ".config", "opencode");
  const config = await loadConfig(configDir);

  const sandbox = config.sandbox;

  const overlay = new OverlayFs({ root: input.directory });
  const mountPoint = overlay.getMountPoint();
  const bashEnv = new Bash({
    fs: overlay,
    cwd: mountPoint,
    env: {
      HOME: mountPoint,
      PROJECT_ROOT: mountPoint,
      ...sandbox?.env,
    },
    ...(sandbox?.maxCallDepth !== undefined
      ? { executionLimits: { maxCallDepth: sandbox.maxCallDepth } }
      : {}),
  });

  const tools: Record<string, ReturnType<typeof tool>> = {
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
  };

  const hostExec = config.hostExec;
  if (hostExec) {
    const permissions = await loadOpencodePermissions(input.worktree, configDir);

    const inherited = permissions.allowedCommands.filter(
      (cmd) => permissions.deniedCommands.includes(cmd) === false,
    );
    const explicit = hostExec.allowlist ?? [];
    const denied = new Set([
      ...permissions.deniedCommands,
      ...(hostExec.denylist ?? []),
    ]);
    const allowlist = [...new Set([...inherited, ...explicit])].filter(
      (cmd) => denied.has(cmd) === false,
    );

    if (allowlist.length === 0) {
      return { tool: tools };
    }

    const defaultTimeout = hostExec.timeout;
    const extraEnv = hostExec.env;
    const allowedDirPatterns = permissions.allowedDirectories;

    tools.host_exec = tool({
      description: `Execute commands on the host system. Allowed commands: ${allowlist.join(", ")}. Use this for commands that need real system access (e.g., git, gh, curl). Working directory must be within the project or an allowed external directory.`,
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
      async execute(args, context) {
        const violation = validateCommand(args.command, allowlist);
        if (violation !== undefined) {
          return violation;
        }

        const cwd = resolve(args.workdir ?? context.worktree);
        const projectRoot = resolve(context.worktree);

        if (cwd.startsWith(projectRoot) === false) {
          const isAllowed = allowedDirPatterns.some((pattern) => {
            const base = pattern.replace(/\/\*\*$/, "").replace(/\/\*$/, "");
            return cwd.startsWith(base);
          });

          if (isAllowed === false) {
            return `Working directory "${cwd}" is outside the project and not in any allowed external directory. Allowed: ${projectRoot}, ${allowedDirPatterns.join(", ") || "(none)"}`;
          }
        }

        try {
          const result = await execHost(args.command, {
            cwd,
            timeout: args.timeout ?? defaultTimeout,
            env: extraEnv,
          });
          const output = `${result.stdout}${result.stderr}`;

          if (result.exitCode === 0) {
            return output;
          }

          return `Exit ${result.exitCode}\n${output}`;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown execution error";
          return `host_exec failed: ${message}`;
        }
      },
    });
  }

  return { tool: tools };
};
