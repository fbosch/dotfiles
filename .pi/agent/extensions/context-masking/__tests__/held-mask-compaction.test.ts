import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import { applyHeldMasks } from "../classifier-hook";
import { digestText } from "../masking-retention";
import { MARKER } from "../policy";
import { sessionWith } from "./fixtures";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function preparation(
  messages: SessionBeforeCompactEvent["preparation"]["messagesToSummarize"],
): SessionBeforeCompactEvent["preparation"] {
  return {
    firstKeptEntryId: "kept",
    messagesToSummarize: messages,
    turnPrefixMessages: [],
    isSplitTurn: false,
    tokensBefore: 10_000,
    fileOps: { read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() },
    settings: { enabled: true, reserveTokens: 1_000, keepRecentTokens: 10 },
  };
}

test("a native-summary fallback sees held masks as committed placeholders", async () => {
  const root = await mkdtemp(join(tmpdir(), "held-mask-compaction-"));
  roots.push(root);
  const f = sessionWith([{ resultChars: 2_000 }, { resultChars: 2_000, args: { path: "other" } }]);
  const [held, visible] = f.resultIds;
  if (!held || !visible) throw Error("Missing result fixtures");
  const heldText = "x".repeat(2_000);
  f.manager.appendCustomEntry("context-masking-rolling", {
    version: 1,
    assessments: [],
    pendingMasks: [{ sourceId: held, bodyDigest: digestText(heldText) }],
  });
  const messages = f.manager.buildSessionProjection().messages;

  const result = await applyHeldMasks(preparation(messages), f.manager.getBranch(), root, f.manager.getSessionId());
  const results = result.preparation.messagesToSummarize.filter((message) => message.role === "toolResult");
  const texts = results.map((message) => message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""));
  expect(texts[0]?.startsWith(MARKER)).toBe(true);
  expect(texts[1]).toBe(heldText);
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({ entryId: held, toolName: "read" });
  const path = result.items[0]?.path;
  if (!path) throw Error("Missing archive path");
  expect(await readFile(path, "utf8")).toBe(heldText);
});

test("without held masks the preparation is unchanged", async () => {
  const f = sessionWith([{ resultChars: 2_000 }]);
  const prepared = preparation(f.manager.buildSessionProjection().messages);
  const result = await applyHeldMasks(prepared, f.manager.getBranch(), "/unused", f.manager.getSessionId());
  expect(result.preparation).toBe(prepared);
  expect(result.items).toEqual([]);
});
