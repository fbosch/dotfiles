import { randomUUID } from "node:crypto";
import { match, P } from "ts-pattern";
import type {
  AssignmentSnapshot,
  LaunchRequest,
  OwnerEvent,
  WaitOptions,
  WaitResult,
  WorkerOwner,
  WorkerSnapshot,
  WorkerStatusSnapshot,
} from "./owner";

function assignmentStatus(assignment: Omit<AssignmentSnapshot, "transcript">) {
  return {
    assignmentId: assignment.id,
    outcome: assignment.outcome,
    turnsUsed: assignment.turnsUsed,
    maxTurns: assignment.maxTurns,
    remainingTurns: assignment.remainingTurns,
    persistence: assignment.persistence,
    ...(assignment.error ? { error: assignment.error } : {}),
    ...(assignment.persistenceError ? { persistenceError: assignment.persistenceError } : {}),
  };
}

/** Ordinary status excludes configuration prompts, reports, and investigation transcripts. */
export function workerStatus(worker: WorkerStatusSnapshot) {
  return {
    parentSessionId: worker.parentSessionId,
    workerId: worker.id,
    specialist: worker.specialist,
    state: worker.status,
    liveSession: worker.liveSession,
    currentAssignmentId: worker.currentAssignmentId,
    assignments: worker.assignments.map(assignmentStatus),
    ...(worker.pendingQuestion ? { question: worker.pendingQuestion } : {}),
  };
}

function waitEvidence(result: WaitResult) {
  return {
    kind: result.kind,
    worker: workerStatus(result.worker),
    assignment: assignmentStatus(result.assignment),
    ...(result.assignment.report !== undefined ? { report: result.assignment.report } : {}),
    ...(result.assignment.partialReport !== undefined
      ? { partialReport: result.assignment.partialReport }
      : {}),
    ...(result.kind === "question" ? { question: result.question } : {}),
    ...("cancelled" in result ? { cancelled: result.cancelled } : {}),
  };
}

export type WorkerNotice =
  | {
      type: "completion" | "storage-failure";
      worker: ReturnType<typeof workerStatus>;
      assignment: ReturnType<typeof assignmentStatus>;
      reportAvailable: boolean;
      verified: false;
    }
  | {
      type: "question";
      worker: ReturnType<typeof workerStatus>;
      question: NonNullable<WorkerSnapshot["pendingQuestion"]>;
    }
  | { type: "update"; workerId: string; assignmentId: string; state: string; text: string };

type WorkerUpdate = Extract<WorkerNotice, { type: "update" }>;

function isUnsettledAssignment(outcome: AssignmentSnapshot["outcome"]): boolean {
  return match(outcome)
    .with("queued", "running", "waiting-question", "stopping", () => true)
    .with("completed", "failed", "budget-exhausted", "cancelled", "cleanup-unknown", () => false)
    .exhaustive();
}
interface Delivery {
  waiters: number;
  reportDelivered: boolean;
  receiptSent: boolean;
  storageWarningSent: boolean;
  questionsDelivered: Set<string>;
}

/** Coordinates full-result waits and structural notices without replaying assignments. */
export class WorkerDelivery {
  private readonly assignments = new Map<string, Delivery>();
  private readonly pendingUpdates = new Map<string, WorkerUpdate>();
  private readonly unsubscribe: () => void;
  private closing = false;
  private readonly foreground = new Set<string>();
  private readonly presentationListeners = new Set<() => void>();

  foregroundWorkerIds(): ReadonlySet<string> {
    return new Set(this.foreground);
  }
  subscribePresentation(listener: () => void): () => void {
    this.presentationListeners.add(listener);
    return () => {
      this.presentationListeners.delete(listener);
    };
  }

  constructor(
    readonly owner: WorkerOwner,
    private readonly notify: (notice: WorkerNotice, updateDeliveryId?: string) => void,
    private readonly onError: (error: unknown) => void,
  ) {
    this.unsubscribe = owner.subscribe((event) => {
      try {
        this.onEvent(event);
      } catch (error) {
        this.onError(error);
      }
    });
  }

  async launch(
    request: LaunchRequest,
    options: {
      foreground?: boolean;
      signal?: AbortSignal;
      onProgress?: (status: ReturnType<typeof workerStatus>) => void;
    } = {},
  ) {
    const launched = await this.owner.launch(request);
    this.track(launched.assignmentId);
    if (options.foreground) {
      this.foreground.add(launched.workerId);
      for (const listener of this.presentationListeners) listener();
      const progress = () =>
        options.onProgress?.(workerStatus(this.owner.inspect(launched.workerId)));
      const unsubscribe = this.owner.subscribe((event) => {
        const id = match(event)
          .with({ type: "state" }, ({ worker }) => worker.id)
          .with({ type: "question" }, ({ question }) => question.workerId)
          .with({ type: P.union("update", "turn", "persistence") }, ({ workerId }) => workerId)
          .exhaustive();
        if (id === launched.workerId) progress();
      });
      try {
        progress();
        return await this.wait(
          launched.workerId,
          launched.assignmentId,
          { ...(options.signal ? { signal: options.signal } : {}) },
          true,
        );
      } finally {
        unsubscribe();
        this.foreground.delete(launched.workerId);
        for (const listener of this.presentationListeners) listener();
      }
    }
    this.flush(launched.workerId, launched.assignmentId);
    return {
      kind: "launched" as const,
      workerId: launched.workerId,
      assignmentId: launched.assignmentId,
      worker: workerStatus(this.owner.inspect(launched.workerId)),
    };
  }

