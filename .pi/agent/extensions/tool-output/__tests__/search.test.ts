import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import { createOutputSearchTool, SEARCH_MAX_BYTES, searchArtifact, searchText } from "../search";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function artifact(text = "æ ø å 😀\r\nneedle.* = 7\r\nNEEDLE = 9\r\nlast") {
  const root = await mkdtemp(join(tmpdir(), "pi-output-search-test-"));
  roots.push(root);
  const path = join(root, "output.txt");
  await writeFile(path, text, { mode: 0o600 });
  const entry = {
    type: "custom",
    customType: "tool-output-preview",
    data: {
      artifactPath: path,
      cwd: "/work",
      sha256: createHash("sha256").update(text).digest("hex"),
      originalBytes: Buffer.byteLength(text),
    },
  };
  return { root, path, text, entry, entries: [entry] };
}

test("literal OR matching gives full-artifact counts, verbatim Unicode/CRLF context, and bounded pages", () => {
  const input = { path: "/artifact/output.txt", queries: ["needle.*", "missing"], context: 1 };
  const result = searchText("æøå 😀\r\nneedle.* = 7\r\nlast", input);
  expect(result.queryCounts).toEqual([
    { query: "needle.*", matchingLines: 1 },
    { query: "missing", matchingLines: 0 },
  ]);
  expect(result.excerpts).toEqual([
    { matchLine: 2, from: 1, to: 3, text: "æøå 😀\r\nneedle.* = 7\r\nlast" },
  ]);
  expect(result.allMatchesReturned).toBe(true);
  expect(searchText("needleX\n", input).matchingLines).toBe(0);
  expect(searchText("NEEDLE.*\n", { ...input, ignoreCase: true }).matchingLines).toBe(1);
  const page = searchText("hit1\nhit2\nhit3\n", {
    path: input.path,
    queries: ["hit"],
    offset: 2,
    limit: 1,
    context: 0,
  });
  expect(page.matchingLines).toBe(3);
  expect(page.queryCounts[0]?.matchingLines).toBe(3);
  expect(page.excerpts[0]?.matchLine).toBe(2);
  expect(page.nextOffset).toBe(3);
  expect(page.pageComplete).toBe(false);
  expect(page.allMatchesReturned).toBe(false);
  const last = searchText("hit1\nhit2\nhit3\n", {
    path: input.path,
    queries: ["hit"],
    offset: page.nextOffset ?? 1,
    context: 0,
  });
  expect(last.excerpts[0]?.matchLine).toBe(3);
  expect(last.nextOffset).toBeNull();
  expect(last.pageComplete).toBe(true);
  expect(last.allMatchesReturned).toBe(false);
});

test("serialized output budget includes escaped text and preserves every returned match line", () => {
  const line = `hit ${'\\"'.repeat(700)}\n`;
  const text = line.repeat(20);
  const first = searchText(text, { path: "/artifact/output.txt", queries: ["hit"], context: 3 });
  expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(SEARCH_MAX_BYTES);
  expect(first.contextReduced).toBe(true);
  expect(first.excerpts[0]?.text).toBe(line);
  expect(first.nextOffset).toBe(2);
  expect(first.matchingLines).toBe(20);
  expect(() =>
    searchText("x\n", { path: "/artifact/output.txt", queries: Array(8).fill("😀".repeat(256)) }),
  ).toThrow();
});

test("invalid and unbounded requests are rejected", () => {
  for (const input of [
    { path: "relative", queries: ["hit"] },
    { path: "/artifact", queries: [] },
    { path: "/artifact", queries: [""] },
    { path: "/artifact", queries: ["x".repeat(257)] },
    { path: "/artifact", queries: ["hit"], limit: 21 },
    { path: "/artifact", queries: ["hit"], offset: 0 },
    { path: "/artifact", queries: ["hit"], context: 4 },
  ])
    expect(() => searchText("hit", input)).toThrow();
});

