import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPiLensServerCandidates, matchesPiLensServer } from "../pi-lens-config";

describe("pi-lens startup candidates", () => {
  test("loads enabled custom servers and applies project overrides", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-lens-header-"));
    const project = join(root, "project");
    mkdirSync(join(root, ".pi-lens"));
    mkdirSync(project);
    writeFileSync(
      join(root, ".pi-lens", "config.json"),
      JSON.stringify({
        lsp: {
          disabledServers: ["eslint"],
          servers: {
            eslint: { extensions: [".ts"] },
            tsc: { extensions: [".ts", ".tsx"] },
          },
        },
      }),
    );
    writeFileSync(
      join(project, ".pi-lens.json"),
      JSON.stringify({ lsp: { servers: { tsc: { extensions: [".mts"] } } } }),
    );

    try {
      const servers = loadPiLensServerCandidates(project, root);
      expect(servers).toEqual([{ id: "tsc", extensions: [".mts"] }]);
      const server = servers[0];
      if (server === undefined) throw new Error("expected tsc server");
      expect(matchesPiLensServer(server, "src/index.mts")).toBe(true);
      expect(matchesPiLensServer(server, "src/index.ts")).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("matches basename-style extensions used for shell profiles", () => {
    expect(matchesPiLensServer({ id: "bashls", extensions: [".bashrc"] }, "/home/me/.bashrc")).toBe(
      true,
    );
  });
});
