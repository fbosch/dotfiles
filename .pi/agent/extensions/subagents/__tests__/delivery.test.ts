import { afterEach, expect, test } from "bun:test";
import { WorkerDelivery, type WorkerNotice, workerStatus } from "../delivery";
import {
  type ChildDriver,
  type ChildDriverCallbacks,
  type ChildExecutionOutcome,
  WorkerOwner,
} from "../owner";
import type { ResolvedSpecialist } from "../specialist";

const instances: WorkerDelivery[] = [];
afterEach(async () => {
  for (const instance of instances.splice(0)) await instance.shutdown();
});
const config: ResolvedSpecialist = {
  name: "fixture",
  description: "Fixture",
  prompt: "ROLE_PROMPT",
  model: "fixture/model",
  maxTurns: 12,
  tools: ["read"],
  excludeTools: [],
  extensions: [],
  skills: [],
};
const report = `${"full report ".repeat(10_000)}FINAL_CAVEAT`;
const completed: ChildExecutionOutcome = { kind: "completed", turnsUsed: 1, report };
const drain = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture(
  options: {
    immediate?: boolean;
    storageFailure?: boolean;
    parentSessionId?: string;
    notify?: (notice: WorkerNotice, updateDeliveryId?: string) => void;
  } = {},
) {
  const runs = new Map<
    string,
    { resolve: (outcome: ChildExecutionOutcome) => void; callbacks: ChildDriverCallbacks }
  >();
  const notices: WorkerNotice[] = [];
  const updateIds: string[] = [];
  const errors: unknown[] = [];
  const driver: ChildDriver = {
    start(input, callbacks) {
      if (options.immediate) return Promise.resolve(completed);
      return new Promise((resolve) => {
        runs.set(input.workerId, { resolve, callbacks });
      });
    },
    prompt(input, callbacks) {
      return this.start(input, callbacks);
    },
    async steer() {},
    async abort(id) {
      runs.get(id)?.resolve({ kind: "failed", turnsUsed: 0, error: "Aborted" });
    },
    async close() {
      return { confirmed: true };
    },
  };
  const owner = new WorkerOwner({
    parentSessionId: options.parentSessionId ?? "parent",
    driver,
    cleanupHealth: { isBlocked: () => false, markUncertain() {} },
    persistence: {
      async save() {
        if (options.storageFailure) throw new Error("disk full");
      },
    },
  });
  const delivery = new WorkerDelivery(
    owner,
    (notice, updateDeliveryId?: string) => {
      notices.push(notice);
      if (updateDeliveryId !== undefined) updateIds.push(updateDeliveryId);
      options.notify?.(notice, updateDeliveryId);
    },
    (error) => {
      errors.push(error);
    },
  );
  instances.push(delivery);
  return { owner, delivery, runs, notices, updateIds, errors };
}
function launched(result: Awaited<ReturnType<WorkerDelivery["launch"]>>) {
  if (result.kind !== "launched") throw new Error("Expected background launch");
  return result;
}
function execution(f: ReturnType<typeof fixture>, workerId: string) {
  const run = f.runs.get(workerId);
  if (!run) throw new Error("Missing execution");
  return run;
}

test("background completion sends one structural receipt without report or investigation logs", async () => {
  const f = fixture();
  const launch = launched(await f.delivery.launch({ config, prompt: "TASK_PROMPT" }));
  execution(f, launch.workerId).callbacks.onTranscript({ role: "tool", text: "INVESTIGATION_LOG" });
  execution(f, launch.workerId).resolve(completed);
  await drain();
  expect(f.notices).toHaveLength(1);
  expect(f.notices[0]?.type).toBe("completion");
  expect(JSON.stringify(f.notices)).not.toContain("FINAL_CAVEAT");
  expect(JSON.stringify(workerStatus(f.owner.inspect(launch.workerId)))).not.toContain(
    "INVESTIGATION_LOG",
  );
  expect(JSON.stringify(f.notices)).not.toContain("ROLE_PROMPT");
  expect(f.owner.report(launch.workerId)).toBe(report);
  expect(f.errors).toEqual([]);
});

test("explicit wait returns full evidence and consumes the concurrent completion receipt", async () => {
  const f = fixture();
  const launch = launched(await f.delivery.launch({ config, prompt: "Task" }));
  const waiting = f.delivery.wait(launch.workerId, launch.assignmentId);
  execution(f, launch.workerId).resolve(completed);
  const result = await waiting;
  await drain();
  expect(result.kind).toBe("completed");
  expect(result.report).toBe(report);
  expect(f.notices).toEqual([]);
});

