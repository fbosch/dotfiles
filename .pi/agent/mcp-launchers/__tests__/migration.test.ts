import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const agentRoot = resolve(import.meta.dir, "../..");
const mcpServers = JSON.parse(readFileSync(join(agentRoot, "mcp.json"), "utf8")) as {
  autoEnableCodemode?: boolean;
  mcpServers: Record<
    string,
    {
      args?: string[];
      command?: string;
      exposure?: string;
      timeout?: number;
      timeoutMs?: number;
      url?: string;
    }
  >;
};

describe("native MCP migration", () => {
  test("sets explicit deferred exposure and converts all request timeouts to seconds", () => {
    expect(mcpServers.autoEnableCodemode).toBe(false);
    expect(Object.keys(mcpServers.mcpServers)).toEqual([
      "github",
      "context7",
      "serena",
      "ast-grep",
      "chrome-devtools",
      "firefox-devtools",
      "shared-todo",
    ]);

    for (const server of Object.values(mcpServers.mcpServers)) {
      expect(server.timeoutMs).toBeUndefined();
      expect(server.timeout).toBe(30);
      expect(server.exposure).toBe("deferred");
    }

    expect(
      Object.values(mcpServers.mcpServers).filter(({ command }) => command !== undefined),
    ).toHaveLength(6);
    expect(
      Object.values(mcpServers.mcpServers).filter(({ url }) => url !== undefined),
    ).toHaveLength(1);
  });

  test("uses global launchers for session-relative container mounts", () => {
    expect(mcpServers.mcpServers.serena).toMatchObject({
      command: "~/.pi/agent/mcp-launchers/serena",
      args: [],
    });
    expect(mcpServers.mcpServers["ast-grep"]).toMatchObject({
      command: "~/.pi/agent/mcp-launchers/ast-grep",
      args: [],
    });
    expect(mcpServers.mcpServers.serena?.command).not.toContain(agentRoot);
    expect(mcpServers.mcpServers["ast-grep"]?.command).not.toContain(agentRoot);
  });

  test("native Pi startup connects only to an isolated fake local MCP server", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "pi-mcp-startup-"));
    const agentDirectory = join(temporaryDirectory, "agent");
    const projectDirectory = join(temporaryDirectory, "project");
    mkdirSync(agentDirectory);
    mkdirSync(projectDirectory);
    const fakeServer = join(import.meta.dir, "fake-mcp-server.ts");
    writeFileSync(
      join(agentDirectory, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          fake_local: {
            command: process.execPath,
            args: [fakeServer],
            timeout: 5,
            exposure: "deferred",
          },
        },
      }),
    );

    try {
      const result = spawnSync("pi", ["mcp", "list"], {
        cwd: projectDirectory,
        encoding: "utf8",
        env: { ...process.env, PI_CODING_AGENT_DIR: agentDirectory },
        timeout: 15_000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("fake_local");
      expect(result.stdout).toContain("fake_read");
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test("retires only the MCP client package, exclusion, and patch inventory entry", () => {
    const settings = JSON.parse(readFileSync(join(agentRoot, "settings.json"), "utf8")) as {
      extensions: string[];
      packages: string[];
    };
    const patchDocumentation = readFileSync(join(agentRoot, "patches/README.md"), "utf8");

    expect(settings.extensions).not.toContain("-builtin:mcp");
    expect(settings.packages.some((name) => name.includes("pi-mcp-client"))).toBe(false);
    expect(existsSync(join(agentRoot, "patches/pi-mcp-client+0.8.0.patch"))).toBe(false);
    expect(patchDocumentation).not.toContain("pi-mcp-client");
  });
});
