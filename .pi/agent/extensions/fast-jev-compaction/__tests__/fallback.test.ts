import { describe, expect, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";
import fastJevCompaction from "../index";

type CompactHandler = (event: SessionBeforeCompactEvent, ctx: ExtensionContext) => Promise<unknown>;

function harness() {
  const handlers = new Map<string, unknown>();
  const notifications: string[] = [];
  const statuses: unknown[] = [];
  const pi = {
    on: (name: string, handler: unknown) => handlers.set(name, handler),
    registerCommand() {},
    events: { emit: (_name: string, status: unknown) => statuses.push(status) },
  } as unknown as ExtensionAPI;
  fastJevCompaction(pi, () => ({ config: { enabled: true, phased: true }, loadFailed: false }));
  (handlers.get("session_start") as () => void)();
  const ctx = {
    ui: { notify: (message: string) => notifications.push(message) },
    modelRegistry: {
      getProviderAuth: () => {
        throw new Error("Preflight refusal must not reach a gateway");
      },
    },
  } as unknown as ExtensionContext;
  return {
    compact: handlers.get("session_before_compact") as CompactHandler,
    ctx,
    notifications,
    statuses,
  };
}

function eventFor(text: string): SessionBeforeCompactEvent {
  return {
    type: "session_before_compact",
    branchEntries: [],
    signal: new AbortController().signal,
    preparation: {
      messagesToSummarize: [{ role: "user", content: [{ type: "text", text }] }],
      turnPrefixMessages: [],
      isSplitTurn: false,
      firstKeptEntryId: "kept-entry",
      tokensBefore: 50_000,
      fileOps: { read: new Set(), written: new Set(), edited: new Set() },
      settings: { enabled: true, reserveTokens: 5_000, keepRecentTokens: 20_000 },
    },
  } as unknown as SessionBeforeCompactEvent;
}

describe("native fallback at the Pi handler boundary", () => {
  for (const [reason, text] of [
    ["source-span-limit", "x".repeat(700 * 1_025)],
    ["protected-too-large", "Keep this essential current constraint. ".repeat(100)],
  ]) {
    test(`delegates ${reason} once without committing a partial summary`, async () => {
      const run = harness();
      expect(await run.compact(eventFor(text!), run.ctx)).toBeUndefined();
      expect(run.notifications).toEqual([
        `Fast Jev could not compact (${reason}); using Pi native compaction.`,
      ]);
      expect(run.statuses).toHaveLength(1);
      expect(run.statuses[0]).toMatchObject({
        outcome: "native-fallback",
        path: "native",
        reason,
        requests: 0,
      });
    });
  }

  test("delegates unexpected exceptions without exposing their contents", async () => {
    const run = harness();
    const event = eventFor("test");
    Object.defineProperty(event, "preparation", {
      get() {
        throw new Error("private source content");
      },
    });
    expect(await run.compact(event, run.ctx)).toBeUndefined();
    expect(run.notifications).toEqual([
      "Fast Jev could not compact (unexpected); using Pi native compaction.",
    ]);
    expect(run.statuses[0]).toMatchObject({ outcome: "native-fallback", reason: "unexpected" });
  });

  test("never starts native compaction after caller cancellation, including exceptions", async () => {
    for (const throwDuringPreparation of [false, true]) {
      const run = harness();
      const controller = new AbortController();
      controller.abort();
      const event = { ...eventFor("test"), signal: controller.signal };
      if (throwDuringPreparation) {
        Object.defineProperty(event, "preparation", {
          get() {
            throw new Error("cancelled preparation");
          },
        });
      }
      expect(await run.compact(event, run.ctx)).toEqual({ cancel: true });
      expect(run.notifications).toEqual([]);
      expect(run.statuses[0]).toMatchObject({ outcome: "cancelled", path: "none" });
    }
  });
});
