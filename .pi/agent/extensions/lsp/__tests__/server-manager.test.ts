import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LspServerManager } from "../server-manager";

test("runs diagnostics for matching servers concurrently", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-lsp-manager-parallel-"));
  const barrier = join(directory, "diagnostic-barrier");
  await writeFile(join(directory, ".git"), "");
  await writeFile(join(directory, "example.lua"), "BAD value");
  const fixture = join(import.meta.dir, "fixtures", "fake-server.ts");
  const servers = ["first", "second"].map((id) => ({
    args: [fixture, "--pull", "--diagnostic-barrier", barrier, "--diagnostic-barrier-count", "2"],
    command: process.execPath,
    id,
    languages: [{ extensions: [".lua"], fileNames: [], languageId: "lua" }],
    rootMarkers: [".git"],
  }));
  const manager = await LspServerManager.create(directory, {
    servers,
    timeouts: { diagnosticsMs: 250, requestMs: 1_000, shutdownMs: 1_000, startupMs: 1_000 },
    warnings: [],
  });
  try {
    const result = await manager.diagnostics("example.lua", undefined);
    expect(result.warnings).toEqual([]);
    expect(result.diagnosticCount).toBe(2);
    expect(result.diagnosticVerdict).toBe("issues");
    expect(result.diagnosticEvidence).toEqual([
      { kind: "pull-report", reportKind: "full", serverId: "first" },
      { kind: "pull-report", reportKind: "full", serverId: "second" },
    ]);
    expect(result.unconfirmedServers).toEqual([]);
    expect(result.text).toContain("LSP extension verdict: issues");
    expect(result.text).toContain("LSP-native evidence:");
    expect(result.text).toContain("(first)");
    expect(result.text).toContain("(second)");
  } finally {
    await manager.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test("confirms clean diagnostics only when every server explicitly answers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-lsp-manager-clean-"));
  await writeFile(join(directory, ".git"), "");
  await writeFile(join(directory, "example.lua"), "value");
  const manager = await LspServerManager.create(directory, {
    servers: [
      {
        args: [join(import.meta.dir, "fixtures", "fake-server.ts"), "--pull"],
        command: process.execPath,
        id: "fake-pull",
        languages: [{ extensions: [".lua"], fileNames: [], languageId: "lua" }],
        rootMarkers: [".git"],
      },
    ],
    timeouts: { diagnosticsMs: 1_000, requestMs: 1_000, shutdownMs: 1_000, startupMs: 1_000 },
    warnings: [],
  });
  try {
    const result = await manager.diagnostics("example.lua", undefined);
    expect(result.diagnosticCount).toBe(0);
    expect(result.diagnosticVerdict).toBe("clean");
    expect(result.diagnosticEvidence).toEqual([
      { kind: "pull-report", reportKind: "full", serverId: "fake-pull" },
    ]);
    expect(result.unconfirmedServers).toEqual([]);
    expect(result.text).toBe(
      "LSP extension verdict: clean\nLSP-native evidence: fake-pull=textDocument/diagnostic full report",
    );
  } finally {
    await manager.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test("labels silent push servers as unconfirmed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-lsp-manager-assumed-clean-"));
  await writeFile(join(directory, ".git"), "");
  await writeFile(join(directory, "example.lua"), "value");
  const manager = await LspServerManager.create(directory, {
    servers: [
      {
        args: [join(import.meta.dir, "fixtures", "fake-server.ts"), "--omit-empty"],
        command: process.execPath,
        id: "fake-silent",
        languages: [{ extensions: [".lua"], fileNames: [], languageId: "lua" }],
        rootMarkers: [".git"],
      },
    ],
    timeouts: { diagnosticsMs: 1_000, requestMs: 1_000, shutdownMs: 1_000, startupMs: 1_000 },
    warnings: [],
  });
  try {
    const result = await manager.diagnostics("example.lua", undefined);
    expect(result.diagnosticCount).toBe(0);
    expect(result.diagnosticVerdict).toBe("unconfirmed");
    expect(result.diagnosticEvidence).toEqual([]);
    expect(result.unconfirmedServers).toEqual(["fake-silent"]);
    expect(result.text).toContain("Missing LSP-native evidence");
    expect(result.text).toContain("textDocument/publishDiagnostics");
    expect(result.text).toContain("fake-silent");
  } finally {
    await manager.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test("labels mixed server success and failure as partial", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-lsp-manager-partial-"));
  await writeFile(join(directory, ".git"), "");
  await writeFile(join(directory, "example.lua"), "BAD value");
  const language = { extensions: [".lua"], fileNames: [], languageId: "lua" };
  const manager = await LspServerManager.create(directory, {
    servers: [
      {
        args: [join(import.meta.dir, "fixtures", "fake-server.ts"), "--pull"],
        command: process.execPath,
        id: "available",
        languages: [language],
        rootMarkers: [".git"],
      },
      {
        args: [],
        command: "definitely-not-a-real-lsp-command",
        id: "unavailable",
        languages: [language],
        rootMarkers: [".git"],
      },
    ],
    timeouts: { diagnosticsMs: 1_000, requestMs: 1_000, shutdownMs: 1_000, startupMs: 1_000 },
    warnings: [],
  });
  try {
    const result = await manager.diagnostics("example.lua", undefined);
    expect(result.diagnosticCount).toBe(1);
    expect(result.diagnosticVerdict).toBe("partial");
    expect(result.text).toContain("LSP extension verdict: partial");
    expect(result.text).toContain("LSP-native evidence:");
    expect(result.text).toContain("fake diagnostic");
    expect(result.warnings[0]).toContain("unavailable: spawn failed");
  } finally {
    await manager.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test("labels diagnostics unavailable when no server completes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-lsp-manager-unavailable-"));
  await writeFile(join(directory, ".git"), "");
  await writeFile(join(directory, "example.lua"), "value");
  const manager = await LspServerManager.create(directory, {
    servers: [
      {
        args: [],
        command: "definitely-not-a-real-lsp-command",
        id: "unavailable",
        languages: [{ extensions: [".lua"], fileNames: [], languageId: "lua" }],
        rootMarkers: [".git"],
      },
    ],
    timeouts: { diagnosticsMs: 1_000, requestMs: 1_000, shutdownMs: 1_000, startupMs: 1_000 },
    warnings: [],
  });
  try {
    const result = await manager.diagnostics("example.lua", undefined);
    expect(result.diagnosticCount).toBe(0);
    expect(result.diagnosticVerdict).toBe("unavailable");
    expect(result.matched).toBeFalse();
    expect(result.diagnosticEvidence).toEqual([]);
    expect(result.unconfirmedServers).toEqual([]);
    expect(result.text).toBe("LSP extension verdict: unavailable\nLSP-native evidence: none");
  } finally {
    await manager.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

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
    expect(result.diagnosticVerdict).toBe("issues");
    expect(result.text).toContain("fake diagnostic");
  } finally {
    await manager.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});