test("abandoned background wait leaves the worker alive and preserves its later receipt", async () => {
  const f = fixture();
  const launch = launched(await f.delivery.launch({ config, prompt: "Task" }));
  const controller = new AbortController();
  const waiting = f.delivery.wait(launch.workerId, launch.assignmentId, {
    signal: controller.signal,
  });
  controller.abort();
  expect((await waiting).kind).toBe("interrupted");
  expect(f.owner.inspect(launch.workerId).status).toBe("running");
  execution(f, launch.workerId).resolve(completed);
  await drain();
  expect(f.notices.filter((notice) => notice.type === "completion")).toHaveLength(1);
});

test("foreground interruption confirms cancellation without cancelling independent background work", async () => {
  const f = fixture();
  const background = launched(await f.delivery.launch({ config, prompt: "Independent" }));
  const controller = new AbortController();
  const foreground = f.delivery.launch(
    { config, prompt: "Foreground" },
    { foreground: true, signal: controller.signal },
  );
  controller.abort();
  expect((await foreground).kind).toBe("cancelled");
  expect(f.owner.inspect(background.workerId).status).toBe("running");
});

test("a question is delivered only after the child execution segment has yielded", async () => {
  const f = fixture();
  const launch = launched(await f.delivery.launch({ config, prompt: "Task" }));
  const run = execution(f, launch.workerId);
  run.callbacks.onQuestion("Which target?");
  expect(f.notices).toEqual([]);
  run.resolve({ kind: "waiting-question", turnsUsed: 1 });
  await drain();
  expect(f.notices.filter((notice) => notice.type === "question")).toHaveLength(1);
  const result = await f.delivery.wait(launch.workerId, launch.assignmentId);
  expect(result.kind).toBe("question");
  expect(result.question?.text).toBe("Which target?");
  expect(f.notices.filter((notice) => notice.type === "question")).toHaveLength(1);
});

test("synchronous child completion cannot race past launch delivery registration", async () => {
  const f = fixture({ immediate: true });
  await f.delivery.launch({ config, prompt: "Task" });
  await drain();
  expect(f.notices.filter((notice) => notice.type === "completion")).toHaveLength(1);
});

test("foreground successful execution reports later storage failure without rerunning it", async () => {
  const f = fixture({ immediate: true, storageFailure: true });
  const result = await f.delivery.launch({ config, prompt: "Task" }, { foreground: true });
  await drain();
  expect(result.kind).toBe("completed");
  expect(f.owner.list()).toHaveLength(1);
  expect(f.notices.filter((notice) => notice.type === "storage-failure")).toHaveLength(1);
});

test("foreground progress is inline and its widget visibility ends when the wait settles", async () => {
  const f = fixture();
  const progress: Array<ReturnType<typeof workerStatus>> = [];
  let visibilityChanges = 0;
  const unsubscribe = f.delivery.subscribePresentation(() => {
    visibilityChanges++;
  });
  const running = f.delivery.launch(
    { config, prompt: "Foreground task" },
    {
      foreground: true,
      onProgress: (status) => {
        progress.push(status);
      },
    },
  );
  await drain();
  const worker = f.owner.list()[0];
  if (!worker) throw new Error("Missing worker");
  expect(f.delivery.foregroundWorkerIds().has(worker.id)).toBe(true);
  const run = execution(f, worker.id);
  run.callbacks.onTurn(1);
  expect(progress.some((status) => status.assignments[0]?.turnsUsed === 1)).toBe(true);
  run.resolve(completed);
  expect((await running).kind).toBe("completed");
  expect(f.delivery.foregroundWorkerIds().size).toBe(0);
  expect(visibilityChanges).toBe(2);
  unsubscribe();
});

test("tracked updates refresh independently at delivery without changing their original notices", async () => {
  const f = fixture();
  const launch = launched(await f.delivery.launch({ config, prompt: "Task" }));
  const run = f.runs.get(launch.workerId);
  if (!run) throw new Error("Missing execution");
  run.callbacks.onUpdate("FIRST_MATERIAL_FINDING");
  run.callbacks.onUpdate("SECOND_MATERIAL_FINDING");
  expect(f.updateIds).toHaveLength(2);
  const [firstId, secondId] = f.updateIds;
  if (!firstId || !secondId) throw new Error("Missing update delivery IDs");
  expect(firstId).not.toBe(secondId);
  expect(f.delivery.refreshUpdate(firstId)).toBeUndefined();
  expect(f.delivery.refreshUpdate(secondId)).toBeUndefined();

  run.resolve(completed);
  await f.delivery.wait(launch.workerId, launch.assignmentId);
  expect(f.delivery.refreshUpdate(firstId)).toEqual({
    type: "update",
    workerId: launch.workerId,
    assignmentId: launch.assignmentId,
    state: "completed",
    text: "FIRST_MATERIAL_FINDING",
  });
  expect(f.delivery.refreshUpdate(secondId)).toEqual({
    type: "update",
    workerId: launch.workerId,
    assignmentId: launch.assignmentId,
    state: "completed",
    text: "SECOND_MATERIAL_FINDING",
  });
  expect(f.notices.filter((notice) => notice.type === "update")).toEqual([
    {
      type: "update",
      workerId: launch.workerId,
      assignmentId: launch.assignmentId,
      state: "running",
      text: "FIRST_MATERIAL_FINDING",
    },
    {
      type: "update",
      workerId: launch.workerId,
      assignmentId: launch.assignmentId,
      state: "running",
      text: "SECOND_MATERIAL_FINDING",
    },
  ]);
  expect(f.delivery.refreshUpdate(firstId)).toBeUndefined();
  expect(f.delivery.refreshUpdate(secondId)).toBeUndefined();
  expect(f.errors).toEqual([]);
});

