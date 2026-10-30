import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { ftsQuery, isRelatedProject, SEARCH_LIMITS, searchSessions } from "../search";
import { HistoryStore } from "../store";
import { reconcile } from "../sync";
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

describe("ftsQuery", () => {
  test("quotes every term so input cannot inject FTS5 syntax", () => {
    expect(ftsQuery('webhook NOT retry) "exact phrase" src/app.ts', "all")).toBe(
      '"exact phrase" "webhook" "NOT" "retry" "src/app.ts"',
    );
    expect(ftsQuery("a b", "any")).toBe('"a" OR "b"');
    expect(ftsQuery("  ()*  ", "all")).toBeUndefined();
  });
});

describe("isRelatedProject", () => {
  test("matches the same directory, ancestors, and descendants only", () => {
    expect(isRelatedProject("/work/app", "/work/app")).toBe(true);
    expect(isRelatedProject("/work/app/sub", "/work/app")).toBe(true);
    expect(isRelatedProject("/work", "/work/app")).toBe(true);
    expect(isRelatedProject("/work/other", "/work/app")).toBe(false);
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

  test("excludes the calling session", async () => {
    const db = await indexed([{ id: "me", cwd: "/work", text: "unique term" }]);
    expect(
      searchSessions(db, { query: "unique", cwd: "/work", excludeSessionId: "me" }).results,
    ).toEqual([]);
  });

  test("falls back to any-term matching and limits results", async () => {
    const db = await indexed(
      Array.from({ length: 25 }, (_, index) => ({ id: `s${index}`, cwd: "/w", text: "kiwi" })),
    );
    const report = searchSessions(db, {
      query: "kiwi mango",
      cwd: "/w",
      excludeSessionId: "",
      limit: 50,
    });
    expect(report.matchMode).toBe("any");
    expect(report.results).toHaveLength(SEARCH_LIMITS.maxResults);
  });
});
