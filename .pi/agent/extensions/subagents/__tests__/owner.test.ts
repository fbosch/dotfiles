import { expect, test } from "bun:test";
import {
  type ChildDriver,
  type ChildDriverCallbacks,
  type ChildExecutionOutcome,
  type ChildPromptInput,
  type ChildRunInput,
  ChildStartupFailedError,
  type CleanupUncertainty,
  type LaunchReceipt,
  type ProcessCleanupHealth,
  UnconfirmedChildStartupError,
  WorkerOwner,
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
  isBlocked() {
    return this.blocked;
  }
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
  startBehavior: (
    input: ChildRunInput,
    callbacks: ChildDriverCallbacks,
  ) => Promise<ChildExecutionOutcome> = async (input) => ({
    kind: "completed",
    turnsUsed: input.turnsAlreadyUsed + 1,
    report: "done",
  });
  promptBehavior: (
    input: ChildPromptInput,
    callbacks: ChildDriverCallbacks,
  ) => Promise<ChildExecutionOutcome> = async (input) => ({
    kind: "completed",
    turnsUsed: input.turnsAlreadyUsed + 1,
    report: "continued",
  });
  closeBehavior: () => Promise<{ readonly confirmed: boolean; readonly diagnostic?: string }> =
    async () => ({ confirmed: true });

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
  async abort(workerId: string) {
    this.aborts.push(workerId);
  }
  async close(workerId: string) {
    this.closes.push(workerId);
    return this.closeBehavior();
  }
}

