import { afterEach, expect, test } from "bun:test";
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { RECALL_LIMITS, recallSaved, registerRecall, registerRecallPrefetch } from "../recall";
import { sessionWith } from "./fixtures";
import { customStartEvent, userStartEvent } from "../../shared/__tests__/agent-start-events";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(texts: string[]) {
  const root = await mkdtemp(join(tmpdir(), "recall-test-"));
  roots.push(root);
  const { manager, resultIds } = sessionWith(texts.map(() => ({ resultChars: 1_000 })));
  const dir = join(root, manager.getSessionId());
  await mkdir(dir);
  const paths: string[] = [];
  for (const [i, text] of texts.entries()) {
    const path = join(dir, `${resultIds[i]}.txt`);
    await writeFile(path, text);
    paths.push(path);
  }
  manager.appendCustomEntry("context-masking", {
    items: paths.map((path, i) => ({
      path,
      entryId: resultIds[i],
      toolName: "read",
    })),
  });
  return { root, manager, paths, resultIds };
}

test("returns the relevant passage with its exact saved path and line numbers", async () => {
  const f = await fixture([
    "routine passed",
    `${"routine passed\n".repeat(120)}Archived audit receipt: audit-æøå-1234\nfinished`,
  ]);
  const report = await recallSaved(f.manager.getBranch(), f.root, "old audit receipt");
  expect(report.passages).toHaveLength(1);
  expect(report.text).toContain("audit-æøå-1234");
  expect(report.text).toContain("121│Archived audit receipt");
  expect(report.text).toContain(f.paths[1] ?? "");
  expect(report.scanned).toBe(2);
  expect(report.skipped).toBe(0);
  expect(report.limited).toBe(false);
});

test("distinguishes no match from unreadable or missing artifacts", async () => {
  const f = await fixture(["routine passed"]);
  expect((await recallSaved(f.manager.getBranch(), f.root, "audit receipt")).passages).toHaveLength(
    0,
  );
  await rm(f.paths[0] ?? "");
  const report = await recallSaved(f.manager.getBranch(), f.root, "audit receipt");
  expect(report.skipped).toBe(1);
  expect(report.scanned).toBe(0);
});

test("does not read unrecorded results, arbitrary paths, or symlinks", async () => {
  const f = await fixture(["routine passed"]);
  const secret = join(f.root, "secret.txt");
  await writeFile(secret, "audit receipt: forbidden");
  f.manager.appendCustomEntry("context-masking", {
    items: [
      { entryId: f.resultIds[0], toolName: "read", path: secret },
      { entryId: "absent-entry", toolName: "read", path: f.paths[0] },
    ],
  });
  let report = await recallSaved(f.manager.getBranch(), f.root, "audit receipt");
  expect(report.scanned).toBe(0);
  expect(report.text).not.toContain("forbidden");
  await rm(f.paths[0] ?? "");
  await symlink(secret, f.paths[0] ?? "");
  f.manager.appendCustomEntry("context-masking", {
    items: [{ entryId: f.resultIds[0], toolName: "read", path: f.paths[0] }],
  });
  report = await recallSaved(f.manager.getBranch(), f.root, "audit receipt");
  expect(report.scanned).toBe(0);
  expect(report.skipped).toBe(1);
});

test("rejects symlinked session directories", async () => {
  const f = await fixture(["audit receipt: forbidden"]);
  const original = join(f.root, f.manager.getSessionId());
  const moved = join(f.root, "moved");
  await mkdir(moved);
  const name = `${f.resultIds[0]}.txt`;
  await link(f.paths[0] ?? "", join(moved, name));
  await rm(original, { recursive: true });
  await symlink(moved, original);
  const report = await recallSaved(f.manager.getBranch(), f.root, "audit");
  expect(report.scanned).toBe(0);
  expect(report.skipped).toBe(1);
});

test("reports scan limits and bounds returned output", async () => {
  const f = await fixture([`audit receipt: found\n${"x".repeat(RECALL_LIMITS.fileBytes * 2)}`]);
  const report = await recallSaved(f.manager.getBranch(), f.root, "audit receipt");
  expect(report.bytes).toBe(RECALL_LIMITS.fileBytes);
  expect(report.limited).toBe(true);
  expect(report.text.length).toBeLessThanOrEqual(RECALL_LIMITS.outputChars);
  expect(report.text).toContain("found");
});

test("rejects invalid queries, supports cancellation, and follows only supplied branch records", async () => {
  const f = await fixture(["audit receipt: found"]);
  await expect(recallSaved(f.manager.getBranch(), f.root, " ", 1)).rejects.toThrow();
  await expect(recallSaved(f.manager.getBranch(), f.root, "audit", 4)).rejects.toThrow();
  await expect(
    recallSaved(f.manager.getBranch(), f.root, "audit", 1, AbortSignal.abort()),
  ).rejects.toThrow();
  const withoutRecords: SessionEntry[] = f.manager.getBranch().filter((e) => e.type !== "custom");
  expect((await recallSaved(withoutRecords, f.root, "audit")).scanned).toBe(0);
});

