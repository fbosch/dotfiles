import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { searchSessions } from "../search";
import { HistoryStore, INDEX_FORMAT_VERSION } from "../store";
import { listSessionFiles, reconcile, syncFile } from "../sync";
import {
  appendEntries,
  assistant,
  header,
  jsonl,
  tempDir,
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

describe("listSessionFiles", () => {
  test("lists top-level sessions and excludes subagent child sessions", async () => {
    const { root } = await setup();
    const parent = writeSession(root, "--work--", "parent", [header("p", "/work")]);
    const childDir = join(root, "--work--", "parent", "tasks");
    mkdirSync(childDir, { recursive: true });
    writeFileSync(join(childDir, "child.jsonl"), jsonl([header("c", "/work"), user("child only")]));
    expect(await listSessionFiles(root)).toEqual([parent]);
  });
});

describe("reconcile", () => {
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

  test("excludes tool results from the index", async () => {
    const { root, store } = await setup();
    writeSession(root, "--work--", "a", [
      header("sa", "/work"),
      toolResult("zebrafish output"),
      user("visible"),
    ]);
    await reconcile(store, root);
    expect(find(store, "zebrafish")).toHaveLength(0);
    expect(find(store, "visible")).toHaveLength(1);
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
    const count = store.db.prepare("SELECT COUNT(*) AS n FROM chunks").get();
    expect(Number(count?.n)).toBe(1);
  });
});

describe("HistoryStore", () => {
  test("creates an owner-only index and rebuilds on a format mismatch", async () => {
    const { root, indexDir, store } = await setup();
    expect(statSync(indexDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(indexDir, "index.db")).mode & 0o777).toBe(0o600);
    writeSession(root, "--work--", "a", [header("sa", "/work"), user("alpha")]);
    await reconcile(store, root);
    store.db.prepare("UPDATE meta SET value = 'old' WHERE key = 'format'").run();
    store.close();
    const reopened = await HistoryStore.open(indexDir);
    stores.push(reopened);
    expect(reopened.sessionPaths()).toEqual([]);
    expect(reopened.db.prepare("SELECT value FROM meta WHERE key = 'format'").get()?.value).toBe(
      INDEX_FORMAT_VERSION,
    );
  });
});