function setup(
  options: {
    capacity?: number;
    history?: ConstructorParameters<typeof WorkerOwner>[0]["historicalWorkers"];
    budget?: ConstructorParameters<typeof WorkerOwner>[0]["budget"];
  } = {},
) {
  const driver = new TestDriver();
  const persistence = new TestPersistence();
  const health = new TestHealth();
  const owner = new WorkerOwner({
    parentSessionId: "parent-a",
    driver,
    persistence,
    cleanupHealth: health,
    ...(options.capacity === undefined ? {} : { capacity: options.capacity }),
    ...(options.budget === undefined ? {} : { budget: options.budget }),
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
  for (let index = 0; index < 7; index++)
    launches.push(await owner.launch({ config: config(), prompt: `task ${index}` }));

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
  for (let index = 0; index < 7; index++)
    launches.push(await owner.launch({ config: config(), prompt: `task ${index}` }));

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
  await expect(cancelled.owner.continue(queued.workerId, "again")).rejects.toThrow(
    "Cannot continue",
  );

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
  await expect(uncertain.owner.continue(active.workerId, "again")).rejects.toThrow(
    "cleanup uncertainty",
  );

  const source = setup();
  const completedWorker = await source.owner.launch({
    config: config(),
    prompt: "save for history",
  });
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
  const interruptedWait = owner.wait(receipt.workerId, receipt.assignmentId, {
    signal: controller.signal,
  });
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
  if (waiting.kind !== "question" || !waiting.question)
    throw new Error("Expected correlated question");
  expect(waiting.question.workerId).toBe(receipt.workerId);
  expect(waiting.question.assignmentId).toBe(receipt.assignmentId);
  await expect(owner.reply(receipt.workerId, "stale-question", "wrong")).rejects.toThrow(
    "not current",
  );

  await owner.reply(receipt.workerId, waiting.question.id, "Use branch main");
  expect(replyInput?.purpose).toBe("question-reply");
  expect(replyInput?.questionId).toBe(waiting.question.id);
  expect(replyInput?.turnsAlreadyUsed).toBe(2);
  expect(replyInput?.turnBudget).toBe(3);
  const result = await owner.wait(receipt.workerId, receipt.assignmentId);
  expect(result.kind).toBe("completed");
  expect(result.assignment.remainingTurns).toBe(1);
  await expect(owner.reply(receipt.workerId, waiting.question.id, "stale again")).rejects.toThrow(
    "not current",
  );
});

test("launch and continuation budgets honor role and assignment ceilings", async () => {
  const { owner, driver } = setup({ budget: { mode: "fixed" } });
  const specialist = { ...config(), hardMaxTurns: 10 };
  const firstRun = deferred<ChildExecutionOutcome>();
  driver.startBehavior = () => firstRun.promise;

  await expect(
    owner.launch({ config: specialist, prompt: "raised cap", maxTurns: 3, hardMaxTurns: 11 }),
  ).rejects.toThrow("must not raise the configured specialist ceiling");
  await expect(
    owner.launch({ config: config(), prompt: "uncapped role", maxTurns: 3, hardMaxTurns: 3 }),
  ).rejects.toThrow("must not raise the configured specialist ceiling");
  await expect(
    owner.launch({ config: specialist, prompt: "too-small cap", maxTurns: 4, hardMaxTurns: 3 }),
  ).rejects.toThrow("maxTurns exceeds the configured assignment ceiling");

  const receipt = await owner.launch({
    config: specialist,
    prompt: "bounded launch",
    maxTurns: 4,
    hardMaxTurns: 6,
  });
  const launched = owner.inspect(receipt.workerId);
  const initial = launched.assignments[0]!;
  expect(launched.config.hardMaxTurns).toBe(10);
  expect(initial.maxTurns).toBe(4);
  expect(initial.remainingTurns).toBe(4);
  expect(initial.budget).toMatchObject({
    initialTurns: 4,
    grantedTurns: 4,
    hardMaxTurns: 6,
    mode: "fixed",
  });

  firstRun.resolve(completed(1));
  await owner.wait(receipt.workerId, receipt.assignmentId);
  await expect(owner.continue(receipt.workerId, "raised continuation", 4, 11)).rejects.toThrow(
    "must not raise the configured specialist ceiling",
  );
  await expect(owner.continue(receipt.workerId, "too-small continuation", 4, 3)).rejects.toThrow(
    "maxTurns exceeds the configured assignment ceiling",
  );

  const next = await owner.continue(receipt.workerId, "bounded continuation", 2, 10);
  const continued = owner
    .inspect(next.workerId)
    .assignments.find(({ id }) => id === next.assignmentId);
  expect(continued?.maxTurns).toBe(2);
  expect(continued?.remainingTurns).toBe(1);
  expect(continued?.budget).toMatchObject({
    initialTurns: 2,
    grantedTurns: 2,
    hardMaxTurns: 10,
    mode: "fixed",
  });
});

test("questions preserve one budget and manual extensions stop at its ceiling", async () => {
  const { owner, driver } = setup();
  driver.startBehavior = async (_input, callbacks) => {
    callbacks.onTurn(1);
    callbacks.onQuestion("Can I proceed?");
    return { kind: "waiting-question", turnsUsed: 1 };
  };

  const receipt = await owner.launch({
    config: { ...config(), hardMaxTurns: 9 },
    prompt: "ask then continue",
    maxTurns: 4,
    hardMaxTurns: 5,
  });
  const waiting = await owner.wait(receipt.workerId, receipt.assignmentId);
  expect(waiting.kind).toBe("question");
  if (waiting.kind !== "question" || !waiting.question)
    throw new Error("Expected a pending question");
  expect(waiting.assignment.budget).toMatchObject({
    initialTurns: 4,
    grantedTurns: 4,
    hardMaxTurns: 5,
  });

  const extended = await owner.extendBudget(receipt.workerId, receipt.assignmentId, 1);
  const afterExtension = extended.assignments[0]!;
  expect(afterExtension.maxTurns).toBe(5);
  expect(afterExtension.remainingTurns).toBe(4);
  expect(afterExtension.budget).toMatchObject({
    initialTurns: 4,
    grantedTurns: 5,
    hardMaxTurns: 5,
  });
  await expect(owner.extendBudget(receipt.workerId, receipt.assignmentId, 1)).rejects.toThrow(
    "configured ceiling",
  );

  await owner.reply(receipt.workerId, waiting.question.id, "Proceed");
  const result = await owner.wait(receipt.workerId, receipt.assignmentId);
  expect(result.kind).toBe("completed");
  expect(driver.prompts[0]?.turnsAlreadyUsed).toBe(1);
  expect(driver.prompts[0]?.turnBudget).toBe(4);
  expect(result.assignment.budget).toMatchObject({
    initialTurns: 4,
    grantedTurns: 5,
    hardMaxTurns: 5,
  });
});

test("older historical assignments keep their allowance without invented budget metadata", async () => {
  const source = setup();
  const receipt = await source.owner.launch({ config: config(), prompt: "legacy evidence" });
  await source.owner.wait(receipt.workerId, receipt.assignmentId);
  const snapshot = source.owner.inspect(receipt.workerId);
  const legacy = {
    ...snapshot,
    assignments: snapshot.assignments.map((assignment) => {
      const legacyAssignment = { ...assignment };
      delete legacyAssignment.budget;
      return legacyAssignment;
    }),
  };

  const restored = setup({ history: [legacy] });
  const worker = restored.owner.inspect(receipt.workerId);
  const assignment = worker.assignments[0]!;
  expect(worker.status).toBe("historical");
  expect(assignment.maxTurns).toBe(12);
  expect(assignment.remainingTurns).toBe(11);
  expect(assignment.budget).toBeUndefined();
  await expect(restored.owner.extendBudget(receipt.workerId, assignment.id, 1)).rejects.toThrow(
    "Cannot extend assignment budget in historical state",
  );
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
    throw new UnconfirmedChildStartupError(
      "startup initialized resources without a disposable session",
    );
  };
  const receipt = await owner.launch({ config: config(), prompt: "partial startup" });
  const result = await owner.wait(receipt.workerId, receipt.assignmentId);
  expect(result.kind).toBe("cleanup-unknown");
  expect(owner.inspect(receipt.workerId).status).toBe("cleanup-unknown");
  expect(health.isBlocked()).toBe(true);
  expect(health.uncertainties[0]?.diagnostic).toContain("without a disposable session");
  await expect(owner.launch({ config: config(), prompt: "blocked" })).rejects.toThrow(
    "cleanup uncertainty",
  );
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
  await expect(
    stale.owner.extendBudget(original.workerId, original.assignmentId, 1),
  ).rejects.toThrow("non-current");

  const overflow = setup();
  overflow.driver.startBehavior = async (_input, callbacks) => {
    callbacks.onQuestion("Need a decision");
    return { kind: "waiting-question", turnsUsed: 0 };
  };
  const huge = await overflow.owner.launch({
    config: config(),
    prompt: "max budget",
    maxTurns: Number.MAX_SAFE_INTEGER,
  });
  const question = await overflow.owner.wait(huge.workerId, huge.assignmentId);
  expect(question.kind).toBe("question");
  await expect(overflow.owner.extendBudget(huge.workerId, huge.assignmentId, 1)).rejects.toThrow(
    "safe integer limit",
  );
});

