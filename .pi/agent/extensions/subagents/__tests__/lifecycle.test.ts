import { describe, expect, test } from "bun:test";
import {
  type AssignmentOutcome,
  isSettled,
  type LifecycleEvent,
  type LifecycleState,
  launchedWorker,
  type Operation,
  permission,
  transition,
  type WorkerStatus,
} from "../lifecycle";

function state(overrides: Partial<LifecycleState> = {}): LifecycleState {
  return { ...launchedWorker, outcome: "queued", ...overrides };
}

const running = state({
  status: "running",
  outcome: "running",
  reserved: true,
  sessionStarted: true,
});
const waiting = state({
  status: "waiting-question",
  outcome: "waiting-question",
  sessionStarted: true,
});
const idle = state({ status: "idle", outcome: "completed", sessionStarted: true });

function run(from: LifecycleState, ...events: LifecycleEvent[]) {
  let current = from;
  const effects: string[][] = [];
  for (const event of events) {
    const next = transition(current, event);
    current = next.state;
    effects.push(next.effects.map((effect) => effect.kind));
  }
  return { state: current, effects };
}

const statuses: WorkerStatus[] = [
  "queued",
  "running",
  "waiting-question",
  "stopping",
  "idle",
  "cancelled",
  "cleanup-unknown",
  "releasing",
  "released",
  "historical",
];

describe("permission", () => {
  const verdicts: Record<Operation, Partial<Record<WorkerStatus, "allowed" | "noop">>> = {
    steer: { running: "allowed" },
    reply: { "waiting-question": "allowed" },
    extendBudget: { queued: "allowed", "waiting-question": "allowed" },
    continue: { idle: "allowed" },
    cancel: {
      queued: "allowed",
      running: "allowed",
      "waiting-question": "allowed",
      stopping: "noop",
      "cleanup-unknown": "noop",
      cancelled: "noop",
    },
    release: { idle: "allowed", cancelled: "allowed" },
  };

  for (const [operation, expected] of Object.entries(verdicts) as [
    Operation,
    (typeof verdicts)[Operation],
  ][]) {
    test.each(statuses)(`${operation} from %s with a live session`, (status) => {
      expect(permission(state({ status, outcome: "completed" }), operation).kind).toBe(
        expected[status] ?? "refused",
      );
    });
  }

  test("refusals keep the messages callers already see", () => {
    expect(permission(idle, "steer")).toEqual({
      kind: "refused",
      reason: "Cannot steer worker in idle state",
    });
    expect(permission(running, "reply")).toEqual({
      kind: "refused",
      reason: "Question is not current for this worker",
    });
    expect(permission(running, "extendBudget")).toEqual({
      kind: "refused",
      reason: "Cannot extend assignment budget in running state",
    });
    expect(permission(idle, "cancel")).toEqual({
      kind: "refused",
      reason: "Cannot cancel worker in idle state",
    });
    expect(permission(running, "release")).toEqual({
      kind: "refused",
      reason: "Cannot release worker in running state",
    });
  });

  test.each([
    ["cancelled", "cancelled", "none"],
    ["released", "completed", "released"],
    ["cleanup-unknown", "cleanup-unknown", "available"],
    ["historical", "completed", "historical"],
  ] as const)("continuation is refused for a %s worker", (status, outcome, liveSession) => {
    expect(permission(state({ status, outcome, liveSession }), "continue")).toEqual({
      kind: "refused",
      reason: `Cannot continue worker in ${status} state`,
    });
  });

  test.each(["completed", "failed", "budget-exhausted"] as const)(
    "continuation is allowed after a %s assignment",
    (outcome) => {
      expect(permission({ ...idle, outcome }, "continue").kind).toBe("allowed");
    },
  );

  test("continuation of an idle worker requires a finished assignment", () => {
    const unfinished: AssignmentOutcome = "running";
    expect(permission({ ...idle, outcome: unfinished }, "continue")).toEqual({
      kind: "refused",
      reason: "Cannot continue assignment with running outcome",
    });
    expect(permission({ ...idle, liveSession: "none" }, "continue").kind).toBe("refused");
  });

  test("budgets extend only while the live session is available", () => {
    expect(permission({ ...waiting, liveSession: "released" }, "extendBudget").kind).toBe(
      "refused",
    );
  });

  test("release without a live session is a no-op regardless of status", () => {
    expect(permission({ ...idle, liveSession: "none" }, "release").kind).toBe("noop");
    expect(permission(state({ status: "released", liveSession: "released" }), "release").kind).toBe(
      "noop",
    );
  });
});

