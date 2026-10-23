import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parentHistory, restoreHistory } from "../history";
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
      manager.appendCustomEntry(customType, data);
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

test("fresh-parent buffering preserves failed evidence through a later flush and recovery", async () => {
  const f = await fixture();
  const launched = await f.owner.launch({ config, prompt: "Investigate" });
  await f.owner.wait(launched.workerId, launched.assignmentId);
  await f.owner.shutdown();
  const assignment = f.owner.inspect(launched.workerId).assignments[0];

  expect(assignment?.outcome).toBe("completed");
  expect(assignment?.persistence).toBe("failed");
  expect(assignment?.persistenceError).toContain("Parent session evidence is not persisted");
  expect(await Bun.file(f.file).exists()).toBe(false);
  expect(f.owner.report(launched.workerId)).toBe(report);
  const buffered = restoreHistory(f.manager.getEntries(), f.parentSessionId)[0]?.worker
    .assignments[0];
  expect(buffered?.persistence).toBe("failed");
  expect(buffered?.report).toBe(report);
  expect(buffered?.transcript[0]?.text).toBe(toolResult);
  expect(buffered?.budget).toEqual(assignment?.budget);

  f.manager.appendMessage({ role: "user", content: "Parent conversation", timestamp: 0 });
  const flushed = restoreHistory(
    sdk.SessionManager.open(f.file).getEntries(),
    f.parentSessionId,
  )[0];
  expect(flushed?.worker.assignments[0]?.persistence).toBe("failed");
  expect(flushed?.worker.assignments[0]?.report).toBe(report);
  expect(flushed?.worker.assignments[0]?.transcript[0]?.text).toBe(toolResult);
  expect(flushed?.worker.assignments[0]?.budget).toEqual(assignment?.budget);

  const nextOwner = f.createOwner();
  const next = await nextOwner.launch({ config, prompt: "Next assignment" });
  await nextOwner.wait(next.workerId, next.assignmentId);
  await nextOwner.shutdown();
  const recovered = restoreHistory(sdk.SessionManager.open(f.file).getEntries(), f.parentSessionId);
  const previous = recovered.find((item) => item.worker.id === launched.workerId);
  const current = recovered.find((item) => item.worker.id === next.workerId);
  expect(previous?.worker.assignments[0]?.persistence).toBe("failed");
  expect(previous?.worker.assignments[0]?.transcript[0]?.text).toBe(toolResult);
  expect(current?.worker.assignments[0]?.persistence).toBe("saved");
  expect(current?.worker.assignments[0]?.report).toBe(report);
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
