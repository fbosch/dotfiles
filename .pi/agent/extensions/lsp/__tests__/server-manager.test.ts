import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LspServerManager } from "../server-manager";

test("retries initialization after the first startup is cancelled", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-lsp-manager-cancel-"));
  await writeFile(join(directory, ".git"), "");
  await writeFile(join(directory, "example.lua"), "BAD value");
  const manager = await LspServerManager.create(directory, {
    servers: [
      {
        args: [join(import.meta.dir, "fixtures", "fake-server.ts"), "--delay-initialize"],
        command: process.execPath,
        id: "fake",
        languages: [{ extensions: [".lua"], fileNames: [], languageId: "lua" }],
        rootMarkers: [".git"],
      },
    ],
    timeouts: { diagnosticsMs: 1_000, requestMs: 1_000, shutdownMs: 1_000, startupMs: 1_000 },
    warnings: [],
  });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 10);
  try {
    await expect(manager.diagnostics("example.lua", controller.signal)).rejects.toThrow(
      "LSP initialize cancelled",
    );
    const result = await manager.diagnostics("example.lua", undefined);
    expect(result.warnings).toEqual([]);
    expect(result.text).toContain("fake diagnostic");
  } finally {
    await manager.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});
