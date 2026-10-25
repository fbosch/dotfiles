import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ContextEvent,
  ContextEventResult,
  ExtensionAPI,
  ExtensionContext,
  TurnEndEvent,
  TurnEndEventResult,
} from "@earendil-works/pi-coding-agent";
import { buildIndex, INDEX_TYPE, MAX_INDEX_ITEMS } from "../artifact-index";
import { registerContextMasking } from "../index";
import { DEFAULT_SETTINGS, MARKER } from "../policy";
import { sessionWith } from "./fixtures";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

type Handlers = {
  turn_end?: (
    event: TurnEndEvent,
    ctx: ExtensionContext,
  ) => Promise<TurnEndEventResult | undefined>;
  context?: (event: ContextEvent, ctx: ExtensionContext) => ContextEventResult | undefined;
};

async function maskedThenCompacted() {
  const root = await mkdtemp(join(tmpdir(), "context-masking-index-"));
  roots.push(root);
  const handlers: Handlers = {};
  const pi = {
    on: (name: keyof Handlers, fn: never) => {
      handlers[name] = fn;
    },
  } as unknown as Pick<ExtensionAPI, "on">;
  const settings = {
    ...DEFAULT_SETTINGS,
    enabled: true,
    protectRecentTurns: 2,
    minResultChars: 100,
  };
  registerContextMasking(pi, { settings: () => settings, artifactRoot: () => root });

  const session = sessionWith([
    { resultChars: 120_000, tool: "bash", args: { command: "bun test --filter slow" } },
    { resultChars: 120_000 },
    { resultChars: 10 },
    { resultChars: 10 },
  ]);
  const ctx = {
    hasUI: false,
    getContextUsage: () => ({ tokens: 80_000, contextWindow: 100_000, percent: null }),
    sessionManager: session.manager,
  } as unknown as ExtensionContext;
  const boundary = await handlers.turn_end?.(
    {
      type: "turn_end",
      entries: [],
      context: { contextEntries: session.projection() },
    } as unknown as TurnEndEvent,
    ctx,
  );
  for (const entry of boundary?.entries ?? []) {
    if (entry.type === "context_edit")
      session.manager.appendContextEdit(entry.targetId, entry.replacement);
    if (entry.type === "custom") session.manager.appendCustomEntry(entry.customType, entry.data);
  }
  const context = () =>
    handlers.context?.(
      { type: "context", messages: session.manager.buildSessionProjection().messages },
      ctx,
    );
  return { session, context, root };
}

const indexText = (result: ContextEventResult | undefined) => {
  const message = result?.messages?.find((m) => m.role === "custom" && m.customType === INDEX_TYPE);
  return message?.role === "custom" && typeof message.content === "string"
    ? message.content
    : undefined;
};

test("lists saved results after a compaction removes their placeholders", async () => {
  const { session, context, root } = await maskedThenCompacted();
  expect(context()).toBeUndefined();

  // Keep from the third turn on, so both masked results are summarized away.
  const kept = session.manager
    .getBranch()
    .find(
      (e) =>
        e.type === "message" &&
        e.message.role === "assistant" &&
        e.message.content.some((b) => b.type === "toolCall" && b.id === "call2"),
    );
  session.manager.appendCompaction("summary", kept?.id ?? "", 100_000);
  const result = context();
  const text = indexText(result);

  expect(text?.startsWith(MARKER)).toBe(true);
  const dir = join(root, session.manager.getSessionId().replace(/[^A-Za-z0-9_-]/gu, "_"));
  for (const id of session.resultIds.slice(0, 2)) expect(text).toContain(join(dir, `${id}.txt`));
  expect(text).toContain("- bash `bun test --filter slow`:");
  const roles = result?.messages?.map((m) => m.role) ?? [];
  expect(roles.indexOf("custom")).toBe(roles.indexOf("compactionSummary") + 1);
});

test("returns the same index on every request until the next compaction", async () => {
  const { session, context } = await maskedThenCompacted();
  const kept = session.manager.getBranch().at(-3);
  session.manager.appendCompaction("summary", kept?.id ?? "", 100_000);
  const first = context();
  session.manager.appendMessage({ role: "user", content: "more", timestamp: 1 });
  const second = context();
  expect(indexText(second)).toBe(indexText(first));
  const at = (r: ContextEventResult | undefined) =>
    r?.messages?.findIndex((m) => m.role === "custom") ?? -1;
  expect(second?.messages?.[at(second)]).toEqual(first?.messages?.[at(first)]);
});

test("leaves results out while their placeholders are still in context", async () => {
  const { session, context } = await maskedThenCompacted();
  const firstUser = session.manager
    .getBranch()
    .find((e) => e.type === "message" && e.message.role === "user");
  session.manager.appendCompaction("summary", firstUser?.id ?? "", 100_000);
  expect(context()).toBeUndefined();
});

test("buildIndex skips missing files, describes calls, and caps the list", () => {
  const { manager, resultIds } = sessionWith(
    Array.from({ length: MAX_INDEX_ITEMS + 2 }, () => ({ resultChars: 10, tool: "bash" })),
  );
  manager.appendCustomEntry("context-masking", {
    items: resultIds.map((entryId, i) => ({ entryId, toolName: "bash", path: `/saved/${i}.txt` })),
  });
  const text = buildIndex(manager.getBranch(), new Set(), (path) => path !== "/saved/0.txt") ?? "";
  expect(text).not.toContain("/saved/0.txt");
  expect(text).toContain(`/saved/${MAX_INDEX_ITEMS + 1}.txt`);
  expect(text).toContain("(1 older saved results not listed.)");
  expect(text.split("\n").filter((line) => line.startsWith("- bash"))).toHaveLength(
    MAX_INDEX_ITEMS,
  );
});
