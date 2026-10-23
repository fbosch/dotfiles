import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createMcpExtension, type ExtensionFactory, type McpServerConfig } from "@earendil-works/pi-coding-agent";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function serverMap(path: string): Promise<Record<string, unknown>> {
  let text: string;
  try { text = await readFile(path, "utf8"); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
    throw error;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch (cause) { throw new Error(`Invalid MCP JSON: ${path}`, { cause }); }
  if (!record(parsed) || !record(parsed.mcpServers)) throw new Error(`Invalid MCP configuration: ${path}`);
  return parsed.mcpServers;
}

function transportConfig(name: string, raw: unknown): McpServerConfig {
  if (!record(raw)) throw new Error(`Required MCP server is unavailable: ${name}`);
  if (raw.enabled === false) throw new Error(`Required MCP server is disabled: ${name}`);
  // registerMcpServer performs the host's full schema validation, including the optional fields.
  if (typeof raw.command === "string") return { ...raw, command: raw.command };
  if (typeof raw.url === "string") return { ...raw, url: raw.url };
  throw new Error(`Required MCP server has no transport: ${name}`);
}

function matches(pattern: string, name: string): boolean {
  return new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(name);
}

/** Native MCP owns connections; the wrapper observes public registrations for preflight readiness. */
export async function selectedMcp(options: {
  agentDir: string;
  cwd: string;
  projectTrusted: boolean;
  servers: readonly string[];
  tools: readonly string[];
  create?: typeof createMcpExtension;
}) {
  const global = options.servers.length ? await serverMap(join(options.agentDir, "mcp.json")) : {};
  const project = options.projectTrusted && options.servers.length ? await serverMap(join(options.cwd, ".pi/mcp.json")) : {};
  const selected = options.servers.map((name) => {
    let config = global[name];
    const override = project[name];
    if (override !== undefined) {
      if (!record(override)) throw new Error(`Invalid project MCP server: ${name}`);
      if (override.auth !== undefined) throw new Error(`Project MCP configuration cannot select provider credentials: ${name}`);
      if (override.command !== undefined || override.url !== undefined || override.type !== undefined) config = override;
      else {
        if (Object.keys(override).some((key) => !["enabled", "exposure", "toolExposure"].includes(key))) {
          throw new Error(`Unsupported project MCP override: ${name}`);
        }
        config = { ...(record(config) ? config : {}), ...override };
      }
    }
    return { name, config: transportConfig(name, config) };
  });
  const required = options.tools.filter((tool) => tool.startsWith("mcp__"));
  if (required.length && !selected.length) throw new Error("MCP tools require an explicitly selected server bundle");
  const registered = new Set<string>();
  const listeners = new Set<() => void>();
  const ready = () => required.every((pattern) => [...registered].some((name) => matches(pattern, name)));
  const factory: ExtensionFactory = async (pi) => {
    if (!selected.length) return;
    for (const server of selected) pi.registerMcpServer(server.name, server.config);
    const native = (options.create ?? createMcpExtension)({ loadConfig: () => ({ servers: [], errors: [], autoEnableCodemode: false }) });
    await native({
      ...pi,
      registerTool(tool) {
        pi.registerTool(tool);
        registered.add(tool.name);
        for (const listener of listeners) listener();
      },
    });
  };
  const wait = (timeoutMs = 30_000): Promise<void> => {
    if (ready()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const finish = () => {
        if (!ready()) return;
        clearTimeout(timer);
        listeners.delete(finish);
        resolve();
      };
      const timer = setTimeout(() => {
        listeners.delete(finish);
        reject(new Error(`Required MCP tools did not become available: ${required.filter((pattern) => ![...registered].some((name) => matches(pattern, name))).join(", ")}`));
      }, timeoutMs);
      listeners.add(finish);
      finish();
    });
  };
  return { factory, wait };
}
