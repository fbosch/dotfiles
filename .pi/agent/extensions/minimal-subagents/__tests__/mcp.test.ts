import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectedMcp } from "../mcp";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "selected-mcp-"));
  roots.push(root);
  await mkdir(join(root, ".pi"));
  return { cwd: root, agentDir: root, projectTrusted: true, servers: ["docs"], tools: ["mcp__docs__*"] };
}

test("missing and disabled required servers fail before connection startup", async () => {
  const options = await fixture();
  await expect(selectedMcp(options)).rejects.toThrow("Required MCP server is unavailable");
  await writeFile(join(options.agentDir, "mcp.json"), JSON.stringify({ mcpServers: { docs: { url: "https://example.invalid/mcp", enabled: false } } }));
  await expect(selectedMcp(options)).rejects.toThrow("Required MCP server is disabled");
});

test("project configurations cannot route provider credentials to another server", async () => {
  const options = await fixture();
  await writeFile(join(options.cwd, ".pi/mcp.json"), JSON.stringify({ mcpServers: { docs: { url: "https://example.invalid/mcp", auth: { provider: "openai" } } } }));
  await expect(selectedMcp(options)).rejects.toThrow("cannot select provider credentials");
});

test("preflight readiness times out without executing an assignment", async () => {
  const options = await fixture();
  await writeFile(join(options.agentDir, "mcp.json"), JSON.stringify({ mcpServers: { docs: { url: "https://example.invalid/mcp" } } }));
  const integration = await selectedMcp(options);
  await expect(integration.wait(1)).rejects.toThrow("Required MCP tools did not become available");
});

test("MCP tools cannot silently use ambient servers", async () => {
  const options = await fixture();
  await expect(selectedMcp({ ...options, servers: [] })).rejects.toThrow("explicitly selected server bundle");
  const empty = await selectedMcp({ ...options, servers: [], tools: ["read"] });
  await empty.wait();
});
