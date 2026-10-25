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
      requiresReply: boolean;
    }
  | { type: "update"; workerId: string; assignmentId: string; state: string; text: string };

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
  private readonly pendingNotices = new Map<string, WorkerNotice>();
  private readonly unsubscribe: () => void;
  private closing = false;
  private readonly foreground = new Set<string>();
  private readonly presentationListeners = new Set<() => void>();
  private readonly inspectedAssignments = new Set<string>();

  hasInspectedEvidence(assignmentId: string): boolean {
    return this.inspectedAssignments.has(assignmentId);
  }

  private acknowledgeEvidence(workerId: string, assignmentId?: string): void {
    const worker = this.owner.inspect(workerId);
    const id = assignmentId ?? worker.currentAssignmentId;
    const assignment = worker.assignments.find((item) => item.id === id);
    if (assignment?.outcome !== "budget-exhausted" || this.inspectedAssignments.has(id)) return;
    this.inspectedAssignments.add(id);
    for (const listener of this.presentationListeners) listener();
  }

  report(workerId: string, assignmentId?: string): string {
    const report = this.owner.report(workerId, assignmentId);
    if (report.length > 0) this.acknowledgeEvidence(workerId, assignmentId);
    return report;
  }

  transcript(workerId: string, options: Parameters<WorkerOwner["transcript"]>[1] = {}) {
    const page = this.owner.transcript(workerId, options);
    if (page.entries.length > 0) this.acknowledgeEvidence(workerId, options.assignmentId);
    return page;
  }

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
    private readonly notify: (notice: WorkerNotice, noticeDeliveryId: string) => void,
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

  async continue(workerId: string, prompt: string, maxTurns?: number, hardMaxTurns?: number) {
    const launched = await this.owner.continue(workerId, prompt, maxTurns, hardMaxTurns);
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
      if (result.kind === "budget-exhausted" && result.assignment.partialReport) {
        this.acknowledgeEvidence(workerId, assignmentId);
      }
      return waitEvidence(result);
    } finally {
      delivery.waiters--;
      this.flush(workerId, assignmentId);
    }
  }

  /** Context projections are transient, so notices stay refreshable until runtime shutdown. */
  refreshNotice(noticeDeliveryId: string): WorkerNotice | undefined {
    if (this.closing) return;
    const notice = this.pendingNotices.get(noticeDeliveryId);
    if (!notice) return;
    const worker = this.owner.findStatus(
      notice.type === "update" ? notice.workerId : notice.worker.workerId,
    );
    if (!worker) return;
    return match(notice)
      .with({ type: "update" }, (update) => {
        const assignment = worker.assignments.find((item) => item.id === update.assignmentId);
        if (!assignment || isUnsettledAssignment(assignment.outcome)) return;
        return { ...update, state: assignment.outcome };
      })
      .with({ type: "question" }, (question) => ({
        ...question,
        worker: workerStatus(worker),
        requiresReply:
          worker.liveSession === "available" &&
          worker.status === "waiting-question" &&
          worker.currentAssignmentId === question.question.assignmentId &&
          worker.pendingQuestion?.id === question.question.id,
      }))
      .with({ type: P.union("completion", "storage-failure") }, (receipt) => {
        const assignment = worker.assignments.find(
          (item) => item.id === receipt.assignment.assignmentId,
        );
        if (!assignment) return;
        return {
          ...receipt,
          worker: workerStatus(worker),
          assignment: assignmentStatus(assignment),
        };
      })
      .exhaustive();
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    this.pendingNotices.clear();
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
      .with({ type: "update" }, ({ workerId, assignmentId, state, text }) =>
        this.notifyTracked({ type: "update", workerId, assignmentId, state, text }),
      )
      .with({ type: "state" }, ({ worker }) => this.flush(worker.id, worker.currentAssignmentId))
      .with({ type: "persistence" }, ({ workerId, assignmentId }) =>
        this.flush(workerId, assignmentId),
      )
      .with({ type: P.union("question", "turn") }, () => undefined)
      .exhaustive();
  }

  private notifyTracked(notice: WorkerNotice): void {
    // Saved messages outlive a runtime; opaque tokens must not collide after reload.
    const noticeDeliveryId = `${this.owner.parentSessionId}:${randomUUID()}`;
    this.pendingNotices.set(noticeDeliveryId, notice);
    try {
      this.notify(notice, noticeDeliveryId);
    } catch (error) {
      this.pendingNotices.delete(noticeDeliveryId);
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
      this.notifyTracked({
        type: "question",
        worker: workerStatus(worker),
        question,
        requiresReply: true,
      });
      delivery.questionsDelivered.add(question.id);
      return;
    }
    if (isUnsettledAssignment(assignment.outcome)) return;
    if (assignment.persistence === "pending" || assignment.persistence === "not-attempted") return;
    if (delivery.receiptSent) return;
    const type = delivery.reportDelivered ? "storage-failure" : "completion";
    if (
      type === "storage-failure" &&
      (assignment.persistence !== "failed" || delivery.storageWarningSent)
    )
      return;

    this.notifyTracked({
      type,
      worker: workerStatus(worker),
      assignment: assignmentStatus(assignment),
      reportAvailable: assignment.report !== undefined,
      verified: false,
    });
    if (type === "completion") delivery.receiptSent = true;
    else delivery.storageWarningSent = true;
  }
}
