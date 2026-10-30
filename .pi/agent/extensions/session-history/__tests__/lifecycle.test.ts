import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { HistoryIndex } from "../lifecycle";
import { searchSessions } from "../search";
import { appendEntries, header, tempDir, user, writeSession } from "./fixtures";

const cleanup: string[] = [];

afterEach(() => {
  for (const path of cleanup.splice(0)) {
    try {
      chmodSync(path, 0o700);
    } catch {
      // Already removed or never restricted.
    }
    rmSync(path, { recursive: true, force: true });
  }
});

function setup() {
  const root = tempDir("history-sessions-");
  const directory = tempDir("history-index-");
  cleanup.push(root, directory);
  return { root, index: new HistoryIndex(directory) };
}

async function find(index: HistoryIndex, query: string) {
  const store = await index.open();
  return searchSessions(store, { query, cwd: "/w", excludeSessionId: "" }).results;
}

describe("HistoryIndex", () => {
  test("reports updating until reconciliation finishes", async () => {
    const { root, index } = setup();
    for (let n = 0; n < 5; n++)
      writeSession(root, `--p${n}--`, `s${n}`, [header(`s${n}`, "/p"), user(`needle ${n}`)]);
    const done = index.reconcile(root);
    expect(index.status()).toEqual({ updating: true });
    await done;
    expect(index.status()).toEqual({ updating: false });
    expect(await find(index, "needle")).toHaveLength(5);
    await index.shutdown(undefined);
  });

  test("sync indexes appended turns after reconciliation, in queue order", async () => {
    const { root, index } = setup();
    const path = writeSession(root, "--w--", "a", [header("a", "/w")]);
    const reconciled = index.reconcile(root);
    appendEntries(path, [user("late arrival")]);
    const synced = index.sync(path);
    await Promise.all([reconciled, synced]);
    expect((await find(index, "arrival")).map((result) => result.sessionId)).toEqual(["a"]);
    await index.shutdown(undefined);
  });

  test("shutdown aborts reconciliation without reporting a failure, then syncs the current session", async () => {
    const { root, index } = setup();
    for (let n = 0; n < 30; n++)
      writeSession(root, `--p${n}--`, `s${n}`, [header(`s${n}`, "/p"), user("bulk")]);
    const current = writeSession(root, "--w--", "current", [
      header("current", "/w"),
      user("final words"),
    ]);
    const reconciling = index.reconcile(root);
    await index.shutdown(current);
    await reconciling;
    expect(index.status()).toEqual({ updating: false });
    expect((await find(index, "final")).map((result) => result.sessionId)).toEqual(["current"]);
    await index.shutdown(undefined);
  });

  test("reports sync failures through status instead of rejecting", async () => {
    const { root } = setup();
    const blocked = tempDir("history-blocked-");
    cleanup.push(blocked);
    chmodSync(blocked, 0o500);
    const index = new HistoryIndex(join(blocked, "index"));
    mkdirSync(root, { recursive: true });
    await expect(index.reconcile(root)).resolves.toBeUndefined();
    expect(index.status().failure).toBeString();
  });

  test("schedules no timers", async () => {
    const interval = spyOn(globalThis, "setInterval");
    const timeout = spyOn(globalThis, "setTimeout");
    const { root, index } = setup();
    writeSession(root, "--w--", "a", [header("a", "/w"), user("quiet")]);
    await index.reconcile(root);
    await index.sync(join(root, "--w--", "a.jsonl"));
    expect(interval).not.toHaveBeenCalled();
    expect(timeout).not.toHaveBeenCalled();
    interval.mockRestore();
    timeout.mockRestore();
    await index.shutdown(undefined);
  });
});
