import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parentHistory, persistedHistoryIds, restoreHistory } from "../history";
import { type ChildDriver, WorkerOwner } from "../owner";
import type { ResolvedSpecialist } from "../specialist";

const sdk: typeof import("@earendil-works/pi-coding-agent") = await import(
  process.env.PI_SUBAGENT_TEST_SDK ?? "@earendil-works/pi-coding-agent"
);
const directories: string[] = [];
const owners: WorkerOwner[] = [];
afterEach(async () => {
  for (const owner of owners.splice(0)) await owner.shutdown();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

const report = `${"Complete report ".repeat(4_000)}LAST_CAVEAT`;
const toolResult = JSON.stringify({
  role: "toolResult",
  toolCallId: "read",
  toolName: "read",
  content: [{ type: "text", text: "Complete output ".repeat(2_000) }],
  details: { kind: "read", ok: true, evidence: "DETAILS_PRESERVED" },
  isError: false,
  timestamp: 0,
});
const config: ResolvedSpecialist = {
  name: "fixture",
  description: "Fixture",
  prompt: "Fixture",
  model: "fixture/model",
  maxTurns: 4,
  hardMaxTurns: 8,
  tools: ["read"],
  excludeTools: ["subagent"],
  extensions: [],
  skills: [],
};
const driver: ChildDriver = {
  async start(_input, callbacks) {
    callbacks.onTranscript({ role: "tool", text: toolResult });
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

async function fixture(bufferSavedMarker = false) {
  const directory = await mkdtemp(join(tmpdir(), "pi-parent-write-ack-"));
  directories.push(directory);
  const manager = sdk.SessionManager.create(directory, directory);
  const file = manager.getSessionFile();
  if (!file) throw new Error("Expected a configured parent path");
  const parentSessionId = manager.getSessionId();
  const persistence = parentHistory({
    parentSessionId,
    currentParentId: () => manager.getSessionId(),
    parentFile: () => file,
    awaitingFirstMessage: () => !manager.getEntries().some((entry) => entry.type === "message"),
    observation: () => undefined,
    append(customType, data) {
      if (
        bufferSavedMarker &&
        data.worker.assignments.some(
          (assignment) =>
            assignment.id === data.worker.currentAssignmentId && assignment.persistence === "saved",
        )
      ) {
        return;
      }
      return manager.appendCustomEntry(customType, data);
    },
  });
  const createOwner = () => {
    const owner = new WorkerOwner({
      parentSessionId,
      driver,
      persistence,
      cleanupHealth: { isBlocked: () => false, markUncertain() {} },
    });
    owners.push(owner);
    return owner;
  };
  return { manager, file, owner: createOwner(), parentSessionId, createOwner };
}

test("fresh-parent history stays buffered until the exact record reaches disk", async () => {
  const f = await fixture();
  const launched = await f.owner.launch({ config, prompt: "Investigate" });
  await f.owner.wait(launched.workerId, launched.assignmentId);
  await f.owner.shutdown();
  const assignment = () => f.owner.inspect(launched.workerId).assignments[0];

  expect(assignment()?.outcome).toBe("completed");
  expect(assignment()?.persistence).toBe("buffered");
  expect(assignment()?.persistenceError).toBeUndefined();
  expect(await Bun.file(f.file).exists()).toBe(false);
  expect(f.owner.report(launched.workerId)).toBe(report);

  f.owner.reconcileBuffered(() => new Set(["unrelated-entry"]));
  expect(assignment()?.persistence).toBe("buffered");
  const buffered = restoreHistory(f.manager.getEntries(), f.parentSessionId)[0]!;
  const reloaded = f.createOwner();
  reloaded.restoreHistorical(buffered.worker, buffered.bufferedEntryId);
  reloaded.reconcileBuffered(() => persistedHistoryIds(f.file));
  expect(reloaded.inspect(launched.workerId).assignments[0]?.persistence).toBe("buffered");

  f.manager.appendMessage({ role: "user", content: "Parent conversation", timestamp: 0 });
  const ids = () => persistedHistoryIds(f.file);
  f.owner.reconcileBuffered(ids);
  reloaded.reconcileBuffered(ids);

  expect(assignment()?.persistence).toBe("saved");
  expect(reloaded.inspect(launched.workerId).assignments[0]?.persistence).toBe("saved");
  const flushed = restoreHistory(sdk.SessionManager.open(f.file).getEntries(), f.parentSessionId)[0]!;
  expect(flushed.worker.assignments[0]?.report).toBe(report);
  expect(flushed.worker.assignments[0]?.transcript[0]?.text).toBe(toolResult);
  expect(flushed.worker.assignments[0]?.budget).toEqual(assignment()?.budget);

  const reopened = f.createOwner();
  reopened.restoreHistorical(flushed.worker, flushed.bufferedEntryId);
  reopened.reconcileBuffered(ids);
  expect(reopened.inspect(launched.workerId).assignments[0]?.persistence).toBe("saved");
});

test("an existing path cannot acknowledge a buffered append", async () => {
  const f = await fixture();
  await writeFile(f.file, "");
  const launched = await f.owner.launch({ config, prompt: "Investigate" });
  await f.owner.wait(launched.workerId, launched.assignmentId);
  await f.owner.shutdown();

  expect(f.owner.inspect(launched.workerId).assignments[0]?.persistence).toBe("failed");
  expect(Bun.file(f.file).size).toBe(0);
  const buffered = restoreHistory(f.manager.getEntries(), f.parentSessionId)[0]?.worker
    .assignments[0];
  expect(buffered?.persistence).toBe("failed");
  expect(buffered?.transcript[0]?.text).toBe(toolResult);
});

test("a buffered saved marker cannot acknowledge a completed write", async () => {
  const f = await fixture(true);
  f.manager.appendMessage({ role: "user", content: "Parent conversation", timestamp: 0 });
  const launched = await f.owner.launch({ config, prompt: "Investigate" });
  await f.owner.wait(launched.workerId, launched.assignmentId);
  await f.owner.shutdown();

  expect(f.owner.inspect(launched.workerId).assignments[0]?.persistence).toBe("failed");
  const restored = restoreHistory(
    sdk.SessionManager.open(f.file).getEntries(),
    f.parentSessionId,
  )[0];
  expect(restored?.worker.assignments[0]?.persistence).toBe("failed");
  expect(restored?.worker.assignments[0]?.report).toBe(report);
  expect(restored?.worker.assignments[0]?.transcript[0]?.text).toBe(toolResult);
});
