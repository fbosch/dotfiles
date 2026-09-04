import { describe, expect, test } from "bun:test";
import { type SessionBeforeCompactEvent, SessionManager } from "@earendil-works/pi-coding-agent";
import {
  applyPercentageCompaction,
  keepRecentTokensForPercent,
  preparePercentageCompaction,
  resolveCompactionThreshold,
  resolveKeepRecentPercent,
  shouldCompactAtThreshold,
} from "../index";

function createPreparation(tokensBefore = 400): SessionBeforeCompactEvent["preparation"] {
  return {
    firstKeptEntryId: "native-first-kept",
    messagesToSummarize: [],
    turnPrefixMessages: [],
    isSplitTurn: false,
    tokensBefore,
    fileOps: { read: new Set(), written: new Set(), edited: new Set() },
    settings: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
  };
}

describe("compaction customization", () => {
  test("is opt-in when the setting is absent", () => {
    expect(resolveKeepRecentPercent({})).toBeUndefined();
    expect(resolveKeepRecentPercent({ compaction: {} })).toBeUndefined();
  });

  test("accepts fractional ratios between zero and one", () => {
    expect(resolveKeepRecentPercent({ compaction: { keepRecentPercent: 0.375 } })).toBe(0.375);
  });

  test("accepts a fractional headroom threshold", () => {
    expect(resolveCompactionThreshold({ compaction: { threshold: 0.25 } })).toBe(0.25);
  });

  test.each([{ value: null }, { value: [] }, { value: "enabled" }])(
    "rejects malformed compaction settings: $value",
    ({ value }) => {
      const warnings: string[] = [];
      expect(
        resolveKeepRecentPercent({ compaction: value }, (message) => warnings.push(message)),
      ).toBeUndefined();
      expect(warnings).toHaveLength(1);
    },
  );

  test.each([0, 1, -1, 1.01, Number.NaN, Number.POSITIVE_INFINITY, "0.25"])(
    "rejects invalid ratio %j",
    (value) => {
      const warnings: string[] = [];
      expect(
        resolveKeepRecentPercent({ compaction: { keepRecentPercent: value } }, (message) => {
          warnings.push(message);
        }),
      ).toBeUndefined();
      expect(warnings).toHaveLength(1);
    },
  );

  test.each([0, 1, -1, 1.01, Number.NaN, Number.POSITIVE_INFINITY, "0.25"])(
    "rejects invalid threshold %j",
    (value) => {
      const warnings: string[] = [];
      expect(
        resolveCompactionThreshold({ compaction: { threshold: value } }, (message) => {
          warnings.push(message);
        }),
      ).toBeUndefined();
      expect(warnings).toHaveLength(1);
    },
  );

  test("triggers at the configured context usage threshold", () => {
    const usage = { tokens: 750, contextWindow: 1_000 };
    expect(shouldCompactAtThreshold(usage, 0.25)).toBe(true);
    expect(shouldCompactAtThreshold({ ...usage, tokens: 749 }, 0.25)).toBe(false);
    expect(shouldCompactAtThreshold({ ...usage, tokens: null }, 0.25)).toBe(false);
  });

  test("converts the percentage to a token retention budget", () => {
    expect(keepRecentTokensForPercent(100_000, 0.25)).toBe(25_000);
    expect(keepRecentTokensForPercent(101, 0.333)).toBe(34);
    expect(keepRecentTokensForPercent(1, 0.001)).toBe(1);
  });

  test("rebuilds native preparation using the percentage budget", () => {
    const session = SessionManager.inMemory("/tmp/percentage-compaction-test");
    for (let index = 0; index < 4; index++) {
      session.appendMessage({
        role: "user",
        content: `${index}:${"x".repeat(396)}`,
        timestamp: index,
      });
    }

    const entries = session.getBranch();
    const expectedEntry = entries[2];
    if (expectedEntry === undefined) throw new Error("Expected a fourth session entry");
    const preparation = createPreparation();
    const result = preparePercentageCompaction(entries, preparation, 0.5);

    expect(result).toBeDefined();
    expect(result?.settings.keepRecentTokens).toBe(200);
    expect(result?.firstKeptEntryId).toBe(expectedEntry.id);
    expect(result?.messagesToSummarize).toHaveLength(2);
    expect(result?.turnPrefixMessages).toHaveLength(0);
  });

  test("does not prepare a compaction when the percentage leaves no history to summarize", () => {
    const session = SessionManager.inMemory("/tmp/percentage-compaction-test");
    for (let index = 0; index < 4; index++) {
      session.appendMessage({
        role: "user",
        content: `${index}:${"x".repeat(396)}`,
        timestamp: index,
      });
    }

    expect(
      preparePercentageCompaction(session.getBranch(), createPreparation(), 0.99),
    ).toBeUndefined();
  });

  test("updates the existing preparation in place for later handlers", () => {
    const session = SessionManager.inMemory("/tmp/percentage-compaction-test");
    for (let index = 0; index < 4; index++) {
      session.appendMessage({
        role: "user",
        content: `${index}:${"x".repeat(396)}`,
        timestamp: index,
      });
    }

    const expectedEntry = session.getBranch()[2];
    if (expectedEntry === undefined) throw new Error("Expected a fourth session entry");
    const preparation = createPreparation();
    const event: SessionBeforeCompactEvent = {
      type: "session_before_compact",
      preparation,
      branchEntries: session.getBranch(),
      reason: "manual",
      willRetry: false,
      signal: new AbortController().signal,
    };

    expect(applyPercentageCompaction(event, 0.5)).toBe(true);
    expect(preparation.settings.keepRecentTokens).toBe(200);
    expect(preparation.firstKeptEntryId).toBe(expectedEntry.id);
  });
});
