import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadLspSettings } from "../index";

const luaServer = {
  command: "lua-language-server",
  languages: [{ languageId: "lua", extensions: [".lua"] }],
  rootMarkers: [".luarc.json", ".git"],
};

test("loads global and trusted project LSP config files", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-lsp-settings-"));
  try {
    const agentDirectory = join(root, "agent");
    const projectDirectory = join(root, "project");
    await mkdir(join(projectDirectory, ".pi"), { recursive: true });
    await mkdir(agentDirectory);
    await writeFile(
      join(agentDirectory, "lsp.json"),
      JSON.stringify({
        servers: { lua_ls: luaServer },
        timeouts: { requestMs: 2_000 },
      }),
    );
    await writeFile(
      join(projectDirectory, ".pi", "lsp.json"),
      JSON.stringify({ timeouts: { diagnosticsMs: 1_000 } }),
    );
    const context = {
      cwd: projectDirectory,
      isProjectTrusted: () => true,
    } as unknown as ExtensionContext;

    const settings = loadLspSettings(context, agentDirectory);

    expect(settings.servers.map(({ id }) => id)).toEqual(["lua_ls"]);
    expect(settings.timeouts.requestMs).toBe(2_000);
    expect(settings.timeouts.diagnosticsMs).toBe(1_000);
    expect(settings.warnings).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("disables global LSP servers until the project is trusted", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-lsp-untrusted-"));
  try {
    const agentDirectory = join(root, "agent");
    const projectDirectory = join(root, "project");
    await mkdir(agentDirectory);
    await mkdir(projectDirectory);
    await writeFile(
      join(agentDirectory, "lsp.json"),
      JSON.stringify({ servers: { lua_ls: luaServer } }),
    );
    const context = {
      cwd: projectDirectory,
      isProjectTrusted: () => false,
    } as unknown as ExtensionContext;

    const settings = loadLspSettings(context, agentDirectory);

    expect(settings.servers).toEqual([]);
    expect(settings.warnings).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
