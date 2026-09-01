import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ProjectFile } from "../paths";
import { LspServerClient } from "../server-client";

test("initializes, synchronizes, queries, and shuts down a persistent server", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-lsp-client-"));
  const path = join(directory, "example.lua");
  await writeFile(path, "BAD value");
  const document: ProjectFile = {
    canonicalPath: path,
    languageId: "lua",
    path,
    text: "BAD value",
  };
  const client = await LspServerClient.start(
    {
      args: [join(import.meta.dir, "fixtures", "fake-server.ts")],
      command: process.execPath,
      id: "fake",
      languages: [{ extensions: [".lua"], fileNames: [], languageId: "lua" }],
      rootMarkers: [".git"],
    },
    directory,
    { diagnosticsMs: 1_000, requestMs: 1_000, shutdownMs: 1_000, startupMs: 1_000 },
  );
  try {
    expect(await client.freshDiagnostics(document, undefined)).toHaveLength(1);
    expect(await client.hover(document, { line: 0, character: 0 }, undefined)).toEqual({
      contents: { kind: "plaintext", value: "fake hover" },
    });
    expect(await client.definition(document, { line: 0, character: 0 }, undefined)).toEqual({
      uri: pathToFileURL(path).href,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
    });
  } finally {
    await client.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
  expect(client.status().state).toBe("stopped");
});

test("pulls diagnostics and answers server configuration requests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-lsp-pull-client-"));
  const path = join(directory, "example.lua");
  await writeFile(path, "BAD value");
  const document: ProjectFile = {
    canonicalPath: path,
    languageId: "lua",
    path,
    text: "BAD value",
  };
  const client = await LspServerClient.start(
    {
      args: [join(import.meta.dir, "fixtures", "fake-server.ts"), "--pull"],
      command: process.execPath,
      id: "fake-pull",
      languages: [{ extensions: [".lua"], fileNames: [], languageId: "lua" }],
      rootMarkers: [".git"],
      settings: { lua: { diagnostics: { globals: ["vim"] } } },
    },
    directory,
    { diagnosticsMs: 1_000, requestMs: 1_000, shutdownMs: 1_000, startupMs: 1_000 },
  );
  try {
    expect(await client.freshDiagnostics(document, undefined)).toHaveLength(1);
    expect(await client.hover(document, { line: 0, character: 0 }, undefined)).toEqual({
      contents: {
        kind: "plaintext",
        value: '[{"globals":["vim"]},null,{"lua":{"diagnostics":{"globals":["vim"]}}}]',
      },
    });
  } finally {
    await client.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test("aborts a request without waiting for the request timeout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-lsp-cancel-client-"));
  const path = join(directory, "example.lua");
  await writeFile(path, "value");
  const client = await LspServerClient.start(
    {
      args: [join(import.meta.dir, "fixtures", "fake-server.ts"), "--hang"],
      command: process.execPath,
      id: "fake-hang",
      languages: [{ extensions: [".lua"], fileNames: [], languageId: "lua" }],
      rootMarkers: [".git"],
    },
    directory,
    { diagnosticsMs: 1_000, requestMs: 10_000, shutdownMs: 1_000, startupMs: 1_000 },
  );
  const controller = new AbortController();
  controller.abort();
  try {
    await expect(
      client.hover(
        { canonicalPath: path, languageId: "lua", path, text: "value" },
        { line: 0, character: 0 },
        controller.signal,
      ),
    ).rejects.toThrow("LSP hover cancelled");
  } finally {
    await client.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test("cancels server initialization", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-lsp-cancel-start-"));
  const controller = new AbortController();
  const starting = LspServerClient.start(
    {
      args: [join(import.meta.dir, "fixtures", "fake-server.ts"), "--hang-initialize"],
      command: process.execPath,
      id: "fake-hang-initialize",
      languages: [{ extensions: [".lua"], fileNames: [], languageId: "lua" }],
      rootMarkers: [".git"],
    },
    directory,
    { diagnosticsMs: 1_000, requestMs: 1_000, shutdownMs: 1_000, startupMs: 10_000 },
    controller.signal,
  );
  setTimeout(() => controller.abort(), 10);
  try {
    await expect(starting).rejects.toThrow("LSP initialize cancelled");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("uses ranged replacements for incremental synchronization", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-lsp-incremental-"));
  const path = join(directory, "example.lua");
  await writeFile(path, "BAD value");
  const client = await LspServerClient.start(
    {
      args: [join(import.meta.dir, "fixtures", "fake-server.ts"), "--incremental"],
      command: process.execPath,
      id: "fake-incremental",
      languages: [{ extensions: [".lua"], fileNames: [], languageId: "lua" }],
      rootMarkers: [".git"],
    },
    directory,
    { diagnosticsMs: 1_000, requestMs: 1_000, shutdownMs: 1_000, startupMs: 1_000 },
  );
  try {
    await client.freshDiagnostics(
      { canonicalPath: path, languageId: "lua", path, text: "BAD value" },
      undefined,
    );
    expect(
      await client.hover(
        { canonicalPath: path, languageId: "lua", path, text: "updated" },
        { line: 0, character: 0 },
        undefined,
      ),
    ).toEqual({ contents: { kind: "plaintext", value: "fake hover" } });
  } finally {
    await client.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test("reports a missing executable without waiting for cleanup timeouts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-lsp-missing-command-"));
  try {
    await expect(
      LspServerClient.start(
        {
          args: [],
          command: "definitely-not-a-real-lsp-command",
          id: "missing",
          languages: [],
          rootMarkers: [],
        },
        directory,
        { diagnosticsMs: 1_000, requestMs: 1_000, shutdownMs: 1_000, startupMs: 10_000 },
      ),
    ).rejects.toThrow("spawn failed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