test("current-branch capability and matching project are required before reading a path", async () => {
  const a = await artifact();
  expect(
    (await searchArtifact(a.entries, "/work", { path: a.path, queries: ["needle"] })).matchingLines,
  ).toBe(1);
  // A fresh registry is unnecessary: persisted branch entries are the only authority.
  expect(
    (
      await searchArtifact(structuredClone(a.entries), "/work", {
        path: a.path,
        queries: ["needle"],
      })
    ).matchingLines,
  ).toBe(1);
  await expect(searchArtifact([], "/work", { path: a.path, queries: ["needle"] })).rejects.toThrow(
    "not registered",
  );
  await expect(
    searchArtifact(a.entries, "/other", { path: a.path, queries: ["needle"] }),
  ).rejects.toThrow("not registered");
  await expect(
    searchArtifact(a.entries, "/work", {
      path: join(a.root, "unregistered.txt"),
      queries: ["needle"],
    }),
  ).rejects.toThrow("not registered");
  await expect(
    searchArtifact([{ ...a.entry, data: { ...a.entry.data, sha256: "bad" } }], "/work", {
      path: a.path,
      queries: ["needle"],
    }),
  ).rejects.toThrow("not registered");
});

test("changed, removed, linked, special, or public artifacts cannot be searched", async () => {
  for (const mode of ["changed", "removed", "link", "directory", "public", "oversized"]) {
    const a = await artifact();
    if (mode === "changed") await writeFile(a.path, a.text.replace("7", "8"));
    if (mode === "removed") await rm(a.path);
    if (mode === "link") {
      const target = join(a.root, "target.txt");
      await writeFile(target, a.text, { mode: 0o600 });
      await rm(a.path);
      await symlink(target, a.path);
    }
    if (mode === "directory") {
      await rm(a.path);
      await mkdir(a.path);
    }
    if (mode === "public") await chmod(a.path, 0o644);
    if (mode === "oversized") await writeFile(a.path, "x".repeat(128001));
    await expect(
      searchArtifact(a.entries, "/work", { path: a.path, queries: ["needle"] }),
    ).rejects.toThrow("Unable to search output artifact.");
  }
});

test("cancellation and project policy changes fail closed; tool preserves its structured schema", async () => {
  const a = await artifact();
  const controller = new AbortController();
  controller.abort();
  await expect(
    searchArtifact(a.entries, "/work", { path: a.path, queries: ["needle"] }, controller.signal),
  ).rejects.toThrow();
  const ctx = {
    cwd: "/work",
    sessionManager: { getBranch: () => a.entries, getSessionId: () => "test-session" },
  } as unknown as ExtensionContext;
  const tool = createOutputSearchTool(() => true);
  const result = await tool.execute(
    "search",
    { path: a.path, queries: ["needle"] },
    undefined,
    undefined,
    ctx,
  );
  expect(Value.Check(tool.outputSchema, result.structuredContent)).toBe(true);
  expect(JSON.parse(result.content[0]?.text ?? "")).toEqual(result.structuredContent);
  await expect(
    createOutputSearchTool(() => false).execute(
      "disabled",
      { path: a.path, queries: ["needle"] },
      undefined,
      undefined,
      ctx,
    ),
  ).rejects.toThrow("not enabled");
  let calls = 0;
  await expect(
    createOutputSearchTool(() => ++calls === 1).execute(
      "changed",
      { path: a.path, queries: ["needle"] },
      undefined,
      undefined,
      ctx,
    ),
  ).rejects.toThrow("settings changed");
});

test("branch removal and session replacement cannot publish a completed search", async () => {
  for (const change of ["branch", "session"]) {
    const a = await artifact();
    let branchReads = 0;
    let sessionReads = 0;
    const ctx = {
      cwd: "/work",
      sessionManager: {
        getBranch: () => (++branchReads >= 3 && change === "branch" ? [] : a.entries),
        getSessionId: () => (++sessionReads >= 2 && change === "session" ? "new" : "old"),
      },
    } as unknown as ExtensionContext;
    await expect(
      createOutputSearchTool(() => true).execute(
        "search",
        { path: a.path, queries: ["needle"] },
        undefined,
        undefined,
        ctx,
      ),
    ).rejects.toThrow("settings changed");
  }
});
