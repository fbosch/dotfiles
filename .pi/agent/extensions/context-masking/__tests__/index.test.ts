import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionBoundaryDraft,
  TurnEndEvent,
  TurnEndEventResult,
} from "@earendil-works/pi-coding-agent";
import { CUSTOM_TYPE, registerContextMasking } from "../index";
import { DEFAULT_SETTINGS, MARKER, type MaskingSettings } from "../policy";
import { sessionWith } from "./fixtures";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

type Handler = (
  event: TurnEndEvent,
  ctx: ExtensionContext,
) => Promise<TurnEndEventResult | undefined>;

async function harness(
  options: { settings?: Partial<MaskingSettings>; tokens?: number | null; window?: number } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "context-masking-test-"));
  roots.push(root);
  let handler: Handler | undefined;
  const pi = {
    on: (name: string, fn: Handler) => {
      if (name === "turn_end") handler = fn;
    },
  } as unknown as Pick<ExtensionAPI, "on">;
  const settings = {
    ...DEFAULT_SETTINGS,
    enabled: true,
    protectRecentTurns: 2,
    minResultChars: 100,
    ...options.settings,
  };
  registerContextMasking(pi, { settings: () => settings, artifactRoot: () => root });
  const notices: string[] = [];
  const ctx = {
    hasUI: true,
    ui: { notify: (message: string) => notices.push(message) },
    getContextUsage: () => ({
      tokens: options.tokens === undefined ? 80_000 : options.tokens,
      contextWindow: options.window ?? 100_000,
      percent: null,
    }),
    sessionManager: { getSessionId: () => "session/1" },
  } as unknown as ExtensionContext;
  const session = sessionWith([
    { resultChars: 120_000 },
    { resultChars: 120_000, tool: "bash" },
    { resultChars: 10 },
    { resultChars: 10 },
  ]);
  const run = async (entries: SessionBoundaryDraft[] = []) => {
    const event = {
      type: "turn_end",
      entries,
      context: { contextEntries: session.projection() },
    } as unknown as TurnEndEvent;
    if (handler === undefined) throw new Error("turn_end handler not registered");
    return handler(event, ctx);
  };
  return { root, run, notices, session };
}

test("masks old results with placeholders that point to saved artifacts", async () => {
  const { root, run, notices, session } = await harness();
  const result = await run();
  const edits = (result?.entries ?? []).filter((entry) => entry.type === "context_edit");

  expect(edits.map((edit) => edit.targetId)).toEqual(session.resultIds.slice(0, 2));
  for (const edit of edits) {
    const block = edit.replacement?.content[0];
    const text = typeof block === "object" && block.type === "text" ? block.text : "";
    expect(text.startsWith(MARKER)).toBe(true);
    const path = join(root, "session_1", `${edit.targetId}.txt`);
    expect(text).toContain(path);
    expect(await readFile(path, "utf8")).toBe("x".repeat(120_000));
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  }
  expect(result?.entries?.at(-1)).toMatchObject({
    type: "custom",
    customType: CUSTOM_TYPE,
    data: { masked: 2, tokensBefore: 80_000, contextWindow: 100_000 },
  });
  expect(notices).toEqual([expect.stringContaining("Masked 2 old tool results")]);
});

test("applied edits replace the results in Pi's projected context", async () => {
  const { run, session } = await harness();
  const result = await run();
  for (const entry of result?.entries ?? []) {
    if (entry.type === "context_edit")
      session.manager.appendContextEdit(entry.targetId, entry.replacement);
  }
  const masked = session
    .projection()
    .filter((e) => session.resultIds.slice(0, 2).includes(e.sourceEntry.id));
  for (const entry of masked) {
    const [message] = entry.messages;
    const block = message?.role === "toolResult" ? message.content[0] : undefined;
    expect(block?.type === "text" && block.text.startsWith(MARKER)).toBe(true);
  }
});

test("keeps entries proposed by earlier handlers", async () => {
  const { run } = await harness();
  const earlier: SessionBoundaryDraft = { type: "custom", customType: "other" };
  const result = await run([earlier]);
  expect(result?.entries?.[0]).toBe(earlier);
});

test("does nothing below the trigger, without usage, or when disabled", async () => {
  expect(await (await harness({ tokens: 50_000 })).run()).toBeUndefined();
  expect(await (await harness({ tokens: null })).run()).toBeUndefined();
  expect(await (await harness({ settings: { enabled: false } })).run()).toBeUndefined();
});

test("skips a batch that frees too little of the context", async () => {
  const { run } = await harness({ tokens: 900_000, window: 1_000_000 });
  // About 60k freed tokens is under 15% of 900k.
  expect(await run()).toBeUndefined();
});
