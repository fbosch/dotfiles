import { expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext, SessionBeforeCompactEvent, SessionBeforeCompactResult } from "@earendil-works/pi-coding-agent";
import { CLASSIFIER_DEFAULTS } from "../classifier-compaction";
import { registerClassifierCompaction } from "../classifier-hook";
import { smallerPrefix } from "../compaction-prefix";
import { sessionWith } from "./fixtures";

type Preparation = SessionBeforeCompactEvent["preparation"];
const cap = "Summarization failed: generation hit the token cap and the summary is incomplete";

function fixture(count: number) {
  const { manager, resultIds } = sessionWith(Array.from({ length: count }, () => ({ resultChars: 24 })));
  manager.appendContextEdit(resultIds[0]!, { content: [{ type: "text", text: "edited evidence" }] });
  const messages = manager.buildSessionProjection().messages;
  const kept = manager.appendMessage({ role: "user", content: "Original tail", timestamp: 20 });
  const branch = manager.getBranch();
  const controller = new AbortController();
  const event = {
    type: "session_before_compact", reason: "threshold", willRetry: false,
    signal: controller.signal, branchEntries: branch,
    preparation: { firstKeptEntryId: kept, messagesToSummarize: messages.slice(0, 3),
      turnPrefixMessages: messages.slice(3), isSplitTurn: true, previousSummary: "Earlier decisions",
      tokensBefore: 80_000, fileOps: { read: new Set<string>(), edited: new Set<string>(), written: new Set<string>() },
      settings: { enabled: true, reserveTokens: 1000, keepRecentTokens: 1000 } },
  } satisfies SessionBeforeCompactEvent;
  const run = async (summarize: (prep: Preparation) => void) => {
    type Handler = (e: SessionBeforeCompactEvent, ctx: ExtensionContext) => Promise<SessionBeforeCompactResult | undefined>;
    let handler: Handler | undefined;
    registerClassifierCompaction({
      on: (_event: string, fn: Handler) => { handler = fn; }, appendEntry: () => {},
    } as unknown as Pick<ExtensionAPI, "on" | "appendEntry">, {
      artifactRoot: () => manager.getCwd(), settings: () => ({ ...CLASSIFIER_DEFAULTS, enabled: true }),
      globalSettings: () => ({ compactionModel: { model: "test/summary" } }),
      compact: async prep => {
        summarize(prep);
        return { summary: "Complete checkpoint", firstKeptEntryId: prep.firstKeptEntryId, tokensBefore: prep.tokensBefore };
      },
    });
    if (!handler) throw Error("Missing hook");
    return handler(event, { sessionManager: manager, hasUI: false,
      modelRegistry: { getModelOfType: () => undefined, find: () => ({ id: "summary" }) },
    } as unknown as ExtensionContext);
  };
  return { run, event, manager, messages, controller };
}

test("an oversized projected span compacts only an edited prefix and keeps the entire suffix verbatim", async () => {
  const { run, manager, messages, event } = fixture(150);
  const before = manager.buildSessionProjection().messages;
  let cut = 0;
  const result = await run(prep => {
    cut = prep.messagesToSummarize.length;
    expect(cut).toBeGreaterThan(3);
    expect(cut).toBeLessThan(messages.length);
    expect(prep.messagesToSummarize).toEqual(messages.slice(0, cut));
    expect(messages[cut]?.role).toBe("assistant");
    expect(prep.turnPrefixMessages).toEqual([]);
    expect(prep.previousSummary).toBe(event.preparation.previousSummary);
    expect(prep.fileOps.read.has("file0")).toBe(true);
    expect(prep.fileOps.read.has("file149")).toBe(false);
  });
  const checkpoint = result?.compaction;
  if (!checkpoint) throw Error("Missing checkpoint");
  manager.appendCompaction(checkpoint.summary, checkpoint.firstKeptEntryId, checkpoint.tokensBefore);
  expect(manager.buildSessionProjection().messages.slice(1)).toEqual(before.slice(cut));
});

test("a capped native summary gets one shorter attempt, never the partial output", async () => {
  const { run, messages } = fixture(5);
  const calls: Preparation[] = [];
  const result = await run(prep => {
    calls.push(prep);
    if (calls.length === 1) throw Error(cap);
  });
  expect(calls).toHaveLength(2);
  const retry = calls[1]!;
  expect(retry.messagesToSummarize).toEqual(messages.slice(0, retry.messagesToSummarize.length));
  expect(retry.messagesToSummarize.length).toBeLessThan(messages.length);
  expect(result?.compaction).toMatchObject({ firstKeptEntryId: retry.firstKeptEntryId, summary: "Complete checkpoint" });
});

test("repeated length stops, aborts and unrelated failures do not loop or save checkpoints", async () => {
  for (const failure of ["length", "abort", "other"]) {
    const { run, controller } = fixture(5);
    let calls = 0;
    const result = await run(() => {
      calls++;
      if (failure === "abort") controller.abort();
      throw Error(failure === "other" ? "upstream unavailable" : cap);
    });
    expect(calls).toBe(failure === "length" ? 2 : 1);
    expect(result).toEqual({ cancel: true });
  }
});

test("a lone message cannot move the kept boundary on a token-cap retry", () => {
  const { event } = fixture(2);
  const preparation = { ...event.preparation, messagesToSummarize: event.preparation.messagesToSummarize.slice(0, 1), turnPrefixMessages: [] };
  expect(smallerPrefix({ ...event, preparation }, true)).toBeUndefined();
});
