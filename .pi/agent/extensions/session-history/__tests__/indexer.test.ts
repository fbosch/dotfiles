import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { reconcile, syncFile } from "../indexer";
import { searchSessions } from "../search";
import { loadSqlite } from "../sqlite";
import { HistoryStore, INDEX_FORMAT_VERSION } from "../store";
import {
  appendEntries,
  assistant,
  compaction,
  header,
  jsonl,
  tempDir,
  title,
  toolResult,
  user,
  writeSession,
} from "./fixtures";

const cleanup: string[] = [];
const stores: HistoryStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
});

async function setup() {
  const root = tempDir("history-sessions-");
  const indexDir = tempDir("history-index-");
  cleanup.push(root, indexDir);
  const store = await HistoryStore.open(indexDir);
  stores.push(store);
  return { root, indexDir, store };
}

function find(store: HistoryStore, query: string) {
  return searchSessions(store, { query, cwd: "/elsewhere", excludeSessionId: "" }).results;
}

describe("indexed content", () => {
  test("indexes user text, assistant text, tool calls, compaction summaries, and titles", async () => {
    const { root, store } = await setup();
    writeSession(root, "--work--", "a", [
      header("sa", "/work"),
      user("fix the webhook retry"),
      assistant([
        { type: "text", text: "reading configuration" },
        { type: "toolCall", id: "c1", name: "read", arguments: { path: "src/billing.ts" } },
      ]),
      compaction("## Goal\nship the migration"),
      title("Webhook retries"),
    ]);
    await reconcile(store, root);
    for (const query of ["webhook", "configuration", "billing", "migration"])
      expect(find(store, query).map((result) => result.sessionId)).toEqual(["sa"]);
    expect(find(store, "webhook")[0]?.title).toBe("Webhook retries");
  });

  test("excludes tool results, thinking, and subagent child sessions", async () => {
    const { root, store } = await setup();
    writeSession(root, "--work--", "a", [
      header("sa", "/work"),
      toolResult("zebrafish output"),
      assistant([
        { type: "thinking", thinking: "secret reasoning" },
        { type: "text", text: "visible" },
      ]),
    ]);
    const childDir = join(root, "--work--", "a", "tasks");
    mkdirSync(childDir, { recursive: true });
    writeFileSync(
      join(childDir, "child.jsonl"),
      jsonl([header("child", "/work"), user("childonly")]),
    );
    await reconcile(store, root);
    expect(find(store, "visible")).toHaveLength(1);
    expect(find(store, "zebrafish")).toHaveLength(0);
    expect(find(store, "secret")).toHaveLength(0);
    expect(find(store, "childonly")).toHaveLength(0);
  });

  test("splits long messages into overlapping chunks at word boundaries", async () => {
    const { root, store } = await setup();
    const words = Array.from({ length: 900 }, (_, index) => `word${index}`);
    writeSession(root, "--work--", "a", [header("sa", "/work"), user(words.join(" "), "m1")]);
    await reconcile(store, root);
    const chunks = store.sessionStart("sa", 20);
    expect(chunks.length).toBeGreaterThan(3);
    const vocabulary = new Set(words);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(1_500);
      for (const token of chunk.text.split(" ")) expect(vocabulary.has(token)).toBe(true);
    }
    expect(chunks.at(-1)?.text.endsWith("word899")).toBe(true);
  });
});

describe("reconcile and syncFile", () => {
  test("indexes new sessions, then appends, rebuilds, and removes as files change", async () => {
    const { root, store } = await setup();
    const path = writeSession(root, "--work--", "a", [
      header("sa", "/work"),
      user("alpha webhook"),
    ]);
    expect(await reconcile(store, root)).toEqual({ files: 1, changed: 1, removed: 0 });
    expect(find(store, "alpha").map((result) => result.sessionId)).toEqual(["sa"]);

    appendEntries(path, [assistant([{ type: "text", text: "bravo retry" }])]);
    expect(await syncFile(store, path)).toBe("appended");
    expect(find(store, "bravo")).toHaveLength(1);
    expect(find(store, "alpha")).toHaveLength(1);

    writeFileSync(path, jsonl([header("sa", "/work"), user("charlie")]));
    expect(await syncFile(store, path)).toBe("reindexed");
    expect(find(store, "alpha")).toHaveLength(0);
    expect(find(store, "charlie")).toHaveLength(1);

    rmSync(path);
    expect(await reconcile(store, root)).toEqual({ files: 0, changed: 0, removed: 1 });
    expect(find(store, "charlie")).toHaveLength(0);
  });

  test("leaves an unterminated trailing line for a later sync", async () => {
    const { root, store } = await setup();
    const path = writeSession(root, "--work--", "a", [header("sa", "/work")]);
    writeFileSync(path, readFileSync(path, "utf8") + JSON.stringify(user("partial delta")));
    await syncFile(store, path);
    expect(find(store, "delta")).toHaveLength(0);
    writeFileSync(path, `${readFileSync(path, "utf8")}\n`);
    expect(await syncFile(store, path)).toBe("appended");
    expect(find(store, "delta")).toHaveLength(1);
  });

  test("never modifies session files", async () => {
    const { root, store } = await setup();
    const path = writeSession(root, "--work--", "a", [header("sa", "/work"), user("alpha")]);
    const before = { text: readFileSync(path, "utf8"), mtime: statSync(path).mtimeMs };
    await reconcile(store, root);
    find(store, "alpha");
    expect({ text: readFileSync(path, "utf8"), mtime: statSync(path).mtimeMs }).toEqual(before);
  });

  test("concurrent writers do not duplicate chunks", async () => {
    const { root, indexDir, store } = await setup();
    const other = await HistoryStore.open(indexDir);
    stores.push(other);
    writeSession(root, "--work--", "a", [header("sa", "/work"), user("echo")]);
    await Promise.all([reconcile(store, root), reconcile(other, root)]);
    expect(store.sessionStart("sa", 10)).toHaveLength(1);
  });
});

describe("HistoryStore", () => {
  test("creates an owner-only index and rebuilds on a format mismatch", async () => {
    const { root, indexDir, store } = await setup();
    expect(statSync(indexDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(indexDir, "index.db")).mode & 0o777).toBe(0o600);
    writeSession(root, "--work--", "a", [header("sa", "/work"), user("alpha")]);
    await reconcile(store, root);
    store.close();
    const { DatabaseSync } = await loadSqlite();
    const raw = new DatabaseSync(join(indexDir, "index.db"));
    raw.prepare("UPDATE meta SET value = 'old' WHERE key = 'format'").run();
    raw.close();
    const reopened = await HistoryStore.open(indexDir);
    stores.push(reopened);
    expect(reopened.sessionPaths()).toEqual([]);
    await reconcile(reopened, root);
    expect(find(reopened, "alpha")).toHaveLength(1);
    const check = new DatabaseSync(join(indexDir, "index.db"), { readOnly: true });
    expect(check.prepare("SELECT value FROM meta WHERE key = 'format'").get()?.value).toBe(
      INDEX_FORMAT_VERSION,
    );
    check.close();
  });
});
