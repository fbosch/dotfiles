import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";

const PERMISSION_SYSTEM_STATUS_KEY = "pi-permission-system";
const PERMISSION_SYSTEM_CONFIG_DIRECTORY = "pi-permission-system";
const MCP_TOOL_APPROVAL_REQUEST_EVENT = "pi-mcp-adapter:tool-approval-request";

type McpToolApprovalDecision = "allow_once" | "allow_for_session" | "deny" | "abstain";

type McpToolApprovalRequest = {
  serverName: string;
  originalToolName: string;
  args: Record<string, unknown>;
  claim(handler: () => McpToolApprovalDecision | Promise<McpToolApprovalDecision>): boolean;
};

export interface YoloModeToggleResult {
  enabled: boolean;
  configPath: string;
}

export function permissionSystemConfigPath(agentDirectory = getAgentDir()): string {
  return join(agentDirectory, "extensions", PERMISSION_SYSTEM_CONFIG_DIRECTORY, "config.json");
}

function stripJsonComments(input: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const nextCharacter = input[index + 1];

    if (inString) {
      output += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      output += character;
      continue;
    }

    if (character === "/" && nextCharacter === "/") {
      index += 2;
      while (index < input.length && input[index] !== "\n") index += 1;
      if (index < input.length) output += "\n";
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      index += 2;
      while (index < input.length && !(input[index] === "*" && input[index + 1] === "/")) {
        if (input[index] === "\n") output += "\n";
        index += 1;
      }
      index += 1;
      continue;
    }

    output += character;
  }

  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function readConfig(configPath: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(
      `Cannot load permission-system config from ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(raw)) as unknown;
  } catch (error) {
    throw new Error(
      `Cannot load permission-system config from ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (isRecord(parsed) === false) {
    throw new Error(`Permission-system config at ${configPath} must contain a JSON object.`);
  }

  return parsed;
}

export function isYoloModeEnabled(agentDirectory = getAgentDir()): boolean {
  try {
    return readConfig(permissionSystemConfigPath(agentDirectory)).yoloMode === true;
  } catch {
    // A config that cannot be read must never cause an approval to be granted.
    return false;
  }
}

function writeConfig(configPath: string, config: Record<string, unknown>): void {
  const temporaryPath = `${configPath}.${process.pid}.${randomUUID()}.tmp`;
  let mode = 0o600;
  try {
    mode = statSync(configPath).mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  try {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      mode,
    });
    renameSync(temporaryPath, configPath);
  } catch (error) {
    throw new Error(
      `Failed to save permission-system config at ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    try {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    } catch {
      // The successful rename already removed the temporary file.
    }
  }
}

export function toggleYoloMode(agentDirectory = getAgentDir()): YoloModeToggleResult {
  const configPath = permissionSystemConfigPath(agentDirectory);
  const config = readConfig(configPath);
  const current = config.yoloMode;
  if (current !== undefined && typeof current !== "boolean") {
    throw new Error(`Permission-system config field 'yoloMode' must be a boolean.`);
  }

  const enabled = current !== true;
  config.yoloMode = enabled;
  writeConfig(configPath, config);
  return { enabled, configPath };
}

function isMcpToolApprovalRequest(value: unknown): value is McpToolApprovalRequest {
  return (
    isRecord(value) &&
    typeof value.serverName === "string" &&
    typeof value.originalToolName === "string" &&
    isRecord(value.args) &&
    typeof value.claim === "function"
  );
}

export function handleMcpToolApprovalRequest(
  value: unknown,
  agentDirectory = getAgentDir(),
): boolean {
  if (!isMcpToolApprovalRequest(value) || !isYoloModeEnabled(agentDirectory)) return false;
  // Do not populate the adapter's session cache; the live toggle covers each request.
  return value.claim(() => "allow_once");
}

export function registerYoloApprovalBridge(pi: ExtensionAPI, agentDirectory = getAgentDir()): void {
  pi.events.on(MCP_TOOL_APPROVAL_REQUEST_EVENT, (value) => {
    handleMcpToolApprovalRequest(value, agentDirectory);
  });
}

export function registerYoloCommand(pi: ExtensionAPI, agentDirectory = getAgentDir()): void {
  pi.registerCommand("yolo", {
    description: "Toggle global YOLO mode for permission checks",
    handler: async (args, ctx) => {
      if (args.trim() !== "") {
        ctx.ui.notify("Usage: /yolo", "warning");
        return;
      }

      try {
        const result = toggleYoloMode(agentDirectory);
        ctx.ui.setStatus(
          PERMISSION_SYSTEM_STATUS_KEY,
          result.enabled ? ctx.ui.theme.fg("error", "yolo") : undefined,
        );
        ctx.ui.notify(
          result.enabled
            ? "Global YOLO mode enabled. Ask-state permission checks and MCP tool approvals are auto-approved. Explicit denies still block."
            : "Global YOLO mode disabled. Ask-state permission checks and MCP tool approvals prompt when required.",
          result.enabled ? "warning" : "info",
        );
        return;
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}

export default function yoloMode(pi: ExtensionAPI): void {
  const agentDirectory = getAgentDir();
  registerYoloCommand(pi, agentDirectory);
  registerYoloApprovalBridge(pi, agentDirectory);
}
