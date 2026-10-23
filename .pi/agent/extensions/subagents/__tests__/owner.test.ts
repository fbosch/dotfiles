import { expect, test } from "bun:test";
import {
  ChildStartupFailedError,
  UnconfirmedChildStartupError,
  WorkerOwner,
  type LaunchReceipt,
  type ChildDriver,
  type ChildDriverCallbacks,
  type ChildExecutionOutcome,
  type ChildPromptInput,
  type ChildRunInput,
  type CleanupUncertainty,
  type ProcessCleanupHealth,
  type WorkerPersistence,
} from "../owner";
import type { ResolvedSpecialist } from "../specialist";

function config(): ResolvedSpecialist {
  return {
    name: "explore",
    description: "Bounded inspection",
    prompt: "Inspect carefully.",
    model: "presets/discovery",
    maxTurns: 12,
    tools: ["read"],
    excludeTools: ["subagent"],
    extensions: ["/policy.ts"],
    skills: [{ name: "analysis", path: "/SKILL.md" }],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class TestHealth implements ProcessCleanupHealth {
  blocked = false;
  readonly uncertainties: CleanupUncertainty[] = [];
  isBlocked() { return this.blocked; }
  markUncertain(uncertainty: CleanupUncertainty) {
    this.blocked = true;
    this.uncertainties.push(uncertainty);
  }
}

class TestPersistence implements WorkerPersistence {
  readonly evidence: Parameters<WorkerPersistence["save"]>[0][] = [];
  failure?: Error;
  pending?: Promise<void>;
  async save(evidence: Parameters<WorkerPersistence["save"]>[0]) {
    this.evidence.push(evidence);
    if (this.failure) throw this.failure;
    if (this.pending) await this.pending;
  }
}

class TestDriver implements ChildDriver {
  readonly starts: ChildRunInput[] = [];
  readonly prompts: ChildPromptInput[] = [];
  readonly callbacks: ChildDriverCallbacks[] = [];
  readonly aborts: string[] = [];
  readonly closes: string[] = [];
  startBehavior: (input: ChildRunInput, callbacks: ChildDriverCallbacks) => Promise<ChildExecutionOutcome> = async (input) => ({
    kind: "completed", turnsUsed: input.turnsAlreadyUsed + 1, report: "done",
  });
  promptBehavior: (input: ChildPromptInput, callbacks: ChildDriverCallbacks) => Promise<ChildExecutionOutcome> = async (input) => ({
    kind: "completed", turnsUsed: input.turnsAlreadyUsed + 1, report: "continued",
  });
  closeBehavior: () => Promise<{ readonly confirmed: boolean; readonly diagnostic?: string }> = async () => ({ confirmed: true });

  start(input: ChildRunInput, callbacks: ChildDriverCallbacks) {
    this.starts.push(input);
    this.callbacks.push(callbacks);
    return this.startBehavior(input, callbacks);
  }
  prompt(input: ChildPromptInput, callbacks: ChildDriverCallbacks) {
    this.prompts.push(input);
    this.callbacks.push(callbacks);
    return this.promptBehavior(input, callbacks);
  }
  async steer() {}
  async abort(workerId: string) { this.aborts.push(workerId); }
  async close(workerId: string) {
    this.closes.push(workerId);
    return this.closeBehavior();
  }
}

function setup(options: { capacity?: number; history?: ConstructorParameters<typeof WorkerOwner>[0]["historicalWorkers"] } = {}) {
  const driver = new TestDriver();
  const persistence = new TestPersistence();
  const health = new TestHealth();
  const owner = new WorkerOwner({
    parentSessionId: "parent-a",
    driver,
    persistence,
    cleanupHealth: health,
    ...(options.capacity === undefined ? {} : { capacity: options.capacity }),
    ...(options.history === undefined ? {} : { historicalWorkers: options.history }),
  });
  return { owner, driver, persistence, health };
}

async function flush() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function completed(turnsUsed: number, report = "done"): ChildExecutionOutcome {
  return { kind: "completed", turnsUsed, report };
}

test("queues the seventh launch behind the shared six-slot FIFO capacity", async () => {
  const { owner, driver } = setup();
  const active = Array.from({ length: 7 }, () => deferred<ChildExecutionOutcome>());
  driver.startBehavior = () => active[driver.starts.length - 1]!.promise;
  const launches: LaunchReceipt[] = [];
  for (let index = 0; index < 7; index++) launches.push(await owner.launch({ config: config(), prompt: `task ${index}` }));

  expect(driver.starts).toHaveLength(6);
  expect(owner.inspect(launches[6]!.workerId).status).toBe("queued");
  expect(owner.inspect(launches[0]!.workerId).status).toBe("running");
  active[0]!.resolve(completed(1));
  await flush();
  expect(driver.starts).toHaveLength(7);
  expect(driver.starts[6]!.prompt).toBe("task 6");
});

test("cancellation keeps its execution reservation until close confirms shutdown", async () => {
  const { owner, driver } = setup();
  const active = Array.from({ length: 7 }, () => deferred<ChildExecutionOutcome>());
  driver.startBehavior = () => active[driver.starts.length - 1]!.promise;
  const close = deferred<{ readonly confirmed: boolean }>();
  driver.closeBehavior = () => close.promise;
  const launches: LaunchReceipt[] = [];
  for (let index = 0; index < 7; index++) launches.push(await owner.launch({ config: config(), prompt: `task ${index}` }));

  await owner.cancel(launches[0]!.workerId);
  expect(owner.inspect(launches[0]!.workerId).status).toBe("stopping");
  expect(driver.aborts).toEqual([launches[0]!.workerId]);
  active[0]!.resolve(completed(1, "partial, not final"));
  await flush();
  expect(owner.inspect(launches[0]!.workerId).status).toBe("stopping");
  expect(owner.inspect(launches[6]!.workerId).status).toBe("queued");
  expect(driver.starts).toHaveLength(6);

  close.resolve({ confirmed: true });
  await flush();
  expect(owner.inspect(launches[0]!.workerId).status).toBe("cancelled");
  expect(owner.inspect(launches[6]!.workerId).status).toBe("running");
  expect(() => owner.report(launches[0]!.workerId)).toThrow("No final report");
});

test("worker IDs are scoped to the owning parent", async () => {
  const first = setup();
  const second = setup();
  const { workerId } = await first.owner.launch({ config: config(), prompt: "owned" });
  expect(() => second.owner.inspect(workerId)).toThrow("not owned by this parent");
  await first.owner.wait(workerId, first.owner.inspect(workerId).currentAssignmentId);
});

test("continuation is refused after cancellation, release, cleanup uncertainty, or historical restore", async () => {
  const cancelled = setup({ capacity: 1 });
  const blocker = deferred<ChildExecutionOutcome>();
  cancelled.driver.startBehavior = () => blocker.promise;
  await cancelled.owner.launch({ config: config(), prompt: "occupy slot" });
  const queued = await cancelled.owner.launch({ config: config(), prompt: "queued" });
  await cancelled.owner.cancel(queued.workerId);
  await expect(cancelled.owner.continue(queued.workerId, "again")).rejects.toThrow("Cannot continue");

  const released = setup();
  const done = await released.owner.launch({ config: config(), prompt: "done" });
  await released.owner.wait(done.workerId, done.assignmentId);
  await released.owner.release(done.workerId);
  await expect(released.owner.continue(done.workerId, "again")).rejects.toThrow("Cannot continue");

  const uncertain = setup();
  const running = deferred<ChildExecutionOutcome>();
  uncertain.driver.startBehavior = () => running.promise;
  uncertain.driver.closeBehavior = async () => ({ confirmed: false, diagnostic: "still active" });
  const active = await uncertain.owner.launch({ config: config(), prompt: "cancel me" });
  await uncertain.owner.cancel(active.workerId);
  running.resolve(completed(1));
  await flush();
  expect(uncertain.owner.inspect(active.workerId).status).toBe("cleanup-unknown");
  await expect(uncertain.owner.continue(active.workerId, "again")).rejects.toThrow("cleanup uncertainty");

  const source = setup();
  const completedWorker = await source.owner.launch({ config: config(), prompt: "save for history" });
  await source.owner.wait(completedWorker.workerId, completedWorker.assignmentId);
  const history = source.owner.inspect(completedWorker.workerId);
  const restored = setup({ history: [history] });
  expect(restored.owner.inspect(history.id).status).toBe("historical");
  await expect(restored.owner.continue(history.id, "again")).rejects.toThrow("Cannot continue");
});

test("timeouts and interrupted waits leave a background worker running", async () => {
  const { owner, driver } = setup();
  const running = deferred<ChildExecutionOutcome>();
  driver.startBehavior = () => running.promise;
  const receipt = await owner.launch({ config: config(), prompt: "background" });
  const timedOut = await owner.wait(receipt.workerId, receipt.assignmentId, { timeoutMs: 0 });
  expect(timedOut.kind).toBe("timeout");
  if (timedOut.kind !== "timeout") throw new Error("Expected a timeout result");
  expect(timedOut.cancelled).toBe(false);
  expect(owner.inspect(receipt.workerId).status).toBe("running");

  const controller = new AbortController();
  const interruptedWait = owner.wait(receipt.workerId, receipt.assignmentId, { signal: controller.signal });
  controller.abort();
  const interrupted = await interruptedWait;
  expect(interrupted.kind).toBe("interrupted");
  if (interrupted.kind !== "interrupted") throw new Error("Expected an interrupted result");
  expect(interrupted.cancelled).toBe(false);
  expect(owner.inspect(receipt.workerId).status).toBe("running");
  expect(driver.aborts).toEqual([]);
  running.resolve(completed(1));
});

test("question IDs correlate replies and assignment turn budget survives the yield", async () => {
  const { owner, driver } = setup();
  driver.startBehavior = async (_input, callbacks) => {
    callbacks.onTurn(2);
    callbacks.onQuestion("Which branch should I inspect?");
    return { kind: "waiting-question", turnsUsed: 2 };
  };
  let replyInput: ChildPromptInput | undefined;
  driver.promptBehavior = async (input) => {
    replyInput = input;
    return completed(4, "answered");
  };
  const receipt = await owner.launch({ config: config(), prompt: "inspect", maxTurns: 5 });
  const waiting = await owner.wait(receipt.workerId, receipt.assignmentId);
  expect(waiting.kind).toBe("question");
  if (waiting.kind !== "question" || !waiting.question) throw new Error("Expected correlated question");
  expect(waiting.question.workerId).toBe(receipt.workerId);
  expect(waiting.question.assignmentId).toBe(receipt.assignmentId);
  await expect(owner.reply(receipt.workerId, "stale-question", "wrong")).rejects.toThrow("not current");

  await owner.reply(receipt.workerId, waiting.question.id, "Use branch main");
  expect(replyInput?.purpose).toBe("question-reply");
  expect(replyInput?.questionId).toBe(waiting.question.id);
  expect(replyInput?.turnsAlreadyUsed).toBe(2);
  expect(replyInput?.turnBudget).toBe(3);
  const result = await owner.wait(receipt.workerId, receipt.assignmentId);
  expect(result.kind).toBe("completed");
  expect(result.assignment.remainingTurns).toBe(1);
  await expect(owner.reply(receipt.workerId, waiting.question.id, "stale again")).rejects.toThrow("not current");
});

test("explicit report retrieval preserves the complete long report", async () => {
  const { owner, driver } = setup();
  const report = `${"finding\n".repeat(20_000)}Caveat: this final line is material.`;
  driver.startBehavior = async (input) => completed(input.turnsAlreadyUsed + 1, report);
  const receipt = await owner.launch({ config: config(), prompt: "long report" });
  const result = await owner.wait(receipt.workerId, receipt.assignmentId);
  expect(result.kind).toBe("completed");
  expect(owner.report(receipt.workerId)).toBe(report);
  expect(result.assignment.report).toBe(report);
});

test("execution completion remains visible when evidence persistence fails", async () => {
  const { owner, persistence } = setup();
  persistence.failure = new Error("disk full");
  const receipt = await owner.launch({ config: config(), prompt: "complete" });
  const result = await owner.wait(receipt.workerId, receipt.assignmentId);
  await flush();
  expect(result.kind).toBe("completed");
  expect(owner.inspect(receipt.workerId).assignments[0]?.persistence).toBe("failed");
  expect(owner.report(receipt.workerId)).toBe("done");
});


test("unconfirmed partial startup blocks delegation and keeps cleanup uncertainty explicit", async () => {
  const { owner, driver, health } = setup();
  driver.startBehavior = async () => {
    throw new UnconfirmedChildStartupError("startup initialized resources without a disposable session");
  };
  const receipt = await owner.launch({ config: config(), prompt: "partial startup" });
  const result = await owner.wait(receipt.workerId, receipt.assignmentId);
  expect(result.kind).toBe("cleanup-unknown");
  expect(owner.inspect(receipt.workerId).status).toBe("cleanup-unknown");
  expect(health.isBlocked()).toBe(true);
  expect(health.uncertainties[0]?.diagnostic).toContain("without a disposable session");
  await expect(owner.launch({ config: config(), prompt: "blocked" })).rejects.toThrow("cleanup uncertainty");
});


test("list returns detached snapshots and freezes optional MCP configuration", async () => {
  const { owner } = setup();
  const mcpServers = ["docs"];
  const specialist = { ...config(), mcpServers };
  const receipt = await owner.launch({ config: specialist, prompt: "MCP config" });
  mcpServers.push("ambient");
  const listed = owner.list();
  expect(listed.map((worker) => worker.id)).toContain(receipt.workerId);
  expect(listed[0]?.config.mcpServers).toEqual(["docs"]);
  expect(Object.isFrozen(listed[0]?.config.mcpServers)).toBe(true);
});

test("lightweight status projections preserve display fields without transcript history", async () => {
  const { owner, driver } = setup();
  driver.startBehavior = (_input, callbacks) => {
    callbacks.onTranscript({ role: "tool", text: "Full investigation history" });
    return Promise.resolve(completed(1));
  };
  const launched = await owner.launch({ config: config(), prompt: "Investigate" });
  await owner.wait(launched.workerId, launched.assignmentId);

  const status = owner.findStatus(launched.workerId);
  if (!status) throw new Error("Expected a lightweight status projection");
  expect(status.status).toBe("idle");
  expect(status.specialist).toBe("explore");
  expect(status.config.model).toBe(config().model);
  expect(status.assignments[0]?.prompt).toBe("Investigate");
  expect(status.assignments[0]?.report).toBe("done");
  expect(status.assignments[0]?.turnsUsed).toBe(1);
  expect("transcript" in status.assignments[0]!).toBe(false);
  expect(owner.listStatus()).toEqual([status]);
  await owner.shutdown();
});

test("budget extension rejects stale assignments and unsafe overflow", async () => {
  const stale = setup();
  const original = await stale.owner.launch({ config: config(), prompt: "first" });
  await stale.owner.wait(original.workerId, original.assignmentId);
  const next = await stale.owner.continue(original.workerId, "second");
  await stale.owner.wait(next.workerId, next.assignmentId);
  await expect(stale.owner.extendBudget(original.workerId, original.assignmentId, 1)).rejects.toThrow("non-current");

  const overflow = setup();
  overflow.driver.startBehavior = async (_input, callbacks) => {
    callbacks.onQuestion("Need a decision");
    return { kind: "waiting-question", turnsUsed: 0 };
  };
  const huge = await overflow.owner.launch({ config: config(), prompt: "max budget", maxTurns: Number.MAX_SAFE_INTEGER });
  const question = await overflow.owner.wait(huge.workerId, huge.assignmentId);
  expect(question.kind).toBe("question");
  await expect(overflow.owner.extendBudget(huge.workerId, huge.assignmentId, 1)).rejects.toThrow("safe integer limit");
});

test("shutdown blocks admission and never starts queued work", async () => {
  const { owner, driver } = setup({ capacity: 1 });
  const active = deferred<ChildExecutionOutcome>();
  driver.startBehavior = () => active.promise;
  const first = await owner.launch({ config: config(), prompt: "active" });
  const queued = await owner.launch({ config: config(), prompt: "queued" });
  let finished = false;
  const shutdown = owner.shutdown().then(() => { finished = true; });
  await flush();

  expect(driver.starts).toHaveLength(1);
  expect(owner.inspect(queued.workerId).status).toBe("cancelled");
  await expect(owner.launch({ config: config(), prompt: "too late" })).rejects.toThrow("shutting down");
  await expect(owner.continue(first.workerId, "too late")).rejects.toThrow("shutting down");
  expect(finished).toBe(false);

  active.resolve(completed(1));
  await shutdown;
  expect(finished).toBe(true);
  expect(owner.inspect(first.workerId).status).toBe("cancelled");
  expect(driver.starts).toHaveLength(1);
});

test("shutdown waits for pending evidence persistence", async () => {
  const { owner, persistence } = setup();
  const save = deferred<void>();
  persistence.pending = save.promise;
  const receipt = await owner.launch({ config: { ...config(), mcpServers: ["docs"] }, prompt: "persist" });
  await owner.wait(receipt.workerId, receipt.assignmentId);
  await flush();
  expect(persistence.evidence[0]?.worker.config.mcpServers).toEqual(["docs"]);
  expect(persistence.evidence[0]?.worker.createdAt).toBeGreaterThan(0);

  let finished = false;
  const shutdown = owner.shutdown().then(() => { finished = true; });
  await flush();
  expect(finished).toBe(false);
  save.resolve();
  await shutdown;
  expect(finished).toBe(true);
});


test("shutdown cancels question-waiting workers and rejects their later replies", async () => {
  const { owner, driver } = setup();
  driver.startBehavior = async (_input, callbacks) => {
    callbacks.onQuestion("Need parent input");
    return { kind: "waiting-question", turnsUsed: 1 };
  };
  const receipt = await owner.launch({ config: config(), prompt: "ask" });
  const waiting = await owner.wait(receipt.workerId, receipt.assignmentId);
  expect(waiting.kind).toBe("question");
  if (waiting.kind !== "question" || !waiting.question) throw new Error("Expected a pending question");

  await owner.shutdown();
  expect(owner.inspect(receipt.workerId).status).toBe("cancelled");
  expect(owner.inspect(receipt.workerId).pendingQuestion).toBeUndefined();
  expect(driver.closes).toEqual([receipt.workerId]);
  await expect(owner.reply(receipt.workerId, waiting.question.id, "answer")).rejects.toThrow("shutting down");
});


test("clean child startup failure has no resumable live session", async () => {
  const { owner, driver } = setup();
  driver.startBehavior = async () => {
    throw new ChildStartupFailedError("preflight failed before a child session was created");
  };
  const receipt = await owner.launch({ config: config(), prompt: "cannot start" });
  const result = await owner.wait(receipt.workerId, receipt.assignmentId);
  expect(result.kind).toBe("failed");
  expect(owner.inspect(receipt.workerId).status).toBe("idle");
  expect(owner.inspect(receipt.workerId).liveSession).toBe("none");
  await expect(owner.continue(receipt.workerId, "retry")).rejects.toThrow("Cannot continue");
});