test.each(["parent", "other-parent"])(
  "tracked updates stay isolated from another runtime for %s",
  async (parentSessionId) => {
    const first = fixture();
    const other = fixture({ parentSessionId });
    const firstLaunch = launched(await first.delivery.launch({ config, prompt: "First" }));
    const otherLaunch = launched(await other.delivery.launch({ config, prompt: "Other" }));
    execution(first, firstLaunch.workerId).callbacks.onUpdate("FIRST_PARENT_FINDING");
    execution(other, otherLaunch.workerId).callbacks.onUpdate("OTHER_PARENT_FINDING");
    const [firstId] = first.updateIds;
    const [otherId] = other.updateIds;
    if (!firstId || !otherId) throw new Error("Missing update delivery IDs");
    expect(firstId).not.toBe(otherId);
    execution(first, firstLaunch.workerId).resolve(completed);
    execution(other, otherLaunch.workerId).resolve(completed);
    await Promise.all([
      first.delivery.wait(firstLaunch.workerId, firstLaunch.assignmentId),
      other.delivery.wait(otherLaunch.workerId, otherLaunch.assignmentId),
    ]);

    expect(first.delivery.refreshUpdate(otherId)).toBeUndefined();
    expect(other.delivery.refreshUpdate(firstId)).toBeUndefined();
    expect(first.delivery.refreshUpdate(firstId)).toMatchObject({
      workerId: firstLaunch.workerId,
      assignmentId: firstLaunch.assignmentId,
      state: "completed",
      text: "FIRST_PARENT_FINDING",
    });
    expect(other.delivery.refreshUpdate(otherId)).toMatchObject({
      workerId: otherLaunch.workerId,
      assignmentId: otherLaunch.assignmentId,
      state: "completed",
      text: "OTHER_PARENT_FINDING",
    });
  },
);

test("an earlier update retains its assignment outcome while a continuation is running", async () => {
  const f = fixture();
  const first = launched(await f.delivery.launch({ config, prompt: "First" }));
  execution(f, first.workerId).callbacks.onUpdate("FIRST_ASSIGNMENT_FINDING");
  const [firstId] = f.updateIds;
  if (!firstId) throw new Error("Missing update delivery ID");
  execution(f, first.workerId).resolve(completed);
  await f.delivery.wait(first.workerId, first.assignmentId);
  const next = await f.delivery.continue(first.workerId, "Next");
  expect(next.worker.state).toBe("running");
  expect(f.delivery.refreshUpdate(firstId)).toMatchObject({
    workerId: first.workerId,
    assignmentId: first.assignmentId,
    state: "completed",
    text: "FIRST_ASSIGNMENT_FINDING",
  });
});

test("shutdown closes pending update delivery before awaiting child cleanup", async () => {
  const f = fixture();
  const launch = launched(await f.delivery.launch({ config, prompt: "Task" }));
  execution(f, launch.workerId).callbacks.onUpdate("BEFORE_SHUTDOWN");
  const [id] = f.updateIds;
  if (!id) throw new Error("Missing update delivery ID");
  const closing = f.delivery.shutdown();
  expect(f.delivery.refreshUpdate(id)).toBeUndefined();
  await closing;
  expect(f.delivery.refreshUpdate(id)).toBeUndefined();
  expect(f.notices).toHaveLength(1);
  expect(f.owner.inspect(launch.workerId).status).toBe("cancelled");
  expect(f.errors).toEqual([]);
});

test("failed notification delivery releases the update without hiding the transport error", async () => {
  const failure = new Error("notification transport failed");
  const f = fixture({
    notify(notice) {
      if (notice.type === "update") throw failure;
    },
  });
  const launch = launched(await f.delivery.launch({ config, prompt: "Task" }));
  execution(f, launch.workerId).callbacks.onUpdate("UNDELIVERED_FINDING");
  const [id] = f.updateIds;
  if (!id) throw new Error("Missing update delivery ID");
  execution(f, launch.workerId).resolve(completed);
  await f.delivery.wait(launch.workerId, launch.assignmentId);
  expect(f.delivery.refreshUpdate(id)).toBeUndefined();
  expect(f.errors).toEqual([failure]);
});