test("registers recall as an optional deferred tool without changing the active tool set", () => {
  const tools: { name: string; exposure: string | undefined }[] = [];
  registerRecall({
    registerTool: (tool) => {
      tools.push({ name: tool.name, exposure: tool.exposure });
    },
  });
  expect(tools[0]).toMatchObject({ name: "recall", exposure: "deferred" });
});

test("returns the matching region of an oversized line", async () => {
  const f = await fixture([
    `${"x".repeat(2_000)} audit receipt: audit-long-line ${"y".repeat(2_000)}`,
  ]);
  const report = await recallSaved(f.manager.getBranch(), f.root, "audit receipt");
  expect(report.text).toContain("audit-long-line");
});

test("prefetch adds relevant passages once, skips unrelated and custom requests, and honors disablement", async () => {
  const f = await fixture(["Archived audit receipt: audit-prefetched"]);
  type Handler = (
    event: BeforeAgentStartEvent,
    ctx: ExtensionContext,
  ) => Promise<BeforeAgentStartEventResult | undefined>;
  let handler: Handler | undefined;
  const pi = {
    on: (_name: string, callback: Handler) => {
      handler = callback;
    },
  } as unknown as Pick<ExtensionAPI, "on">;
  let enabled = true;
  registerRecallPrefetch(
    pi,
    () => f.root,
    () => enabled,
  );
  const ctx = { sessionManager: f.manager } as unknown as ExtensionContext;
  const invoke = async (event: unknown) => {
    if (!handler) throw new Error("Missing prefetch hook");
    return handler(event as BeforeAgentStartEvent, ctx);
  };
  const message = userStartEvent("What was the archived audit receipt?");
  expect(await invoke(customStartEvent())).toBeUndefined();
  expect(await invoke(userStartEvent("What is 17 * 23?"))).toBeUndefined();
  enabled = false;
  expect(await invoke(message)).toBeUndefined();
  enabled = true;
  const result = await invoke(message);
  expect(result?.message?.content).toContain("audit-prefetched");
  expect(f.manager.getEntries().filter((e) => e.type === "custom_message")).toHaveLength(0);
  if (!result?.message) throw new Error("Missing recalled passage");
  f.manager.appendCustomMessageEntry(result.message.customType, result.message.content, false);
  expect(await invoke(message)).toBeUndefined();
});

test("enforces total scan bytes and artifact count limits", async () => {
  const big = await fixture(
    Array.from({ length: 17 }, () => "audit receipt\n".padEnd(RECALL_LIMITS.fileBytes, "x")),
  );
  let report = await recallSaved(big.manager.getBranch(), big.root, "audit receipt");
  expect(report.bytes).toBe(RECALL_LIMITS.totalBytes);
  expect(report.scanned).toBe(16);
  expect(report.limited).toBe(true);
  const many = await fixture(Array.from({ length: 81 }, () => "audit receipt"));
  report = await recallSaved(many.manager.getBranch(), many.root, "audit receipt");
  expect(report.scanned).toBe(RECALL_LIMITS.artifacts);
  expect(report.limited).toBe(true);
});

test("splits long saved lines into bounded passages that fit the output cap", async () => {
  const f = await fixture(
    Array.from({ length: 3 }, () =>
      Array.from({ length: 6 }, (_, i) =>
        (i === 3 ? "audit receipt " : "other ").padEnd(790, "x"),
      ).join("\n"),
    ),
  );
  const report = await recallSaved(f.manager.getBranch(), f.root, "audit receipt");
  expect(report.passages).toHaveLength(3);
  expect(report.text.length).toBeLessThanOrEqual(RECALL_LIMITS.outputChars);
  expect(report.text).not.toContain("[line clipped]");
  expect(report.text).toContain("4│audit receipt");
});

test("searches JSON-encoded output as decoded lines and cites the saved line", async () => {
  const output = [
    ...Array.from({ length: 40 }, (_, i) => `routine step ${i}: passed with nominal timing`),
    'Configured classifier: "typesafe/jev-1.14" with fallback luna',
    ...Array.from({ length: 40 }, (_, i) => `trailing step ${i}: passed with nominal timing`),
  ].join("\n");
  const f = await fixture([
    [
      "Script completed",
      JSON.stringify({ name: "settings", result: JSON.stringify({ text: output }) }),
    ].join("\n"),
  ]);
  const report = await recallSaved(f.manager.getBranch(), f.root, "configured classifier fallback");
  expect(report.text).toContain('2│Configured classifier: "typesafe/jev-1.14" with fallback luna');
  expect(report.text).not.toContain("\\n");
  expect(report.text).not.toContain("[line clipped]");
});
