import type { AssignmentSnapshot, WorkerSnapshot } from "./owner";

interface AssignmentFacts {
  readonly outcome?: unknown;
  readonly persistence?: unknown;
}

type SnapshotAssignment = Pick<
  AssignmentSnapshot,
  "id" | "prompt" | "outcome" | "persistence" | "turnsUsed" | "maxTurns" | "budget"
>;

export interface WorkerInterpretation<
  TAssignment extends AssignmentFacts,
  TState extends string = string,
  TSession extends string | undefined = string | undefined,
> {
  state: TState;
  liveSession: TSession;
  assignments: readonly TAssignment[];
  currentAssignment: TAssignment | undefined;
  outcome: string;
  displayStatus: string;
  hasStorageFailure: boolean;
  hasFailedAssignment: boolean;
  currentBudgetExhausted: boolean;
  storageFailureNotice: boolean;
}

interface SnapshotInput<TAssignment extends SnapshotAssignment> {
  status: WorkerSnapshot["status"];
  liveSession: WorkerSnapshot["liveSession"];
  currentAssignmentId: string;
  assignments: readonly TAssignment[];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function interpretAssignments<
  TAssignment extends AssignmentFacts,
  TState extends string,
  TSession extends string | undefined,
>(
  state: TState,
  liveSession: TSession,
  assignments: readonly TAssignment[],
  currentAssignment: TAssignment | undefined,
  completionNotice: boolean,
  storageFailureEvent = false,
): WorkerInterpretation<TAssignment, TState, TSession> {
  const outcome = string(currentAssignment?.outcome);
  return {
    state,
    liveSession,
    assignments,
    currentAssignment,
    outcome,
    displayStatus:
      state === "idle" || state === "historical" || completionNotice ? outcome || state : state,
    hasStorageFailure: assignments.some((assignment) => assignment.persistence === "failed"),
    hasFailedAssignment: assignments.some((assignment) => assignment.outcome === "failed"),
    currentBudgetExhausted: liveSession === "available" && outcome === "budget-exhausted",
    storageFailureNotice: currentAssignment?.persistence === "failed" || storageFailureEvent,
  };
}

export function interpretWorkerSnapshot<TAssignment extends SnapshotAssignment>(
  worker: SnapshotInput<TAssignment>,
): WorkerInterpretation<TAssignment, WorkerSnapshot["status"], WorkerSnapshot["liveSession"]> {
  const currentAssignment = worker.assignments.find(
    (assignment) => assignment.id === worker.currentAssignmentId,
  );
  return interpretAssignments(
    worker.status,
    worker.liveSession,
    worker.assignments,
    currentAssignment,
    false,
  );
}

export interface ProjectedWorkerInterpretation
  extends WorkerInterpretation<Record<string, unknown>> {
  currentAssignment: Record<string, unknown>;
  worker: Record<string, unknown>;
}

export function interpretProjectedResult(
  data: Record<string, unknown>,
): ProjectedWorkerInterpretation {
  const worker = data.worker === undefined ? data : record(data.worker);
  const assignments = Array.isArray(worker.assignments) ? worker.assignments.map(record) : [];
  // A receipt can describe an earlier assignment while this worker runs a continuation.
  const currentAssignment =
    data.assignment === undefined
      ? (assignments.find((assignment) => assignment.assignmentId === worker.currentAssignmentId) ??
        {})
      : record(data.assignment);
  const state = string(worker.state) || string(data.state);
  const liveSession = typeof worker.liveSession === "string" ? worker.liveSession : undefined;
  const interpretation = interpretAssignments(
    state,
    liveSession,
    assignments,
    currentAssignment,
    data.type === "completion",
    data.type === "storage-failure",
  );
  return { ...interpretation, currentAssignment, worker };
}
