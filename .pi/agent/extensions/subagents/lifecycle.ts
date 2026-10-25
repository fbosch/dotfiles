import { match } from "ts-pattern";
import type { ChildExecutionOutcome } from "./owner";

export type AssignmentOutcome =
  | "queued"
  | "running"
  | "waiting-question"
  | "stopping"
  | "completed"
  | "failed"
  | "budget-exhausted"
  | "cancelled"
  | "cleanup-unknown";
export type WorkerStatus =
  | "queued"
  | "running"
  | "waiting-question"
  | "stopping"
  | "idle"
  | "cancelled"
  | "cleanup-unknown"
  | "releasing"
  | "released"
  | "historical";
export type LiveSessionAvailability = "available" | "released" | "historical" | "none";
export type SegmentPurpose = "start" | "question-reply" | "continuation";

/**
 * Lifecycle facts for one worker and its current assignment.
 * `reserved` is the execution reservation: held from segment start until the child is known to
 * have stopped, and deliberately kept through cleanup uncertainty.
 */
export interface LifecycleState {
  readonly status: WorkerStatus;
  readonly outcome: AssignmentOutcome;
  readonly liveSession: LiveSessionAvailability;
  readonly reserved: boolean;
  readonly sessionStarted: boolean;
  /** Identifies the outstanding child close; a close result for any other attempt is stale. */
  readonly closeAttempt?: number;
}

export type LifecycleEvent =
  | { readonly type: "segmentStarted"; readonly purpose: SegmentPurpose }
  | {
      readonly type: "segmentSettled";
      readonly result: ChildExecutionOutcome;
      readonly questionAsked: boolean;
    }
  | {
      readonly type: "segmentFailed";
      readonly error: string;
      readonly startup: "unconfirmed" | "failed" | "none";
    }
  | { readonly type: "cancelRequested" }
  | { readonly type: "replied" }
  | { readonly type: "continued" }
  | { readonly type: "releaseRequested" }
  | { readonly type: "closeConfirmed"; readonly attempt: number }
  | { readonly type: "closeUnconfirmed"; readonly attempt: number; readonly diagnostic: string }
  | { readonly type: "cleanupUncertain"; readonly diagnostic: string };

/** Effects run in order after the next state is applied. */
export type LifecycleEffect =
  | { readonly kind: "dequeue" }
  | { readonly kind: "invalidateBudget" }
  | { readonly kind: "invalidateAllBudgets" }
  | { readonly kind: "clearQuestion" }
  | { readonly kind: "raiseQuestion" }
  | { readonly kind: "clearActive" }
  | {
      readonly kind: "recordFinal";
      readonly result: Exclude<ChildExecutionOutcome, { kind: "waiting-question" }>;
    }
  | { readonly kind: "recordPartial"; readonly result: ChildExecutionOutcome }
  | { readonly kind: "recordPartialText"; readonly text: string }
  | { readonly kind: "recordError"; readonly text: string }
  | { readonly kind: "markUncertain"; readonly diagnostic: string }
  | { readonly kind: "emitState" }
  | { readonly kind: "emitQuestion" }
  | { readonly kind: "persist" }
  | { readonly kind: "pump" }
  | { readonly kind: "abort" }
  | { readonly kind: "close"; readonly attempt: number };

export interface Transition {
  readonly state: LifecycleState;
  readonly effects: readonly LifecycleEffect[];
}

export type Operation = "steer" | "reply" | "extendBudget" | "continue" | "cancel" | "release";
export type Permission =
  | { readonly kind: "allowed" }
  | { readonly kind: "noop" }
  | { readonly kind: "refused"; readonly reason: string };

export const launchedWorker = {
  status: "queued",
  liveSession: "available",
  reserved: false,
  sessionStarted: false,
} as const satisfies Omit<LifecycleState, "outcome">;

/** Parent-loaded history is readable but cannot recreate a live child or resume an assignment. */
export const historicalWorker = {
  status: "historical",
  liveSession: "historical",
  reserved: false,
  sessionStarted: false,
} as const satisfies Omit<LifecycleState, "outcome">;

const allowed: Permission = { kind: "allowed" };
const noop: Permission = { kind: "noop" };
const refused = (reason: string): Permission => ({ kind: "refused", reason });

