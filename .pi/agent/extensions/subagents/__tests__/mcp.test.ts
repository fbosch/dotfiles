import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectedMcp } from "../mcp";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "selected-mcp-"));
  roots.push(root);
  await mkdir(join(root, ".pi"));
  return {
    cwd: root,
    agentDir: root,
    projectTrusted: true,
    servers: ["docs"],
    tools: ["mcp__docs__*"],
  };
}

test("missing and disabled MCP servers produce warnings instead of startup requirements", async () => {
  const options = await fixture();
  const missing = await selectedMcp(options);
  expect(missing.warnings.join("\n")).toContain("docs");
  await writeFile(
    join(options.agentDir, "mcp.json"),
    JSON.stringify({
      mcpServers: { docs: { url: "https://example.invalid/mcp", enabled: false } },
    }),
  );
  const disabled = await selectedMcp(options);
  expect(disabled.warnings.join("\n")).toContain("disabled");
});

test("project configurations cannot route provider credentials to another server", async () => {
  const options = await fixture();
  await writeFile(
    join(options.cwd, ".pi/mcp.json"),
    JSON.stringify({
      mcpServers: { docs: { url: "https://example.invalid/mcp", auth: { provider: "openai" } } },
    }),
  );
  await expect(selectedMcp(options)).rejects.toThrow("cannot select provider credentials");
});

test("MCP tool hints without a server bundle remain non-blocking", async () => {
  const options = await fixture();
  const integration = await selectedMcp({ ...options, servers: [] });
  expect(integration.warnings).toEqual([]);
});
