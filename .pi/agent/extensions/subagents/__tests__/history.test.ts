import { afterEach, expect, test } from "bun:test";
import { appendFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HISTORY_ENTRY, parentHistory, restoreHistory } from "../history";
import { type ChildDriver, WorkerOwner, type WorkerPersistence } from "../owner";
import type { ResolvedSpecialist } from "../specialist";

const sdk: typeof import("@earendil-works/pi-coding-agent") = await import(
  process.env.PI_SUBAGENT_TEST_SDK ?? "@earendil-works/pi-coding-agent"
);
const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
const report = "report ".repeat(12_000) + "LAST_CAVEAT";
const config: ResolvedSpecialist = {
  name: "fixture",
  description: "Fixture",
  prompt: "Fixture",
  model: "fixture/model",
  maxTurns: 12,
  tools: ["read"],
  excludeTools: ["subagent"],
  extensions: [],
  skills: [],
};
const driver: ChildDriver = {
  async start(_input, callbacks) {
    callbacks.onTranscript({ role: "tool", text: "Full tool evidence" });
    return { kind: "completed", turnsUsed: 1, report };
  },
  async prompt() {
    return { kind: "completed", turnsUsed: 1, report };
  },
  async steer() {},
  async abort() {},
  async close() {
    return { confirmed: true };
  },
};
function owner(persistence: WorkerPersistence, parentSessionId = "parent") {
  return new WorkerOwner({
    parentSessionId,
    driver,
    persistence,
    cleanupHealth: { isBlocked: () => false, markUncertain() {} },
  });
}
async function fixture() {
  const path = await mkdtemp(join(tmpdir(), "pi-worker-history-"));
  directories.push(path);
  const file = join(path, "parent.jsonl");
  await writeFile(file, "");
  const persistence = parentHistory({
    parentSessionId: "parent",
    currentParentId: () => "parent",
    parentFile: () => file,
    observation: () => undefined,
    append(customType, data) {
      appendFileSync(file, JSON.stringify({ type: "custom", customType, data }) + "\n");
    },
  });
  return { file, persistence };
}