export function permission(state: LifecycleState, operation: Operation): Permission {
  const { status } = state;
  return match(operation)
    .with("steer", () =>
      status === "running" ? allowed : refused(`Cannot steer worker in ${status} state`),
    )
    .with("reply", () =>
      status === "waiting-question" ? allowed : refused("Question is not current for this worker"),
    )
    .with("extendBudget", () => {
      const extendable =
        state.liveSession === "available" &&
        match(status)
          .with("waiting-question", "queued", () => true)
          .with(
            "running",
            "stopping",
            "idle",
            "cancelled",
            "cleanup-unknown",
            "releasing",
            "released",
            "historical",
            () => false,
          )
          .exhaustive();
      return extendable ? allowed : refused(`Cannot extend assignment budget in ${status} state`);
    })
    .with("continue", () => {
      if (status !== "idle" || state.liveSession !== "available")
        return refused(`Cannot continue worker in ${status} state`);
      return match(state.outcome)
        .with("completed", "failed", "budget-exhausted", () => allowed)
        .with(
          "queued",
          "running",
          "waiting-question",
          "stopping",
          "cancelled",
          "cleanup-unknown",
          (outcome) => refused(`Cannot continue assignment with ${outcome} outcome`),
        )
        .exhaustive();
    })
    .with("cancel", () =>
      match(status)
        .with("queued", "waiting-question", "running", () => allowed)
        .with("stopping", "cleanup-unknown", "cancelled", () => noop)
        .with("idle", "releasing", "released", "historical", () =>
          refused(`Cannot cancel worker in ${status} state`),
        )
        .exhaustive(),
    )
    .with("release", () => {
      if (state.liveSession === "released" || state.liveSession === "none") return noop;
      return status === "idle" || status === "cancelled"
        ? allowed
        : refused(`Cannot release worker in ${status} state`);
    })
    .exhaustive();
}

/** True once a worker has no execution or close in flight. */
export function isSettled(status: WorkerStatus | undefined): boolean {
  return match(status)
    .with(undefined, "idle", "cancelled", "cleanup-unknown", "released", "historical", () => true)
    .with("queued", "running", "waiting-question", "stopping", "releasing", () => false)
    .exhaustive();
}

export function transition(state: LifecycleState, event: LifecycleEvent): Transition {
  return match(event)
    .returnType<Transition>()
    .with({ type: "segmentStarted" }, ({ purpose }) => {
      if (state.status !== "queued" || state.outcome !== "queued") throw illegal(state, event);
      return {
        state: {
          ...state,
          status: "running",
          outcome: "running",
          reserved: true,
          sessionStarted: state.sessionStarted || purpose === "start",
        },
        effects: [{ kind: "emitState" }],
      };
    })
    .with({ type: "segmentSettled" }, ({ result, questionAsked }) =>
      settle(state, result, questionAsked),
    )
    .with({ type: "segmentFailed" }, ({ error, startup }) => fail(state, error, startup))
    .with({ type: "cancelRequested" }, () => cancel(state))
    .with({ type: "replied" }, () => {
      if (state.status !== "waiting-question") throw illegal(state, event);
      return {
        state: { ...state, status: "queued", outcome: "queued" },
        effects: [{ kind: "clearQuestion" }, { kind: "emitState" }, { kind: "pump" }],
      };
    })
    .with({ type: "continued" }, () => {
      if (state.status !== "idle") throw illegal(state, event);
      return {
        state: { ...state, status: "queued", outcome: "queued" },
        effects: [{ kind: "emitState" }, { kind: "pump" }],
      };
    })
    .with({ type: "releaseRequested" }, () => {
      if (permission(state, "release").kind !== "allowed") throw illegal(state, event);
      return close({ ...state, status: "releasing" }, [
        { kind: "invalidateAllBudgets" },
        { kind: "emitState" },
      ]);
    })
    .with({ type: "closeConfirmed" }, ({ attempt }) => closeConfirmed(state, attempt))
    .with({ type: "closeUnconfirmed" }, ({ attempt, diagnostic }) => {
      if (attempt !== state.closeAttempt) return unchanged(state);
      return uncertain(withoutCloseAttempt(state), diagnostic);
    })
    .with({ type: "cleanupUncertain" }, ({ diagnostic }) => uncertain(state, diagnostic))
    .exhaustive();
}

function settle(
  state: LifecycleState,
  result: ChildExecutionOutcome,
  questionAsked: boolean,
): Transition {
  if (state.status === "cleanup-unknown") {
    return { state, effects: [{ kind: "recordPartial", result }, { kind: "emitState" }] };
  }
  if (state.status === "stopping") return close(state, [{ kind: "recordPartial", result }]);
  if (result.kind === "waiting-question") {
    if (!questionAsked) {
      return fail(state, "Child driver yielded without exactly one correlated question", "none");
    }
    return {
      state: { ...state, status: "waiting-question", outcome: "waiting-question", reserved: false },
      effects: [
        { kind: "raiseQuestion" },
        { kind: "clearActive" },
        { kind: "emitState" },
        { kind: "emitQuestion" },
        { kind: "persist" },
        { kind: "pump" },
      ],
    };
  }
  return {
    state: { ...state, status: "idle", outcome: result.kind, reserved: false },
    effects: [
      { kind: "clearActive" },
      { kind: "recordFinal", result },
      { kind: "emitState" },
      { kind: "persist" },
      { kind: "pump" },
    ],
  };
}

