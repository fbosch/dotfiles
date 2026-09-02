import { expect, test } from "bun:test";
import { resolveLspSettings } from "../settings";

const luaServer = {
  command: "lua-language-server",
  languages: [{ languageId: "lua", extensions: [".lua"] }],
  rootMarkers: [".luarc.json", ".git"],
};

test("merges server definitions by ID and lets projects disable global servers", () => {
  const settings = resolveLspSettings(
    {
      servers: { lua_ls: luaServer, marksman: { ...luaServer, command: "marksman" } },
      timeouts: { requestMs: 2_000 },
    },
    {
      servers: { marksman: null },
      timeouts: { diagnosticsMs: 1_000 },
    },
  );

  expect(settings.servers.map(({ id }) => id)).toEqual(["lua_ls"]);
  expect(settings.timeouts.requestMs).toBe(2_000);
  expect(settings.timeouts.diagnosticsMs).toBe(1_000);
  expect(settings.warnings).toEqual([]);
});

test("fails closed when an active settings layer has an unknown field", () => {
  const settings = resolveLspSettings({ servers: { lua_ls: luaServer } }, { autoInstall: true });

  expect(settings.servers).toEqual([]);
  expect(settings.warnings).toEqual(["project lsp.autoInstall: unknown field"]);
});

test("rejects commands that bypass PATH resolution", () => {
  const settings = resolveLspSettings(
    {
      servers: { lua_ls: { ...luaServer, command: "./lua-language-server" } },
    },
    {},
  );

  expect(settings.servers).toEqual([]);
  expect(settings.warnings).toEqual([
    "global lsp.servers.lua_ls.command: expected a bare executable name",
  ]);
});
