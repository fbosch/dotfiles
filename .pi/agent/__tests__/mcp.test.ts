import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const agentRoot = resolve(import.meta.dir, "..");
const mcpServers = JSON.parse(readFileSync(join(agentRoot, "mcp.json"), "utf8")) as {
  autoEnableCodemode?: boolean;
  mcpServers: Record<
    string,
    {
      args?: string[];
      command?: string;
      env?: Record<string, string>;
      exposure?: string;
      timeout?: number;
      timeoutMs?: number;
      url?: string;
    }
  >;
};

describe("native MCP configuration", () => {
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

  test("launches pinned native servers without a snapshot workspace", () => {
    for (const [name, python, source, entrypoint] of [
      [
        "serena",
        "3.12",
        "git+https://github.com/oraios/serena@949a27ef1e5fda1a6e7b561e777bcece345c6ffd",
        "serena",
      ],
      [
        "ast-grep",
        "3.13",
        "git+https://github.com/ast-grep/ast-grep-mcp@149e20d47bb7125fb0c1451feea2f48a98742034",
        "ast-grep-server",
      ],
    ]) {
      const server = mcpServers.mcpServers[name];
      expect(server?.command).toBe("uv");
      expect(server?.args?.slice(0, 9)).toEqual([
        "run",
        "--no-config",
        "--no-project",
        "--python",
        python,
        "--with",
        source,
        "--",
        entrypoint,
      ]);
      expect(server?.env).toMatchObject({
        UV_CACHE_DIR: "${HOME}/.cache/pi/uv",
        UV_PYTHON_INSTALL_DIR: "${HOME}/.cache/pi/uv-python",
      });
    }
    expect(mcpServers.mcpServers.serena?.args).toContain("--project-from-cwd");
    expect(mcpServers.mcpServers.serena?.env?.SERENA_HOME).toBe("${HOME}/.cache/pi/serena");
    expect(mcpServers.mcpServers.context7).toMatchObject({
      command: "npx",
      args: ["--yes", "@upstash/context7-mcp@4.2.0"],
    });
    for (const server of Object.values(mcpServers.mcpServers)) {
      expect(server.command).not.toBe("podman");
      expect(JSON.stringify(server)).not.toContain("mcp-launchers");
      expect(JSON.stringify(server)).not.toContain("mcp-workspaces");
    }
  });

  test.each(["google-chrome", "chromium", "chromium-browser", null])(
    "passes browser paths and isolated-profile flags correctly with %s on PATH",
    (browser) => {
      const chrome = mcpServers.mcpServers["chrome-devtools"];
      expect(chrome?.command).toBe("sh");
      expect(chrome?.env).toEqual({
        npm_config_cache: "${HOME}/.cache/pi/npm",
        CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: "true",
        CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: "true",
      });
      if (!chrome?.args) throw new Error("Missing Chrome MCP arguments");
      const directory = mkdtempSync(join(tmpdir(), "pi-chrome argv-"));
      try {
        writeFileSync(join(directory, "npx"), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
        if (browser) {
          writeFileSync(join(directory, browser), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
        }
        const result = spawnSync("/bin/sh", chrome.args, {
          encoding: "utf8",
          env: { ...process.env, PATH: directory },
        });
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(result.stdout.trim().split("\n")).toEqual([
          "--yes",
          "chrome-devtools-mcp@1.10.1",
          ...(browser ? [`--executable-path=${join(directory, browser)}`] : []),
          "--headless",
          "--isolated",
          "--no-usage-statistics",
          "--no-performance-crux",
        ]);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  test("native Pi passes the live cwd and sees untracked source edits", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "pi-mcp-startup-"));
    const agentDirectory = join(temporaryDirectory, "agent");
    const projectDirectory = join(temporaryDirectory, "project");
    const reportPath = join(temporaryDirectory, "startup.json");
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
            env: {
              MCP_TEST_REPORT: reportPath,
              MCP_TEST_SOURCE: "untracked.ts",
            },
            timeout: 5,
            exposure: "deferred",
          },
        },
      }),
    );

    try {
      for (const source of ["export const current = 1;\n", "export const current = 2;\n"]) {
        writeFileSync(join(projectDirectory, "untracked.ts"), source);
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
        expect(JSON.parse(readFileSync(reportPath, "utf8"))).toEqual({
          cwd: projectDirectory,
          source,
        });
      }
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
