import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createMcpExtension,
  type ExtensionFactory,
  type McpServerConfig,
} from "@earendil-works/pi-coding-agent";
import { matchesToolPattern } from "./specialist";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function serverMap(path: string): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Error(`Invalid MCP JSON: ${path}`, { cause });
  }
  if (!record(parsed) || !record(parsed.mcpServers))
    throw new Error(`Invalid MCP configuration: ${path}`);
  return parsed.mcpServers;
}

function transportConfig(raw: unknown): McpServerConfig | undefined {
  if (!record(raw) || raw.enabled === false) return undefined;
  // registerMcpServer performs the host's full schema validation, including optional fields.
  if (typeof raw.command === "string") return { ...raw, command: raw.command };
  if (typeof raw.url === "string") return { ...raw, url: raw.url };
  return undefined;
}

/** Native MCP owns background connections; tool hints activate definitions as they arrive. */
export async function selectedMcp(options: {
  agentDir: string;
  cwd: string;
  projectTrusted: boolean;
  servers: readonly string[];
  tools: readonly string[];
  create?: typeof createMcpExtension;
}) {
  const global = options.servers.length ? await serverMap(join(options.agentDir, "mcp.json")) : {};
  const project =
    options.projectTrusted && options.servers.length
      ? await serverMap(join(options.cwd, ".pi/mcp.json"))
      : {};
  const warnings: string[] = [];
  const selected: Array<{ name: string; config: McpServerConfig }> = [];
  for (const name of options.servers) {
    let config = global[name];
    const override = project[name];
    if (override !== undefined) {
      if (!record(override)) throw new Error(`Invalid project MCP server: ${name}`);
      if (override.auth !== undefined)
        throw new Error(`Project MCP configuration cannot select provider credentials: ${name}`);
      if (
        override.command !== undefined ||
        override.url !== undefined ||
        override.type !== undefined
      )
        config = override;
      else {
        if (
          Object.keys(override).some(
            (key) => !["enabled", "exposure", "toolExposure"].includes(key),
          )
        ) {
          throw new Error(`Unsupported project MCP override: ${name}`);
        }
        config = { ...(record(config) ? config : {}), ...override };
      }
    }
    const transport = transportConfig(config);
    if (transport) selected.push({ name, config: transport });
    else warnings.push(`Skipped unavailable or disabled MCP server: ${name}`);
  }
  const factory: ExtensionFactory = async (pi) => {
    if (!selected.length) return;
    for (const server of selected) pi.registerMcpServer(server.name, server.config);
    let started = false;
    pi.on("session_start", () => {
      started = true;
    });
    const native = (options.create ?? createMcpExtension)({
      loadConfig: () => ({ servers: [], errors: [], autoEnableCodemode: false }),
    });
    await native({
      ...pi,
      registerTool(tool) {
        pi.registerTool(tool);
        // Connections may finish after child startup. Never wait for them to launch the worker.
        if (
          started &&
          tool.exposure !== "hidden" &&
          options.tools.some((pattern) => matchesToolPattern(pattern, tool.name))
        ) {
          pi.setActiveTools([...new Set([...pi.getActiveTools(), tool.name])]);
        }
      },
    });
  };
  return { factory, warnings };
}
