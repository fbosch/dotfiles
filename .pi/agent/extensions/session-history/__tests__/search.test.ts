import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { reconcile } from "../indexer";
import { SEARCH_LIMITS, searchSessions } from "../search";
import { HistoryStore } from "../store";
import { header, tempDir, title, user, writeSession } from "./fixtures";

const cleanup: string[] = [];
let store: HistoryStore | undefined;

afterEach(() => {
  store?.close();
  store = undefined;
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
});

async function indexed(
  sessions: readonly { id: string; cwd: string; text: string; at?: string; name?: string }[],
) {
  const root = tempDir("history-sessions-");
  const indexDir = tempDir("history-index-");
  cleanup.push(root, indexDir);
  for (const session of sessions) {
    writeSession(root, `--${session.id}--`, session.id, [
      header(session.id, session.cwd, session.at),
      user(session.text, undefined, session.at),
      ...(session.name ? [title(session.name)] : []),
    ]);
  }
  store = await HistoryStore.open(indexDir);
  await reconcile(store, root);
  return store;
}

describe("query handling", () => {
  const search = (db: HistoryStore, query: string) =>
    searchSessions(db, { query, cwd: "/w", excludeSessionId: "" }).results.map((r) => r.sessionId);

  test("treats FTS5 operator syntax in queries as plain terms", async () => {
    const db = await indexed([
      { id: "s", cwd: "/w", text: 'webhook NOT retry "exact phrase" src/app.ts' },
    ]);
    expect(search(db, 'webhook NOT retry) "exact phrase" src/app.ts')).toEqual(["s"]);
    expect(() => search(db, "  ()*  ")).toThrow("Query contains no searchable terms.");
  });

  test("ignores English and Danish stop words unless only stop words remain", async () => {
    const db = await indexed([
      { id: "en", cwd: "/w", text: "we chose to decide the webhook retry policy" },
      { id: "da", cwd: "/w", text: "gjorde webhook færdig" },
      { id: "stops", cwd: "/w", text: "what is this" },
    ]);
    expect(search(db, "what did we decide about the webhook")).toEqual(["en"]);
    expect(search(db, "hvad gjorde vi med webhook")).toEqual(["da"]);
    expect(search(db, "what is this")).toEqual(["stops"]);
  });

  test("combines a camelCase term with other terms in one valid query", async () => {
    const db = await indexed([{ id: "aero", cwd: "/w", text: "AeroSpace toggle keybind" }]);
    expect(search(db, "AeroSpace toggle keybind")).toEqual(["aero"]);
    const partial = searchSessions(db, {
      query: "AeroSpace toggle missing",
      cwd: "/w",
      excludeSessionId: "",
    });
    expect(partial).toMatchObject({ matchMode: "partial", results: [{ sessionId: "aero" }] });
  });
});

describe("searchSessions", () => {
  test("finds matches in other projects and returns compact identification", async () => {
    const db = await indexed([
      { id: "s1", cwd: "/other", text: "stripe webhook signature", name: "Stripe webhooks" },
    ]);
    const [result] = searchSessions(db, {
      query: "webhook",
      cwd: "/work",
      excludeSessionId: "",
    }).results;
    expect(result).toMatchObject({
      sessionId: "s1",
      title: "Stripe webhooks",
      project: "/other",
      date: "2026-10-01",
    });
    expect(result?.snippet).toContain("«webhook»");
    expect(result?.snippet.length).toBeLessThanOrEqual(SEARCH_LIMITS.snippetChars);
  });

  test("boosts ancestor and descendant projects but not siblings", async () => {
    const db = await indexed([
      { id: "sibling", cwd: "/work/other", text: "rollback migration" },
      { id: "child", cwd: "/work/app/sub", text: "rollback migration" },
    ]);
    const ids = searchSessions(db, {
      query: "rollback",
      cwd: "/work/app",
      excludeSessionId: "",
    }).results.map((r) => r.sessionId);
    expect(ids).toEqual(["child", "sibling"]);
  });

  test("ranks the current project first when relevance and age are equal", async () => {
    const db = await indexed([
      { id: "other", cwd: "/other", text: "rollback migration" },
      { id: "here", cwd: "/work", text: "rollback migration" },
    ]);
    const ids = searchSessions(db, {
      query: "rollback",
      cwd: "/work",
      excludeSessionId: "",
    }).results.map((r) => r.sessionId);
    expect(ids).toEqual(["here", "other"]);
  });

  test("boosts recent sessions", async () => {
    const db = await indexed([
      { id: "old", cwd: "/a", text: "cache eviction", at: "2026-01-01T00:00:00.000Z" },
      { id: "new", cwd: "/b", text: "cache eviction", at: "2026-10-01T00:00:00.000Z" },
    ]);
    const ids = searchSessions(db, {
      query: "eviction",
      cwd: "/z",
      excludeSessionId: "",
      now: Date.parse("2026-10-02"),
    }).results.map((r) => r.sessionId);
    expect(ids).toEqual(["new", "old"]);
  });

  test("takes each snippet from the result's own chunk, not an earlier match", async () => {
    const db = await indexed([
      { id: "first", cwd: "/w", text: "kiwi smoothie from the first session" },
      { id: "second", cwd: "/w", text: "kiwi salad from the second session" },
    ]);
    const [result] = searchSessions(db, {
      query: "kiwi",
      cwd: "/w",
      excludeSessionId: "first",
    }).results;
    expect(result?.sessionId).toBe("second");
    expect(result?.snippet).toContain("salad");
    expect(result?.snippet).not.toContain("smoothie");
  });

  test("excludes the calling session", async () => {
    const db = await indexed([{ id: "me", cwd: "/work", text: "unique term" }]);
    expect(
      searchSessions(db, { query: "unique", cwd: "/work", excludeSessionId: "me" }).results,
    ).toEqual([]);
  });

  test("falls back to partial matching and limits results", async () => {
    const db = await indexed(
      Array.from({ length: 25 }, (_, index) => ({ id: `s${index}`, cwd: "/w", text: "kiwi" })),
    );
    const report = searchSessions(db, {
      query: "kiwi mango",
      cwd: "/w",
      excludeSessionId: "",
      limit: 50,
    });
    expect(report.matchMode).toBe("partial");
    expect(report.results).toHaveLength(SEARCH_LIMITS.maxResults);
  });

  test("partial matching ignores sessions that match only one of three terms", async () => {
    const db = await indexed([
      { id: "one", cwd: "/w", text: "kiwi smoothie" },
      { id: "two", cwd: "/w", text: "kiwi mango salad" },
    ]);
    const report = searchSessions(db, {
      query: "kiwi mango papaya",
      cwd: "/w",
      excludeSessionId: "",
    });
    expect(report.results.map((result) => result.sessionId)).toEqual(["two"]);
  });

  test("finds a part of a camelCase identifier and ranks whole-token matches higher", async () => {
    const db = await indexed([
      { id: "split", cwd: "/w", text: "moved createBrowserRouter out of render" },
      { id: "whole", cwd: "/w", text: "the router state resets" },
    ]);
    const ids = searchSessions(db, {
      query: "router",
      cwd: "/w",
      excludeSessionId: "",
    }).results.map((r) => r.sessionId);
    expect(ids).toEqual(["whole", "split"]);
  });
});