  async continue(workerId: string, prompt: string, maxTurns?: number) {
    const launched = await this.owner.continue(workerId, prompt, maxTurns);
    this.track(launched.assignmentId);
    this.flush(workerId, launched.assignmentId);
    return {
      kind: "launched" as const,
      workerId,
      assignmentId: launched.assignmentId,
      worker: workerStatus(this.owner.inspect(workerId)),
    };
  }

  async wait(
    workerId: string,
    assignmentId: string,
    options: WaitOptions = {},
    foreground = false,
  ) {
    this.owner.inspect(workerId);
    const delivery = this.track(assignmentId);
    delivery.waiters++;
    try {
      let result = await this.owner.wait(workerId, assignmentId, options);
      if (foreground && result.kind === "interrupted") {
        await this.owner.cancel(workerId);
        result = await this.owner.wait(workerId, assignmentId);
      }
      match(result)
        .with({ kind: "question" }, ({ question }) => {
          if (question) delivery.questionsDelivered.add(question.id);
          else delivery.reportDelivered = true;
        })
        .with({ kind: P.union("timeout", "interrupted") }, () => undefined)
        .with(
          {
            kind: P.union(
              "completed",
              "failed",
              "budget-exhausted",
              "cancelled",
              "cleanup-unknown",
            ),
          },
          () => {
            delivery.reportDelivered = true;
          },
        )
        .exhaustive();
      return waitEvidence(result);
    } finally {
      delivery.waiters--;
      this.flush(workerId, assignmentId);
    }
  }

  /** Project settled state into model delivery without rewriting saved update evidence. */
  refreshUpdate(updateDeliveryId: string): WorkerUpdate | undefined {
    if (this.closing) return;
    const notice = this.pendingUpdates.get(updateDeliveryId);
    if (!notice) return;
    const worker = this.owner.findStatus(notice.workerId);
    const assignment = worker?.assignments.find((item) => item.id === notice.assignmentId);
    if (assignment && isUnsettledAssignment(assignment.outcome)) return;
    // Active updates stay tracked across context projections; settled updates refresh only once.
    this.pendingUpdates.delete(updateDeliveryId);
    return assignment && assignment.outcome !== notice.state
      ? { ...notice, state: assignment.outcome }
      : undefined;
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    this.pendingUpdates.clear();
    try {
      await this.owner.shutdown();
    } finally {
      this.unsubscribe();
    }
  }

  private track(assignmentId: string): Delivery {
    let state = this.assignments.get(assignmentId);
    if (!state) {
      state = {
        waiters: 0,
        reportDelivered: false,
        receiptSent: false,
        storageWarningSent: false,
        questionsDelivered: new Set(),
      };
      this.assignments.set(assignmentId, state);
    }
    return state;
  }

  private onEvent(event: OwnerEvent): void {
    if (this.closing) return;
    match(event)
      .with({ type: "update" }, (update) => this.notifyUpdate(update))
      .with({ type: "state" }, ({ worker }) => this.flush(worker.id, worker.currentAssignmentId))
      .with({ type: "persistence" }, ({ workerId, assignmentId }) =>
        this.flush(workerId, assignmentId),
      )
      .with({ type: P.union("question", "turn") }, () => undefined)
      .exhaustive();
  }

  private notifyUpdate(event: Extract<OwnerEvent, { type: "update" }>): void {
    const notice: WorkerUpdate = {
      type: "update",
      workerId: event.workerId,
      assignmentId: event.assignmentId,
      state: event.state,
      text: event.text,
    };
    // Saved messages outlive a runtime; opaque tokens must not collide after reload.
    const updateDeliveryId = `${this.owner.parentSessionId}:${randomUUID()}`;
    this.pendingUpdates.set(updateDeliveryId, notice);
    try {
      this.notify(notice, updateDeliveryId);
    } catch (error) {
      this.pendingUpdates.delete(updateDeliveryId);
      throw error;
    }
  }

  private flush(workerId: string, assignmentId: string): void {
    const delivery = this.assignments.get(assignmentId);
    if (this.closing || !delivery || delivery.waiters > 0) return;
    const worker = this.owner.inspect(workerId);
    if (worker.liveSession === "historical") return;
    const assignment = worker.assignments.find((entry) => entry.id === assignmentId);
    if (!assignment) return;
    const question = worker.pendingQuestion;
    if (
      worker.status === "waiting-question" &&
      question &&
      !delivery.questionsDelivered.has(question.id)
    ) {
      this.notify({ type: "question", worker: workerStatus(worker), question });
      delivery.questionsDelivered.add(question.id);
      return;
    }
    if (isUnsettledAssignment(assignment.outcome)) return;
    if (assignment.persistence === "pending" || assignment.persistence === "not-attempted") return;
    if (!delivery.reportDelivered && !delivery.receiptSent) {
      this.notify({
        type: "completion",
        worker: workerStatus(worker),
        assignment: assignmentStatus(assignment),
        reportAvailable: assignment.report !== undefined,
        verified: false,
      });
      delivery.receiptSent = true;
    } else if (
      delivery.reportDelivered &&
      assignment.persistence === "failed" &&
      !delivery.receiptSent &&
      !delivery.storageWarningSent
    ) {
      this.notify({
        type: "storage-failure",
        worker: workerStatus(worker),
        assignment: assignmentStatus(assignment),
        reportAvailable: assignment.report !== undefined,
        verified: false,
      });
      delivery.storageWarningSent = true;
    }
  }
}
