import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import { createOutputArtifacts } from "../artifacts";
import { createOutputSearchTool, SEARCH_MAX_BYTES, searchText } from "../search";

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
function searchHarness(
  entries: () => readonly unknown[],
  enabled: () => boolean = () => true,
  sessionId: () => string = () => "test-session",
  cwd = "/work",
) {
  const context = {
    cwd,
    sessionManager: { getBranch: entries, getSessionId: sessionId },
  } as unknown as ExtensionContext;
  const pi = {
    appendEntry: () => {},
    getActiveTools: () => [],
    getAllTools: () => [],
  } as unknown as Pick<ExtensionAPI, "appendEntry" | "getActiveTools" | "getAllTools">;
  const artifacts = createOutputArtifacts(pi, { enabled, artifactRoot: () => tmpdir() });
  return { artifacts, context };
}

function searchEntries(
  entries: readonly unknown[],
  input: { path: string; queries: string[] },
  signal?: AbortSignal,
  cwd = "/work",
) {
  const harness = searchHarness(() => entries, undefined, undefined, cwd);
  return harness.artifacts.search(harness.context, input, signal);
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

test("current branch proof and matching project authorize registered artifacts", async () => {
  const a = await artifact();
  const input = { path: a.path, queries: ["needle"] };
  expect((await searchEntries(a.entries, input)).matchingLines).toBe(1);
  // Persisted branch entries remain the authority after restoration or cloning.
  expect((await searchEntries(structuredClone(a.entries), input)).matchingLines).toBe(1);
  await expect(searchEntries([], input)).rejects.toThrow("not registered");
  await expect(searchEntries(a.entries, input, undefined, "/other")).rejects.toThrow(
    "not registered",
  );
  await expect(
    searchEntries(a.entries, { ...input, path: join(a.root, "unregistered.txt") }),
  ).rejects.toThrow("not registered");
  await expect(
    searchEntries([{ ...a.entry, data: { ...a.entry.data, sha256: "bad" } }], input),
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
    await expect(searchEntries(a.entries, { path: a.path, queries: ["needle"] })).rejects.toThrow(
      "Unable to search output artifact.",
    );
  }
});
test("cancellation and project policy changes fail closed; tool preserves its structured schema", async () => {
  const a = await artifact();
  const input = { path: a.path, queries: ["needle"] };
  const canceled = searchHarness(() => a.entries);
  const controller = new AbortController();
  controller.abort();
  await expect(
    canceled.artifacts.search(canceled.context, input, controller.signal),
  ).rejects.toThrow();

  const enabled = searchHarness(() => a.entries);
  const tool = createOutputSearchTool(enabled.artifacts);
  const result = await tool.execute("search", input, undefined, undefined, enabled.context);
  expect(Value.Check(tool.outputSchema, result.structuredContent)).toBe(true);
  expect(JSON.parse(result.content[0]?.text ?? "")).toEqual(result.structuredContent);

  const disabled = searchHarness(
    () => a.entries,
    () => false,
  );
  await expect(
    createOutputSearchTool(disabled.artifacts).execute(
      "disabled",
      input,
      undefined,
      undefined,
      disabled.context,
    ),
  ).rejects.toThrow("not enabled");

  let calls = 0;
  const changed = searchHarness(
    () => a.entries,
    () => ++calls === 1,
  );
  await expect(
    createOutputSearchTool(changed.artifacts).execute(
      "changed",
      input,
      undefined,
      undefined,
      changed.context,
    ),
  ).rejects.toThrow("settings changed");
});
test("branch removal and session replacement cannot publish a completed search", async () => {
  for (const change of ["branch", "session"]) {
    const a = await artifact();
    let branchReads = 0;
    let sessionReads = 0;
    const harness = searchHarness(
      () => (++branchReads >= 3 && change === "branch" ? [] : a.entries),
      () => true,
      () => (++sessionReads >= 2 && change === "session" ? "new" : "old"),
    );
    await expect(
      createOutputSearchTool(harness.artifacts).execute(
        "search",
        { path: a.path, queries: ["needle"] },
        undefined,
        undefined,
        harness.context,
      ),
    ).rejects.toThrow("settings changed");
  }
});