describe("execution reservation", () => {
  test("starting a segment reserves a slot and only a start marks the session started", () => {
    expect(transition(state(), { type: "segmentStarted", purpose: "start" }).state).toMatchObject({
      status: "running",
      outcome: "running",
      reserved: true,
      sessionStarted: true,
    });
    expect(
      transition(state(), { type: "segmentStarted", purpose: "continuation" }).state.sessionStarted,
    ).toBe(false);
  });

  test("a segment cannot start unless the worker and assignment are queued", () => {
    expect(() => transition(running, { type: "segmentStarted", purpose: "start" })).toThrow(
      "Illegal segmentStarted transition from running state",
    );
  });

  test.each(["completed", "failed", "budget-exhausted"] as const)(
    "a %s settlement releases the slot and persists the final outcome",
    (kind) => {
      const result =
        kind === "completed"
          ? { kind, turnsUsed: 1, report: "done" }
          : { kind, turnsUsed: 1, error: "x", partialReport: "partial" };
      const next = run(running, { type: "segmentSettled", result, questionAsked: false });
      expect(next.state).toMatchObject({ status: "idle", outcome: kind, reserved: false });
      expect(next.effects).toEqual([
        ["clearActive", "recordFinal", "emitState", "persist", "pump"],
      ]);
    },
  );

  test("a correlated question releases the slot and raises the question before persisting", () => {
    const next = run(running, {
      type: "segmentSettled",
      result: { kind: "waiting-question", turnsUsed: 1 },
      questionAsked: true,
    });
    expect(next.state).toMatchObject({ status: "waiting-question", reserved: false });
    expect(next.effects).toEqual([
      ["raiseQuestion", "clearActive", "emitState", "emitQuestion", "persist", "pump"],
    ]);
  });

  test("a yield without a correlated question fails the assignment", () => {
    const next = transition(running, {
      type: "segmentSettled",
      result: { kind: "waiting-question", turnsUsed: 1 },
      questionAsked: false,
    });
    expect(next.state).toMatchObject({ status: "idle", outcome: "failed", reserved: false });
    expect(next.effects[0]).toEqual({
      kind: "recordError",
      text: "Child driver yielded without exactly one correlated question",
    });
  });

  test("a clean startup failure leaves no live session to resume", () => {
    const next = transition(running, { type: "segmentFailed", error: "boom", startup: "failed" });
    expect(next.state).toMatchObject({
      status: "idle",
      outcome: "failed",
      liveSession: "none",
      sessionStarted: false,
      reserved: false,
    });
  });

  test("unconfirmed startup keeps the slot and reports cleanup uncertainty", () => {
    const next = transition(running, {
      type: "segmentFailed",
      error: "partial",
      startup: "unconfirmed",
    });
    expect(next.state).toMatchObject({ status: "cleanup-unknown", reserved: true });
    expect(next.effects).toContainEqual({ kind: "markUncertain", diagnostic: "partial" });
  });

  test("cancelling a running segment keeps the slot until close confirms shutdown", () => {
    const cancelled = run(running, { type: "cancelRequested" });
    expect(cancelled.state).toMatchObject({ status: "stopping", reserved: true });
    expect(cancelled.effects).toEqual([["invalidateBudget", "emitState", "abort"]]);

    const settled = transition(cancelled.state, {
      type: "segmentSettled",
      result: { kind: "completed", turnsUsed: 1, report: "late" },
      questionAsked: false,
    });
    expect(settled.state).toMatchObject({ status: "stopping", reserved: true, closeAttempt: 1 });
    expect(settled.effects).toEqual([
      { kind: "recordPartial", result: { kind: "completed", turnsUsed: 1, report: "late" } },
      { kind: "close", attempt: 1 },
    ]);

    const closed = run(settled.state, { type: "closeConfirmed", attempt: 1 });
    expect(closed.state).toMatchObject({
      status: "cancelled",
      outcome: "cancelled",
      liveSession: "released",
      reserved: false,
    });
    expect(closed.state.closeAttempt).toBeUndefined();
    expect(closed.effects).toEqual([
      ["clearActive", "clearQuestion", "emitState", "persist", "pump"],
    ]);
  });

  test("an unconfirmed close keeps the slot through cleanup uncertainty", () => {
    const stopping = {
      ...running,
      status: "stopping",
      outcome: "stopping",
      closeAttempt: 1,
    } as const;
    const next = transition(stopping, {
      type: "closeUnconfirmed",
      attempt: 1,
      diagnostic: "still active",
    });
    expect(next.state).toMatchObject({ status: "cleanup-unknown", reserved: true });
    expect(next.state.closeAttempt).toBeUndefined();
  });

  test("a confirmed close after an abort failure still releases the slot", () => {
    const stopping = {
      ...running,
      status: "stopping",
      outcome: "stopping",
      closeAttempt: 1,
    } as const;
    const next = run(
      stopping,
      { type: "cleanupUncertain", diagnostic: "Abort request failed: gone" },
      { type: "closeConfirmed", attempt: 1 },
    );
    expect(next.state).toMatchObject({ status: "cancelled", reserved: false });
  });

  test("settlement during cleanup uncertainty records partial output and keeps the slot", () => {
    const uncertain = {
      ...running,
      status: "cleanup-unknown",
      outcome: "cleanup-unknown",
    } as const;
    const next = run(uncertain, {
      type: "segmentSettled",
      result: { kind: "completed", turnsUsed: 1, report: "late" },
      questionAsked: false,
    });
    expect(next.state).toEqual(uncertain);
    expect(next.effects).toEqual([["recordPartial", "emitState"]]);
  });
});