test("full reports and transcripts survive parent-file restoration without executable workers", async () => {
  const f = await fixture();
  expect(HISTORY_ENTRY).toBe("minimal-subagents.worker.v1");
  const live = owner(f.persistence);
  const launched = await live.launch({ config, prompt: "Investigate" });
  await live.wait(launched.workerId, launched.assignmentId);
  await live.shutdown();
  const entries: unknown[] = (await readFile(f.file, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const saved = restoreHistory(entries, "parent");
  const restored = new WorkerOwner({
    parentSessionId: "parent",
    driver,
    persistence: f.persistence,
    cleanupHealth: { isBlocked: () => false, markUncertain() {} },
    historicalWorkers: saved.map((entry) => entry.worker),
  });
  expect(restored.inspect(launched.workerId).liveSession).toBe("historical");
  expect(restored.report(launched.workerId)).toBe(report);
  expect(
    restored
      .transcript(launched.workerId)
      .entries.some((entry) => entry.text === "Full tool evidence"),
  ).toBe(true);
  expect(restored.inspect(launched.workerId).assignments[0]?.persistence).toBe("saved");
  await expect(restored.continue(launched.workerId, "Another assignment")).rejects.toThrow();
  await rm(f.file);
  expect(await Bun.file(f.file).exists()).toBe(false);
});

test("failed evidence writes leave successful reports available in memory", async () => {
  const live = owner({
    async save() {
      throw new Error("disk full");
    },
  });
  const launched = await live.launch({ config, prompt: "Investigate" });
  await live.wait(launched.workerId, launched.assignmentId);
  await live.shutdown();
  const assignment = live.inspect(launched.workerId).assignments[0];
  expect(assignment?.outcome).toBe("completed");
  expect(assignment?.persistence).toBe("failed");
  expect(assignment?.persistenceError).toContain("disk full");
  expect(live.report(launched.workerId)).toBe(report);
});

test("a fresh parent without a session file cannot claim evidence was saved", async () => {
  let appendCalls = 0;
  const persistence = parentHistory({
    parentSessionId: "parent",
    currentParentId: () => "parent",
    parentFile: () => undefined,
    append() {
      appendCalls++;
    },
    observation: () => undefined,
  });
  const live = owner(persistence);
  const launched = await live.launch({ config, prompt: "Investigate" });
  await live.wait(launched.workerId, launched.assignmentId);

  await live.shutdown();

  const assignment = live.inspect(launched.workerId).assignments[0];
  expect(assignment?.outcome).toBe("completed");
  expect(assignment?.persistence).toBe("failed");
  expect(assignment?.persistenceError).toContain("Parent session evidence is not persisted");
  expect(appendCalls).toBe(0);
  expect(live.report(launched.workerId)).toBe(report);
});

test("a later saved-marker append failure restores as failed, not saved", async () => {
  const f = await fixture();
  let appendCalls = 0;
  const persistence = parentHistory({
    parentSessionId: "parent",
    currentParentId: () => "parent",
    parentFile: () => f.file,
    append(customType, data) {
      appendCalls++;
      if (appendCalls === 2) throw new Error("saved marker append failed");
      appendFileSync(f.file, JSON.stringify({ type: "custom", customType, data }) + "\n");
    },
    observation: () => undefined,
  });
  const live = owner(persistence);
  const launched = await live.launch({ config, prompt: "Investigate" });
  await live.wait(launched.workerId, launched.assignmentId);

  await live.shutdown();

  const entries: unknown[] = (await readFile(f.file, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const restored = restoreHistory(entries, "parent");
  const assignment = restored[0]?.worker.assignments[0];
  expect(appendCalls).toBe(3);
  expect(assignment?.outcome).toBe("completed");
  expect(assignment?.persistence).toBe("failed");
  expect(assignment?.persistenceError).toContain("saved marker append failed");
  expect(live.report(launched.workerId)).toBe(report);
});

test("restored running records are inspectable but cannot wait on a nonexistent execution", async () => {
  const live = owner({ async save() {} });
  const launched = await live.launch({ config, prompt: "Investigate" });
  await live.wait(launched.workerId, launched.assignmentId);
  const snapshot = live.inspect(launched.workerId);
  await live.shutdown();
  const historical = new WorkerOwner({
    parentSessionId: "parent",
    driver,
    persistence: { async save() {} },
    cleanupHealth: { isBlocked: () => false, markUncertain() {} },
    historicalWorkers: [
      {
        ...snapshot,
        status: "running",
        assignments: snapshot.assignments.map((assignment) => ({
          ...assignment,
          outcome: "running",
        })),
      },
    ],
  });
  expect(historical.inspect(launched.workerId).status).toBe("historical");
  expect(() => historical.wait(launched.workerId, launched.assignmentId)).toThrow(
    "No live execution",
  );
});

test("malformed worker history is rejected instead of silently reviving or dropping evidence", () => {
  expect(() =>
    restoreHistory(
      [{ type: "custom", customType: HISTORY_ENTRY, data: { version: 1, worker: {} } }],
      "parent",
    ),
  ).toThrow("Invalid saved");
  expect(restoreHistory([{ type: "custom", customType: "unrelated", data: {} }], "parent")).toEqual(
    [],
  );
});

async function sessionFixture() {
  const path = await mkdtemp(join(tmpdir(), "pi-worker-session-history-"));
  directories.push(path);
  const manager = sdk.SessionManager.create(path, path);
  manager.appendMessage({ role: "user", content: "Parent", timestamp: 0 });
  const file = manager.getSessionFile();
  if (!file) throw new Error("Expected a persisted parent session");
  const persistence = parentHistory({
    parentSessionId: manager.getSessionId(),
    currentParentId: () => manager.getSessionId(),
    parentFile: () => file,
    append(customType, data) {
      manager.appendCustomEntry(customType, data);
    },
    observation: () => undefined,
  });
  return { manager, file, persistence };
}

test("failed SessionManager appends stay failed after an in-process history reload", async () => {
  const f = await sessionFixture();
  await rm(f.file);
  await mkdir(f.file);
  const live = owner(f.persistence, f.manager.getSessionId());
  const launched = await live.launch({ config, prompt: "Investigate" });
  await live.wait(launched.workerId, launched.assignmentId);

  const restored = restoreHistory(f.manager.getEntries(), f.manager.getSessionId());
  expect(restored[0]?.worker.assignments[0]?.persistence).toBe("failed");
  expect(restored[0]?.worker.assignments[0]?.persistenceError).toContain("EISDIR");
  await live.shutdown();
});

test("successful SessionManager writes restore as durable history", async () => {
  const f = await sessionFixture();
  const live = owner(f.persistence, f.manager.getSessionId());
  const launched = await live.launch({ config, prompt: "Investigate" });
  await live.wait(launched.workerId, launched.assignmentId);

  const entries: unknown[] = (await readFile(f.file, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const restored = restoreHistory(entries, f.manager.getSessionId());
  expect(restored[0]?.worker.assignments[0]?.persistence).toBe("saved");
  expect(restored[0]?.worker.assignments[0]?.report).toBe(report);
  await live.shutdown();
});
