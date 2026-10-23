import { afterEach, expect, test } from "bun:test";
import { WorkerDelivery, type WorkerNotice, workerStatus } from "../delivery";
import { WorkerOwner, type ChildDriver, type ChildDriverCallbacks, type ChildExecutionOutcome } from "../owner";
import type { ResolvedSpecialist } from "../specialist";

const instances: WorkerDelivery[] = [];
afterEach(async () => { for (const instance of instances.splice(0)) await instance.shutdown(); });
const config: ResolvedSpecialist = { name: "fixture", description: "Fixture", prompt: "ROLE_PROMPT", model: "fixture/model", maxTurns: 12, tools: ["read"], excludeTools: [], extensions: [], skills: [] };
const report = "full report ".repeat(10_000) + "FINAL_CAVEAT";
const completed: ChildExecutionOutcome = { kind: "completed", turnsUsed: 1, report };
const drain = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture(options: { immediate?: boolean; storageFailure?: boolean } = {}) {
  const runs = new Map<string, { resolve: (outcome: ChildExecutionOutcome) => void; callbacks: ChildDriverCallbacks }>();
  const notices: WorkerNotice[] = [];
  const errors: unknown[] = [];
  const driver: ChildDriver = {
    start(input, callbacks) {
      if (options.immediate) return Promise.resolve(completed);
      return new Promise((resolve) => { runs.set(input.workerId, { resolve, callbacks }); });
    },
    prompt(input, callbacks) { return this.start(input, callbacks); },
    async steer() {},
    async abort(id) { runs.get(id)?.resolve({ kind: "failed", turnsUsed: 0, error: "Aborted" }); },
    async close() { return { confirmed: true }; },
  };
  const owner = new WorkerOwner({ parentSessionId: "parent", driver, cleanupHealth: { isBlocked: () => false, markUncertain() {} },
    persistence: { async save() { if (options.storageFailure) throw new Error("disk full"); } },
  });
  const delivery = new WorkerDelivery(owner, (notice) => { notices.push(notice); }, (error) => { errors.push(error); });
  instances.push(delivery);
  return { owner, delivery, runs, notices, errors };
}
function launched(result: Awaited<ReturnType<WorkerDelivery["launch"]>>) {
  if (result.kind !== "launched") throw new Error("Expected background launch");
  return result;
}

test("background completion sends one structural receipt without report or investigation logs", async () => {
  const f = fixture();
  const launch = launched(await f.delivery.launch({ config, prompt: "TASK_PROMPT" }));
  f.runs.get(launch.workerId)!.callbacks.onTranscript({ role: "tool", text: "INVESTIGATION_LOG" });
  f.runs.get(launch.workerId)!.resolve(completed);
  await drain();
  expect(f.notices).toHaveLength(1);
  expect(f.notices[0]?.type).toBe("completion");
  expect(JSON.stringify(f.notices)).not.toContain("FINAL_CAVEAT");
  expect(JSON.stringify(workerStatus(f.owner.inspect(launch.workerId)))).not.toContain("INVESTIGATION_LOG");
  expect(JSON.stringify(f.notices)).not.toContain("ROLE_PROMPT");
  expect(f.owner.report(launch.workerId)).toBe(report);
  expect(f.errors).toEqual([]);
});

test("explicit wait returns full evidence and consumes the concurrent completion receipt", async () => {
  const f = fixture();
  const launch = launched(await f.delivery.launch({ config, prompt: "Task" }));
  const waiting = f.delivery.wait(launch.workerId, launch.assignmentId);
  f.runs.get(launch.workerId)!.resolve(completed);
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
  const waiting = f.delivery.wait(launch.workerId, launch.assignmentId, { signal: controller.signal });
  controller.abort();
  expect((await waiting).kind).toBe("interrupted");
  expect(f.owner.inspect(launch.workerId).status).toBe("running");
  f.runs.get(launch.workerId)!.resolve(completed);
  await drain();
  expect(f.notices.filter((notice) => notice.type === "completion")).toHaveLength(1);
});

test("foreground interruption confirms cancellation without cancelling independent background work", async () => {
  const f = fixture();
  const background = launched(await f.delivery.launch({ config, prompt: "Independent" }));
  const controller = new AbortController();
  const foreground = f.delivery.launch({ config, prompt: "Foreground" }, { foreground: true, signal: controller.signal });
  controller.abort();
  expect((await foreground).kind).toBe("cancelled");
  expect(f.owner.inspect(background.workerId).status).toBe("running");
});

test("a question is delivered only after the child execution segment has yielded", async () => {
  const f = fixture();
  const launch = launched(await f.delivery.launch({ config, prompt: "Task" }));
  const run = f.runs.get(launch.workerId)!;
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
  const unsubscribe = f.delivery.subscribePresentation(() => { visibilityChanges++; });
  const running = f.delivery.launch({ config, prompt: "Foreground task" }, { foreground: true, onProgress: (status) => { progress.push(status); } });
  await drain();
  const worker = f.owner.list()[0]!;
  expect(f.delivery.foregroundWorkerIds().has(worker.id)).toBe(true);
  const run = f.runs.get(worker.id)!;
  run.callbacks.onTurn(1);
  expect(progress.some((status) => status.assignments[0]?.turnsUsed === 1)).toBe(true);
  run.resolve(completed);
  expect((await running).kind).toBe("completed");
  expect(f.delivery.foregroundWorkerIds().size).toBe(0);
  expect(visibilityChanges).toBe(2);
  unsubscribe();
});