describe("cancellation without an active segment", () => {
  test("a never-started queued worker is cancelled without closing a child", () => {
    const next = run(state(), { type: "cancelRequested" });
    expect(next.state).toMatchObject({
      status: "cancelled",
      outcome: "cancelled",
      liveSession: "none",
      reserved: false,
    });
    expect(next.effects).toEqual([
      ["dequeue", "invalidateBudget", "clearQuestion", "emitState", "persist", "pump"],
    ]);
  });

  test("a queued continuation closes its retained session, then pumps the queue", () => {
    const next = run(state({ sessionStarted: true }), { type: "cancelRequested" });
    expect(next.state).toMatchObject({ status: "stopping", closeAttempt: 1, reserved: false });
    expect(next.effects).toEqual([
      ["dequeue", "invalidateBudget", "clearQuestion", "emitState", "close", "pump"],
    ]);
  });

  test("a question-waiting worker closes without releasing a slot it never held", () => {
    const next = run(waiting, { type: "cancelRequested" }, { type: "closeConfirmed", attempt: 1 });
    expect(next.state).toMatchObject({
      status: "cancelled",
      liveSession: "released",
      reserved: false,
    });
    expect(next.effects).toEqual([
      ["clearQuestion", "invalidateBudget", "emitState", "close"],
      ["clearQuestion", "emitState", "persist"],
    ]);
  });

  test("stopping, uncertain, and cancelled workers ignore repeated cancellation", () => {
    for (const status of ["stopping", "cleanup-unknown", "cancelled"] as const) {
      const from = state({ status });
      expect(transition(from, { type: "cancelRequested" })).toEqual({ state: from, effects: [] });
    }
  });

  test("a close result for a superseded attempt is ignored", () => {
    const stopping = {
      ...waiting,
      status: "stopping",
      outcome: "stopping",
      closeAttempt: 2,
    } as const;
    expect(transition(stopping, { type: "closeConfirmed", attempt: 1 }).effects).toEqual([]);
    expect(
      transition(stopping, { type: "closeUnconfirmed", attempt: 1, diagnostic: "x" }).effects,
    ).toEqual([]);
  });
});

describe("release", () => {
  test("a confirmed close releases the live session without persisting", () => {
    const next = run(idle, { type: "releaseRequested" }, { type: "closeConfirmed", attempt: 1 });
    expect(next.state).toMatchObject({ status: "released", liveSession: "released" });
    expect(next.effects).toEqual([["invalidateAllBudgets", "emitState", "close"], ["emitState"]]);
  });

  test("an unconfirmed close leaves cleanup uncertainty", () => {
    const next = run(
      idle,
      { type: "releaseRequested" },
      { type: "closeUnconfirmed", attempt: 1, diagnostic: "still active" },
    );
    expect(next.state).toMatchObject({ status: "cleanup-unknown", outcome: "cleanup-unknown" });
  });

  test("release is illegal while a segment runs", () => {
    expect(() => transition(running, { type: "releaseRequested" })).toThrow(
      "Illegal releaseRequested transition from running state",
    );
  });
});

test.each(statuses)("%s settles shutdown only once nothing is in flight", (status) => {
  const inFlight: WorkerStatus[] = [
    "queued",
    "running",
    "waiting-question",
    "stopping",
    "releasing",
  ];
  expect(isSettled(status)).toBe(!inFlight.includes(status));
});