function fail(
  state: LifecycleState,
  error: string,
  startup: "unconfirmed" | "failed" | "none",
): Transition {
  if (startup === "unconfirmed") return uncertain(state, error);
  const next: LifecycleState =
    startup === "failed" ? { ...state, sessionStarted: false, liveSession: "none" } : state;
  if (next.status === "cleanup-unknown") {
    return {
      state: next,
      effects: [{ kind: "recordPartialText", text: error }, { kind: "emitState" }],
    };
  }
  if (next.status === "stopping") return close(next, [{ kind: "recordPartialText", text: error }]);
  return {
    state: { ...next, status: "idle", outcome: "failed", reserved: false },
    effects: [
      { kind: "recordError", text: error },
      { kind: "clearActive" },
      { kind: "emitState" },
      { kind: "persist" },
      { kind: "pump" },
    ],
  };
}

function cancel(state: LifecycleState): Transition {
  const verdict = permission(state, "cancel");
  if (verdict.kind === "noop") return unchanged(state);
  if (verdict.kind === "refused") throw new Error(verdict.reason);
  const stopping: LifecycleState = { ...state, status: "stopping", outcome: "stopping" };
  return match(state.status)
    .returnType<Transition>()
    .with("queued", () => {
      const cleared: LifecycleEffect[] = [
        { kind: "dequeue" },
        { kind: "invalidateBudget" },
        { kind: "clearQuestion" },
      ];
      if (!state.sessionStarted) {
        return {
          state: { ...state, status: "cancelled", outcome: "cancelled", liveSession: "none" },
          effects: [...cleared, { kind: "emitState" }, { kind: "persist" }, { kind: "pump" }],
        };
      }
      const closing = close(stopping, [...cleared, { kind: "emitState" }]);
      return { state: closing.state, effects: [...closing.effects, { kind: "pump" }] };
    })
    .with("waiting-question", () =>
      close(stopping, [
        { kind: "clearQuestion" },
        { kind: "invalidateBudget" },
        { kind: "emitState" },
      ]),
    )
    .otherwise(() => ({
      state: stopping,
      effects: [{ kind: "invalidateBudget" }, { kind: "emitState" }, { kind: "abort" }],
    }));
}

function closeConfirmed(state: LifecycleState, attempt: number): Transition {
  if (attempt !== state.closeAttempt) return unchanged(state);
  const closed = withoutCloseAttempt(state);
  return (
    match(state.status)
      .returnType<Transition>()
      .with("releasing", () => ({
        state: { ...closed, status: "released", liveSession: "released" },
        effects: [{ kind: "emitState" }],
      }))
      // Abort failure can mark cleanup uncertainty while a cancellation close is outstanding; a
      // confirmed close still proves the child stopped.
      .with("stopping", "cleanup-unknown", () => {
        const cancelled: LifecycleState = {
          ...closed,
          status: "cancelled",
          outcome: "cancelled",
          liveSession: "released",
          reserved: false,
        };
        if (!state.reserved) {
          return {
            state: cancelled,
            effects: [{ kind: "clearQuestion" }, { kind: "emitState" }, { kind: "persist" }],
          };
        }
        return {
          state: cancelled,
          effects: [
            { kind: "clearActive" },
            { kind: "clearQuestion" },
            { kind: "emitState" },
            { kind: "persist" },
            { kind: "pump" },
          ],
        };
      })
      .otherwise(() => unchanged(state))
  );
}

/** Keeps the execution reservation: the child may still be running. */
function uncertain(state: LifecycleState, diagnostic: string): Transition {
  return {
    state: { ...state, status: "cleanup-unknown", outcome: "cleanup-unknown" },
    effects: [
      { kind: "invalidateBudget" },
      { kind: "recordError", text: diagnostic },
      { kind: "clearQuestion" },
      { kind: "markUncertain", diagnostic },
      { kind: "emitState" },
      { kind: "persist" },
    ],
  };
}

function close(state: LifecycleState, before: readonly LifecycleEffect[]): Transition {
  const attempt = (state.closeAttempt ?? 0) + 1;
  return {
    state: { ...state, closeAttempt: attempt },
    effects: [...before, { kind: "close", attempt }],
  };
}

function withoutCloseAttempt(state: LifecycleState): LifecycleState {
  const { closeAttempt: _closeAttempt, ...rest } = state;
  return rest;
}

function unchanged(state: LifecycleState): Transition {
  return { state, effects: [] };
}

function illegal(state: LifecycleState, event: LifecycleEvent): Error {
  return new Error(`Illegal ${event.type} transition from ${state.status} state`);
}