test("shutdown blocks admission and never starts queued work", async () => {
  const { owner, driver } = setup({ capacity: 1 });
  const active = deferred<ChildExecutionOutcome>();
  driver.startBehavior = () => active.promise;
  const first = await owner.launch({ config: config(), prompt: "active" });
  const queued = await owner.launch({ config: config(), prompt: "queued" });
  let finished = false;
  const shutdown = owner.shutdown().then(() => {
    finished = true;
  });
  await flush();

  expect(driver.starts).toHaveLength(1);
  expect(owner.inspect(queued.workerId).status).toBe("cancelled");
  await expect(owner.launch({ config: config(), prompt: "too late" })).rejects.toThrow(
    "shutting down",
  );
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
  const receipt = await owner.launch({
    config: { ...config(), mcpServers: ["docs"] },
    prompt: "persist",
  });
  await owner.wait(receipt.workerId, receipt.assignmentId);
  await flush();
  expect(persistence.evidence[0]?.worker.config.mcpServers).toEqual(["docs"]);
  expect(persistence.evidence[0]?.worker.createdAt).toBeGreaterThan(0);

  let finished = false;
  const shutdown = owner.shutdown().then(() => {
    finished = true;
  });
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
  if (waiting.kind !== "question" || !waiting.question)
    throw new Error("Expected a pending question");

  await owner.shutdown();
  expect(owner.inspect(receipt.workerId).status).toBe("cancelled");
  expect(owner.inspect(receipt.workerId).pendingQuestion).toBeUndefined();
  expect(driver.closes).toEqual([receipt.workerId]);
  await expect(owner.reply(receipt.workerId, waiting.question.id, "answer")).rejects.toThrow(
    "shutting down",
  );
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

test("owner admissions coalesce checkpoints, retain reservations, and grant 16 to 20 to 24", async () => {
  type Judgment = { readonly kind: "judgment"; readonly probability: number };
  const answers = [deferred<Judgment>(), deferred<Judgment>()];
  let adviceCalls = 0;
  const { owner, driver } = setup({
    capacity: 1,
    budget: {
      mode: "automatic",
      confidenceThreshold: 0.8,
      advisor: async () => answers[adviceCalls++]!.promise,
    },
  });
  const run = deferred<ChildExecutionOutcome>();
  driver.startBehavior = () => run.promise;
  const updates: string[] = [];
  owner.subscribe((event) => {
    if (event.type === "update") updates.push(event.text);
  });

  const receipt = await owner.launch({
    config: { ...config(), hardMaxTurns: 24 },
    prompt: "bounded work",
    maxTurns: 16,
  });
  const callbacks = driver.callbacks[0]!;
  const onBeforeModel = callbacks.onBeforeModel;
  const onToolOutcome = callbacks.onToolOutcome;
  if (!onBeforeModel || !onToolOutcome) throw new Error("Expected owner budget callbacks");
  callbacks.onTurn(15);
  onToolOutcome("success");

  const firstCheck = onBeforeModel();
  const duplicateCheck = onBeforeModel();
  await flush();
  expect(adviceCalls).toBe(1);

  const queued = await owner.launch({ config: config(), prompt: "wait behind active segment" });
  expect(owner.inspect(queued.workerId).status).toBe("queued");
  expect(driver.starts).toHaveLength(1);

  answers[0]!.resolve({ kind: "judgment", probability: 1 });
  const [first, duplicate] = await Promise.all([firstCheck, duplicateCheck]);
  expect(first).toEqual({ maxTurns: 20, admitted: true });
  expect(duplicate).toEqual(first);
  expect(owner.inspect(receipt.workerId).assignments[0]?.budget).toMatchObject({
    initialTurns: 16,
    grantedTurns: 20,
    hardMaxTurns: 24,
    automaticGrants: 1,
    checks: 1,
  });
  expect(updates).toEqual(["Granted 4 additional turns; allowance 20, ceiling 24."]);

  const repeated = await onBeforeModel();
  expect(repeated).toEqual({ maxTurns: 20, admitted: true });
  expect(adviceCalls).toBe(1);
  expect(updates).toHaveLength(1);

  callbacks.onTurn(19);
  onToolOutcome("success");
  const secondCheck = onBeforeModel();
  await flush();
  expect(adviceCalls).toBe(2);
  answers[1]!.resolve({ kind: "judgment", probability: 1 });
  expect(await secondCheck).toEqual({ maxTurns: 24, admitted: true });
  expect(owner.inspect(receipt.workerId).assignments[0]?.budget).toMatchObject({
    initialTurns: 16,
    grantedTurns: 24,
    hardMaxTurns: 24,
    automaticGrants: 2,
    checks: 2,
  });
  expect(updates).toEqual([
    "Granted 4 additional turns; allowance 20, ceiling 24.",
    "Granted 4 additional turns; allowance 24, ceiling 24.",
  ]);

  callbacks.onTurn(23);
  onToolOutcome("success");
  expect(await onBeforeModel()).toEqual({ maxTurns: 24, admitted: true });
  expect(adviceCalls).toBe(2);

  await owner.cancel(queued.workerId);
  run.resolve(completed(23));
  await owner.wait(receipt.workerId, receipt.assignmentId);
});

test("owner clamps a final adaptive increment to the assignment ceiling", async () => {
  let adviceCalls = 0;
  const { owner, driver } = setup({
    budget: {
      mode: "automatic",
      confidenceThreshold: 0.8,
      advisor: async () => {
        adviceCalls++;
        return { kind: "judgment", probability: 1 };
      },
    },
  });
  const run = deferred<ChildExecutionOutcome>();
  driver.startBehavior = () => run.promise;
  const updates: string[] = [];
  owner.subscribe((event) => {
    if (event.type === "update") updates.push(event.text);
  });
  const receipt = await owner.launch({
    config: { ...config(), hardMaxTurns: 22 },
    prompt: "clamp the reserve",
    maxTurns: 16,
  });
  const callbacks = driver.callbacks[0]!;
  const onBeforeModel = callbacks.onBeforeModel;
  const onToolOutcome = callbacks.onToolOutcome;
  if (!onBeforeModel || !onToolOutcome) throw new Error("Expected owner budget callbacks");

  callbacks.onTurn(15);
  onToolOutcome("success");
  expect(await onBeforeModel()).toEqual({ maxTurns: 20, admitted: true });
  callbacks.onTurn(19);
  onToolOutcome("success");
  expect(await onBeforeModel()).toEqual({ maxTurns: 22, admitted: true });
  expect(adviceCalls).toBe(2);
  expect(updates).toEqual([
    "Granted 4 additional turns; allowance 20, ceiling 22.",
    "Granted 2 additional turns; allowance 22, ceiling 22.",
  ]);

  callbacks.onTurn(21);
  onToolOutcome("success");
  expect(await onBeforeModel()).toEqual({ maxTurns: 22, admitted: true });
  expect(adviceCalls).toBe(2);
  run.resolve(completed(21));
  await owner.wait(receipt.workerId, receipt.assignmentId);
});

test("questions invalidate pending advice and preserve budget history through extension and reply", async () => {
  type Judgment = { readonly kind: "judgment"; readonly probability: number };
  const answer = deferred<Judgment>();
  const { owner, driver } = setup({
    budget: {
      mode: "automatic",
      confidenceThreshold: 0.8,
      advisor: async () => answer.promise,
    },
  });
  const firstRun = deferred<ChildExecutionOutcome>();
  const replyRun = deferred<ChildExecutionOutcome>();
  driver.startBehavior = () => firstRun.promise;
  driver.promptBehavior = () => replyRun.promise;
  const updates: string[] = [];
  owner.subscribe((event) => {
    if (event.type === "update") updates.push(event.text);
  });

  const receipt = await owner.launch({
    config: { ...config(), hardMaxTurns: 24 },
    prompt: "ask before proceeding",
    maxTurns: 16,
  });
  const callbacks = driver.callbacks[0]!;
  const onBeforeModel = callbacks.onBeforeModel;
  const onToolOutcome = callbacks.onToolOutcome;
  if (!onBeforeModel || !onToolOutcome) throw new Error("Expected owner budget callbacks");
  callbacks.onTurn(15);
  onToolOutcome("success");
  const pending = onBeforeModel();
  await flush();

  callbacks.onQuestion("Which option?");
  expect(await pending).toEqual({ maxTurns: 16, admitted: false });
  firstRun.resolve({ kind: "waiting-question", turnsUsed: 15 });
  const waiting = await owner.wait(receipt.workerId, receipt.assignmentId);
  if (waiting.kind !== "question" || !waiting.question)
    throw new Error("Expected a pending question");
  expect(waiting.assignment.budget).toMatchObject({
    initialTurns: 16,
    grantedTurns: 16,
    hardMaxTurns: 24,
    checks: 1,
    progress: { completedTools: 1, verifiedSuccesses: 1, failures: 0 },
  });

  answer.resolve({ kind: "judgment", probability: 1 });
  await flush();
  expect(owner.inspect(receipt.workerId).assignments[0]?.budget).toMatchObject({
    grantedTurns: 16,
    automaticGrants: 0,
  });

  const extended = await owner.extendBudget(receipt.workerId, receipt.assignmentId, 4);
  expect(extended.assignments[0]?.budget).toMatchObject({
    initialTurns: 16,
    grantedTurns: 20,
    hardMaxTurns: 24,
    checks: 1,
    revision: 1,
  });
  await owner.reply(receipt.workerId, waiting.question.id, "Choose the safer option");
  const replyCallbacks = driver.callbacks[1]!;
  const replyOutcome = replyCallbacks.onToolOutcome;
  if (!replyOutcome) throw new Error("Expected reply budget callback");
  replyCallbacks.onTurn(16);
  replyOutcome("failure");
  expect(driver.prompts[0]?.turnsAlreadyUsed).toBe(15);
  expect(driver.prompts[0]?.turnBudget).toBe(5);
  expect(owner.inspect(receipt.workerId).assignments[0]?.budget).toMatchObject({
    initialTurns: 16,
    grantedTurns: 20,
    hardMaxTurns: 24,
    checks: 1,
    revision: 1,
    progress: { completedTools: 2, verifiedSuccesses: 1, failures: 1, consecutiveFailures: 1 },
  });

  replyRun.resolve(completed(16));
  const result = await owner.wait(receipt.workerId, receipt.assignmentId);
  expect(result.kind).toBe("completed");
  expect(result.assignment.budget).toMatchObject({
    initialTurns: 16,
    grantedTurns: 20,
    hardMaxTurns: 24,
    checks: 1,
    revision: 1,
  });
  expect(updates).toEqual([]);
});

test("cancellation discards late advice without releasing an uncertain execution reservation", async () => {
  type Judgment = { readonly kind: "judgment"; readonly probability: number };
  const answer = deferred<Judgment>();
  const { owner, driver } = setup({
    budget: {
      mode: "automatic",
      confidenceThreshold: 0.8,
      advisor: async () => answer.promise,
    },
  });
  const run = deferred<ChildExecutionOutcome>();
  driver.startBehavior = () => run.promise;
  driver.closeBehavior = async () => ({ confirmed: false, diagnostic: "close not confirmed" });
  const updates: string[] = [];
  owner.subscribe((event) => {
    if (event.type === "update") updates.push(event.text);
  });
  const receipt = await owner.launch({
    config: { ...config(), hardMaxTurns: 24 },
    prompt: "cancel during admission",
    maxTurns: 16,
  });
  const callbacks = driver.callbacks[0]!;
  const onBeforeModel = callbacks.onBeforeModel;
  const onToolOutcome = callbacks.onToolOutcome;
  if (!onBeforeModel || !onToolOutcome) throw new Error("Expected owner budget callbacks");
  callbacks.onTurn(15);
  onToolOutcome("success");
  const pending = onBeforeModel();
  await flush();

  expect((await owner.cancel(receipt.workerId)).status).toBe("stopping");
  expect(driver.aborts).toEqual([receipt.workerId]);
  expect(await pending).toEqual({ maxTurns: 16, admitted: false });
  answer.resolve({ kind: "judgment", probability: 1 });
  await flush();
  onToolOutcome("failure");
  expect(owner.inspect(receipt.workerId).assignments[0]?.budget).toMatchObject({
    grantedTurns: 16,
    automaticGrants: 0,
    progress: { completedTools: 1, failures: 0 },
  });
  expect(updates).toEqual([]);

  run.resolve({
    kind: "failed",
    turnsUsed: 15,
    error: "cancelled",
    partialReport: "partial failure evidence",
  });
  const result = await owner.wait(receipt.workerId, receipt.assignmentId);
  if (result.kind !== "cleanup-unknown")
    throw new Error("Expected unconfirmed cancellation cleanup");
  expect(result.assignment.partialReport).toBe("partial failure evidence");
  expect(result.assignment.budget?.grantedTurns).toBe(16);
  expect(driver.closes).toEqual([receipt.workerId]);
});

test("shutdown invalidates pending advice and retains partial output without late grants", async () => {
  type Judgment = { readonly kind: "judgment"; readonly probability: number };
  const answer = deferred<Judgment>();
  const { owner, driver } = setup({
    budget: {
      mode: "automatic",
      confidenceThreshold: 0.8,
      advisor: async () => answer.promise,
    },
  });
  const run = deferred<ChildExecutionOutcome>();
  driver.startBehavior = () => run.promise;
  const updates: string[] = [];
  owner.subscribe((event) => {
    if (event.type === "update") updates.push(event.text);
  });
  const receipt = await owner.launch({
    config: { ...config(), hardMaxTurns: 24 },
    prompt: "teardown during admission",
    maxTurns: 16,
  });
  const callbacks = driver.callbacks[0]!;
  const onBeforeModel = callbacks.onBeforeModel;
  const onToolOutcome = callbacks.onToolOutcome;
  if (!onBeforeModel || !onToolOutcome) throw new Error("Expected owner budget callbacks");
  callbacks.onTurn(15);
  onToolOutcome("success");
  const pending = onBeforeModel();
  await flush();

  const shutdown = owner.shutdown();
  expect(await pending).toEqual({ maxTurns: 16, admitted: false });
  answer.resolve({ kind: "judgment", probability: 1 });
  await flush();
  run.resolve(completed(15, "partial output retained on teardown"));
  await shutdown;

  const worker = owner.inspect(receipt.workerId);
  expect(worker.status).toBe("cancelled");
  expect(worker.assignments[0]?.partialReport).toBe("partial output retained on teardown");
  expect(worker.assignments[0]?.budget).toMatchObject({
    grantedTurns: 16,
    automaticGrants: 0,
  });
  expect(driver.aborts).toEqual([receipt.workerId]);
  expect(driver.closes).toEqual([receipt.workerId]);
  expect(updates).toEqual([]);
});

test("segment settlement, assignment changes, and release reject stale callbacks", async () => {
  type Judgment = { readonly kind: "judgment"; readonly probability: number };
  const answer = deferred<Judgment>();
  const { owner, driver } = setup({
    budget: {
      mode: "automatic",
      confidenceThreshold: 0.8,
      advisor: async () => answer.promise,
    },
  });
  const firstRun = deferred<ChildExecutionOutcome>();
  const nextRun = deferred<ChildExecutionOutcome>();
  driver.startBehavior = () => firstRun.promise;
  driver.promptBehavior = () => nextRun.promise;
  const updates: string[] = [];
  owner.subscribe((event) => {
    if (event.type === "update") updates.push(event.text);
  });

  const receipt = await owner.launch({
    config: { ...config(), hardMaxTurns: 24 },
    prompt: "settle before advice returns",
    maxTurns: 16,
  });
  const oldCallbacks = driver.callbacks[0]!;
  const oldBeforeModel = oldCallbacks.onBeforeModel;
  const oldToolOutcome = oldCallbacks.onToolOutcome;
  if (!oldBeforeModel || !oldToolOutcome) throw new Error("Expected owner budget callbacks");
  oldCallbacks.onTurn(15);
  oldToolOutcome("success");
  const pending = oldBeforeModel();
  await flush();

  firstRun.resolve(completed(15));
  await owner.wait(receipt.workerId, receipt.assignmentId);
  expect(await pending).toEqual({ maxTurns: 16, admitted: false });

  const next = await owner.continue(receipt.workerId, "new assignment", 3, 5);
  oldToolOutcome("failure");
  const newCallbacks = driver.callbacks[1]!;
  const newToolOutcome = newCallbacks.onToolOutcome;
  if (!newToolOutcome) throw new Error("Expected continuation budget callback");
  newCallbacks.onTurn(1);
  newToolOutcome("success");
  nextRun.resolve(completed(1));
  await owner.wait(next.workerId, next.assignmentId);

  await owner.release(receipt.workerId);
  answer.resolve({ kind: "judgment", probability: 1 });
  await flush();
  const worker = owner.inspect(receipt.workerId);
  expect(worker.status).toBe("released");
  expect(worker.assignments[0]?.budget).toMatchObject({
    initialTurns: 16,
    grantedTurns: 16,
    hardMaxTurns: 24,
    progress: { completedTools: 1, failures: 0 },
  });
  expect(worker.assignments[1]?.budget).toMatchObject({
    initialTurns: 3,
    grantedTurns: 3,
    hardMaxTurns: 5,
    progress: { completedTools: 1, failures: 0 },
  });
  expect(updates).toEqual([]);
});

test("diagnostic updates deduplicate by controlled reason across assignments", async () => {
  const { owner, driver } = setup({
    capacity: 2,
    budget: {
      mode: "automatic",
      confidenceThreshold: 0.8,
      advisor: async () => ({
        kind: "unavailable",
        reason: "invalid-config",
        diagnostic: true,
      }),
    },
  });
  const runs = [deferred<ChildExecutionOutcome>(), deferred<ChildExecutionOutcome>()];
  driver.startBehavior = () => runs[driver.starts.length - 1]!.promise;
  const updates: string[] = [];
  owner.subscribe((event) => {
    if (event.type === "update") updates.push(event.text);
  });
  const first = await owner.launch({
    config: { ...config(), hardMaxTurns: 24 },
    prompt: "diagnostic one",
    maxTurns: 16,
  });
  const second = await owner.launch({
    config: { ...config(), hardMaxTurns: 24 },
    prompt: "diagnostic two",
    maxTurns: 16,
  });

  const checkpoints = [driver.callbacks[0]!, driver.callbacks[1]!].map((callbacks) => {
    const onBeforeModel = callbacks.onBeforeModel;
    const onToolOutcome = callbacks.onToolOutcome;
    if (!onBeforeModel || !onToolOutcome) throw new Error("Expected owner budget callbacks");
    callbacks.onTurn(15);
    onToolOutcome("success");
    return onBeforeModel();
  });
  const admissions = await Promise.all(checkpoints);
  expect(admissions).toEqual([
    { maxTurns: 16, admitted: true },
    { maxTurns: 16, admitted: true },
  ]);
  expect(updates).toEqual([
    "Budget advice unavailable (invalid-config); turn allowance remains 16.",
  ]);
  expect(owner.inspect(first.workerId).assignments[0]?.budget?.decisions[0]?.reason).toBe(
    "invalid-config",
  );
  expect(owner.inspect(second.workerId).assignments[0]?.budget?.decisions[0]?.reason).toBe(
    "invalid-config",
  );

  runs[0]!.resolve(completed(15));
  runs[1]!.resolve(completed(15));
  await Promise.all([
    owner.wait(first.workerId, first.assignmentId),
    owner.wait(second.workerId, second.assignmentId),
  ]);
});

test("routine advice stays in budget snapshots without producing update events", async () => {
  const { owner, driver } = setup({
    budget: {
      mode: "advisory",
      advisor: async () => ({ kind: "judgment", probability: 0.4 }),
    },
  });
  const run = deferred<ChildExecutionOutcome>();
  driver.startBehavior = () => run.promise;
  const updates: string[] = [];
  owner.subscribe((event) => {
    if (event.type === "update") updates.push(event.text);
  });
  const receipt = await owner.launch({
    config: { ...config(), hardMaxTurns: 24 },
    prompt: "advisory only",
    maxTurns: 16,
  });
  const callbacks = driver.callbacks[0]!;
  const onBeforeModel = callbacks.onBeforeModel;
  const onToolOutcome = callbacks.onToolOutcome;
  if (!onBeforeModel || !onToolOutcome) throw new Error("Expected owner budget callbacks");
  callbacks.onTurn(15);
  onToolOutcome("success");
  expect(await onBeforeModel()).toEqual({ maxTurns: 16, admitted: true });
  expect(owner.inspect(receipt.workerId).assignments[0]?.budget?.decisions[0]?.kind).toBe(
    "advised",
  );
  expect(updates).toEqual([]);

  run.resolve(completed(15));
  await owner.wait(receipt.workerId, receipt.assignmentId);
});

test("incomplete automatic setup is disclosed while unsupported advice remains silent", async () => {
  const notReady = setup({
    budget: {
      mode: "automatic",
      advisor: async () => ({ kind: "judgment", probability: 1 }),
    },
  });
  const notReadyRun = deferred<ChildExecutionOutcome>();
  notReady.driver.startBehavior = () => notReadyRun.promise;
  const notReadyUpdates: string[] = [];
  notReady.owner.subscribe((event) => {
    if (event.type === "update") notReadyUpdates.push(event.text);
  });
  const notReadyReceipt = await notReady.owner.launch({
    config: { ...config(), hardMaxTurns: 24 },
    prompt: "automatic not ready",
    maxTurns: 16,
  });
  const notReadyCallbacks = notReady.driver.callbacks[0]!;
  const notReadyAdmission = notReadyCallbacks.onBeforeModel;
  const notReadyOutcome = notReadyCallbacks.onToolOutcome;
  if (!notReadyAdmission || !notReadyOutcome) throw new Error("Expected owner budget callbacks");
  notReadyCallbacks.onTurn(15);
  notReadyOutcome("success");
  await notReadyAdmission();
  expect(
    notReady.owner.inspect(notReadyReceipt.workerId).assignments[0]?.budget?.decisions[0],
  ).toMatchObject({
    kind: "advised",
    reason: "automatic-not-ready",
    diagnostic: true,
  });
  expect(notReadyUpdates).toHaveLength(1);
  expect(notReadyUpdates[0]).toContain("need a reviewed confidence threshold");
  expect(notReadyUpdates[0]).toContain("allowance remains 16");
  await notReadyAdmission();
  expect(notReadyUpdates).toHaveLength(1);
  notReadyRun.resolve(completed(15));
  await notReady.owner.wait(notReadyReceipt.workerId, notReadyReceipt.assignmentId);

  const unsupported = setup({
    budget: {
      mode: "automatic",
      confidenceThreshold: 0.8,
      advisor: async () => ({ kind: "unavailable", reason: "unsupported", diagnostic: true }),
    },
  });
  const unsupportedRun = deferred<ChildExecutionOutcome>();
  unsupported.driver.startBehavior = () => unsupportedRun.promise;
  const unsupportedUpdates: string[] = [];
  unsupported.owner.subscribe((event) => {
    if (event.type === "update") unsupportedUpdates.push(event.text);
  });
  const unsupportedReceipt = await unsupported.owner.launch({
    config: { ...config(), hardMaxTurns: 24 },
    prompt: "unsupported advisor",
    maxTurns: 16,
  });
  const unsupportedCallbacks = unsupported.driver.callbacks[0]!;
  const unsupportedAdmission = unsupportedCallbacks.onBeforeModel;
  const unsupportedOutcome = unsupportedCallbacks.onToolOutcome;
  if (!unsupportedAdmission || !unsupportedOutcome)
    throw new Error("Expected owner budget callbacks");
  unsupportedCallbacks.onTurn(15);
  unsupportedOutcome("success");
  await unsupportedAdmission();
  expect(unsupportedUpdates).toEqual([]);
  unsupportedRun.resolve(completed(15));
  await unsupported.owner.wait(unsupportedReceipt.workerId, unsupportedReceipt.assignmentId);
});

test("short hard ceilings deny exhausted turns without hidden grants and retain partial reports", async () => {
  let adviceCalls = 0;
  const { owner, driver } = setup({
    budget: {
      mode: "automatic",
      confidenceThreshold: 0.8,
      advisor: async () => {
        adviceCalls++;
        return { kind: "judgment", probability: 1 };
      },
    },
  });
  const run = deferred<ChildExecutionOutcome>();
  driver.startBehavior = () => run.promise;
  const receipt = await owner.launch({
    config: { ...config(), hardMaxTurns: 1 },
    prompt: "one turn only",
    maxTurns: 1,
  });
  const callbacks = driver.callbacks[0]!;
  const onBeforeModel = callbacks.onBeforeModel;
  const onToolOutcome = callbacks.onToolOutcome;
  if (!onBeforeModel || !onToolOutcome) throw new Error("Expected owner budget callbacks");
  callbacks.onTurn(1);
  onToolOutcome("success");
  expect(await onBeforeModel()).toEqual({ maxTurns: 1, admitted: false });
  expect(await onBeforeModel()).toEqual({ maxTurns: 1, admitted: false });
  expect(adviceCalls).toBe(0);

  run.resolve({ kind: "budget-exhausted", turnsUsed: 1, partialReport: "short-run evidence" });
  const result = await owner.wait(receipt.workerId, receipt.assignmentId);
  expect(result.kind).toBe("budget-exhausted");
  expect(result.assignment.partialReport).toBe("short-run evidence");
  expect(result.assignment.budget?.grantedTurns).toBe(1);
});