test("a timed-out wait preserves the worker and its later completion receipt", async () => {
  const f = fixture();
  const launch = launched(await f.delivery.launch({ config, prompt: "Task" }));
  const result = await f.delivery.wait(launch.workerId, launch.assignmentId, { timeoutMs: 0 });
  expect(result.kind).toBe("timeout");
  expect(f.owner.inspect(launch.workerId).status).toBe("running");
  expect(f.notices).toEqual([]);
  execution(f, launch.workerId).resolve(completed);
  await drain();
  expect(f.notices.filter((notice) => notice.type === "completion")).toHaveLength(1);
});

test("an update remains eligible through question and reply until its assignment settles", async () => {
  const f = fixture();
  const launch = launched(await f.delivery.launch({ config, prompt: "Task" }));
  const first = execution(f, launch.workerId);
  first.callbacks.onUpdate("FINDING_BEFORE_QUESTION");
  const [id] = f.updateIds;
  if (!id) throw new Error("Missing update delivery ID");
  first.callbacks.onQuestion("Which target?");
  first.resolve({ kind: "waiting-question", turnsUsed: 1 });
  const waiting = await f.delivery.wait(launch.workerId, launch.assignmentId);
  if (waiting.kind !== "question" || !waiting.question) throw new Error("Missing question");
  expect(f.delivery.refreshUpdate(id)).toBeUndefined();
  await f.owner.reply(launch.workerId, waiting.question.id, "Target A");
  expect(f.delivery.refreshUpdate(id)).toBeUndefined();
  execution(f, launch.workerId).resolve(completed);
  await f.delivery.wait(launch.workerId, launch.assignmentId);
  expect(f.delivery.refreshUpdate(id)).toEqual({
    type: "update",
    workerId: launch.workerId,
    assignmentId: launch.assignmentId,
    state: "completed",
    text: "FINDING_BEFORE_QUESTION",
  });
  expect(f.delivery.refreshUpdate(id)).toBeUndefined();
});

const unsuccessfulOutcomes: Array<[string, ChildExecutionOutcome]> = [
  ["failed", { kind: "failed", turnsUsed: 1, error: "Fixture failure" }],
  [
    "budget-exhausted",
    { kind: "budget-exhausted", turnsUsed: 12, partialReport: "Partial evidence" },
  ],
];
for (const [state, outcome] of unsuccessfulOutcomes) {
  test(`tracked updates refresh to ${state} without becoming completion claims`, async () => {
    const f = fixture();
    const launch = launched(await f.delivery.launch({ config, prompt: "Task" }));
    execution(f, launch.workerId).callbacks.onUpdate("PARTIAL_FINDING");
    const [id] = f.updateIds;
    if (!id) throw new Error("Missing update delivery ID");
    execution(f, launch.workerId).resolve(outcome);
    await f.delivery.wait(launch.workerId, launch.assignmentId);
    expect(f.delivery.refreshUpdate(id)).toEqual({
      type: "update",
      workerId: launch.workerId,
      assignmentId: launch.assignmentId,
      state,
      text: "PARTIAL_FINDING",
    });
    expect(f.delivery.refreshUpdate(id)).toBeUndefined();
  });
}

test("a cancelled assignment refreshes its update without cancelling an independent worker", async () => {
  const f = fixture();
  const launch = launched(await f.delivery.launch({ config, prompt: "Cancel this" }));
  const independent = launched(await f.delivery.launch({ config, prompt: "Keep running" }));
  execution(f, launch.workerId).callbacks.onUpdate("BEFORE_CANCELLATION");
  const [id] = f.updateIds;
  if (!id) throw new Error("Missing update delivery ID");
  await f.owner.cancel(launch.workerId);
  await f.delivery.wait(launch.workerId, launch.assignmentId);
  expect(f.delivery.refreshUpdate(id)).toMatchObject({
    workerId: launch.workerId,
    assignmentId: launch.assignmentId,
    state: "cancelled",
    text: "BEFORE_CANCELLATION",
  });
  expect(f.owner.inspect(independent.workerId).status).toBe("running");
});

test("overlapping waits release only the interrupted claim and suppress a duplicate receipt", async () => {
  const f = fixture();
  const launch = launched(await f.delivery.launch({ config, prompt: "Task" }));
  const controller = new AbortController();
  const interrupted = f.delivery.wait(launch.workerId, launch.assignmentId, {
    signal: controller.signal,
  });
  const receiving = f.delivery.wait(launch.workerId, launch.assignmentId);
  controller.abort();
  expect((await interrupted).kind).toBe("interrupted");
  execution(f, launch.workerId).resolve(completed);
  const received = await receiving;
  expect(received.kind).toBe("completed");
  expect(received.report).toBe(report);
  await drain();
  expect(f.notices).toEqual([]);
});
