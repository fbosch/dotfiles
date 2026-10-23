import { WorkerOwner, type AssignmentSnapshot, type LaunchRequest, type OwnerEvent, type WaitOptions, type WaitResult, type WorkerSnapshot } from "./owner";

function assignmentStatus(assignment: AssignmentSnapshot) {
  return {
    assignmentId: assignment.id, outcome: assignment.outcome, turnsUsed: assignment.turnsUsed,
    maxTurns: assignment.maxTurns, remainingTurns: assignment.remainingTurns, persistence: assignment.persistence,
    ...(assignment.error ? { error: assignment.error } : {}),
    ...(assignment.persistenceError ? { persistenceError: assignment.persistenceError } : {}),
  };
}

/** Ordinary status excludes configuration prompts, reports, and investigation transcripts. */
export function workerStatus(worker: WorkerSnapshot) {
  return {
    parentSessionId: worker.parentSessionId, workerId: worker.id, specialist: worker.specialist,
    state: worker.status, liveSession: worker.liveSession, currentAssignmentId: worker.currentAssignmentId,
    assignments: worker.assignments.map(assignmentStatus),
    ...(worker.pendingQuestion ? { question: worker.pendingQuestion } : {}),
  };
}

function waitEvidence(result: WaitResult) {
  return {
    kind: result.kind, worker: workerStatus(result.worker), assignment: assignmentStatus(result.assignment),
    ...(result.assignment.report !== undefined ? { report: result.assignment.report } : {}),
    ...(result.assignment.partialReport !== undefined ? { partialReport: result.assignment.partialReport } : {}),
    ...(result.kind === "question" ? { question: result.question } : {}),
    ...("cancelled" in result ? { cancelled: result.cancelled } : {}),
  };
}

export type WorkerNotice =
  | { type: "completion" | "storage-failure"; worker: ReturnType<typeof workerStatus>; assignment: ReturnType<typeof assignmentStatus>; reportAvailable: boolean; verified: false }
  | { type: "question"; worker: ReturnType<typeof workerStatus>; question: NonNullable<WorkerSnapshot["pendingQuestion"]> }
  | { type: "update"; workerId: string; assignmentId: string; state: string; text: string };

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
  private readonly unsubscribe: () => void;
  private closing = false;
  private readonly foreground = new Set<string>();
  private readonly presentationListeners = new Set<() => void>();

  foregroundWorkerIds(): ReadonlySet<string> { return new Set(this.foreground); }
  subscribePresentation(listener: () => void): () => void {
    this.presentationListeners.add(listener);
    return () => { this.presentationListeners.delete(listener); };
  }

  constructor(readonly owner: WorkerOwner, private readonly notify: (notice: WorkerNotice) => void, private readonly onError: (error: unknown) => void) {
    this.unsubscribe = owner.subscribe((event) => {
      try { this.onEvent(event); } catch (error) { this.onError(error); }
    });
  }

  async launch(request: LaunchRequest, options: { foreground?: boolean; signal?: AbortSignal; onProgress?: (status: ReturnType<typeof workerStatus>) => void } = {}) {
    const launched = await this.owner.launch(request);
    this.track(launched.assignmentId);
    if (options.foreground) {
      this.foreground.add(launched.workerId);
      for (const listener of this.presentationListeners) listener();
      const progress = () => options.onProgress?.(workerStatus(this.owner.inspect(launched.workerId)));
      const unsubscribe = this.owner.subscribe((event) => {
        const id = event.type === "state" ? event.worker.id : event.type === "question" ? event.question.workerId : event.workerId;
        if (id === launched.workerId) progress();
      });
      try {
        progress();
        return await this.wait(launched.workerId, launched.assignmentId, { ...(options.signal ? { signal: options.signal } : {}) }, true);
      } finally {
        unsubscribe();
        this.foreground.delete(launched.workerId);
        for (const listener of this.presentationListeners) listener();
      }
    }
    this.flush(launched.workerId, launched.assignmentId);
    return { kind: "launched" as const, workerId: launched.workerId, assignmentId: launched.assignmentId, worker: workerStatus(this.owner.inspect(launched.workerId)) };
  }

  async continue(workerId: string, prompt: string, maxTurns?: number) {
    const launched = await this.owner.continue(workerId, prompt, maxTurns);
    this.track(launched.assignmentId);
    this.flush(workerId, launched.assignmentId);
    return { kind: "launched" as const, workerId, assignmentId: launched.assignmentId, worker: workerStatus(this.owner.inspect(workerId)) };
  }

  async wait(workerId: string, assignmentId: string, options: WaitOptions = {}, foreground = false) {
    this.owner.inspect(workerId);
    const delivery = this.track(assignmentId);
    delivery.waiters++;
    try {
      let result = await this.owner.wait(workerId, assignmentId, options);
      if (foreground && result.kind === "interrupted") {
        await this.owner.cancel(workerId);
        result = await this.owner.wait(workerId, assignmentId);
      }
      if (result.kind === "question" && result.question) delivery.questionsDelivered.add(result.question.id);
      else if (result.kind !== "timeout" && result.kind !== "interrupted") delivery.reportDelivered = true;
      return waitEvidence(result);
    } finally {
      delivery.waiters--;
      this.flush(workerId, assignmentId);
    }
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    try { await this.owner.shutdown(); } finally { this.unsubscribe(); }
  }

  private track(assignmentId: string): Delivery {
    let state = this.assignments.get(assignmentId);
    if (!state) {
      state = { waiters: 0, reportDelivered: false, receiptSent: false, storageWarningSent: false, questionsDelivered: new Set() };
      this.assignments.set(assignmentId, state);
    }
    return state;
  }

  private onEvent(event: OwnerEvent): void {
    if (this.closing) return;
    if (event.type === "update") {
      this.notify({ type: "update", workerId: event.workerId, assignmentId: event.assignmentId, state: event.state, text: event.text });
    } else if (event.type === "state") {
      this.flush(event.worker.id, event.worker.currentAssignmentId);
    } else if (event.type === "persistence") {
      this.flush(event.workerId, event.assignmentId);
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
    if (worker.status === "waiting-question" && question && !delivery.questionsDelivered.has(question.id)) {
      this.notify({ type: "question", worker: workerStatus(worker), question });
      delivery.questionsDelivered.add(question.id);
      return;
    }
    if (assignment.outcome === "queued" || assignment.outcome === "running" || assignment.outcome === "waiting-question" || assignment.outcome === "stopping") return;
    if (assignment.persistence === "pending" || assignment.persistence === "not-attempted") return;
    if (!delivery.reportDelivered && !delivery.receiptSent) {
      this.notify({ type: "completion", worker: workerStatus(worker), assignment: assignmentStatus(assignment), reportAvailable: assignment.report !== undefined, verified: false });
      delivery.receiptSent = true;
    } else if (delivery.reportDelivered && assignment.persistence === "failed" && !delivery.receiptSent && !delivery.storageWarningSent) {
      this.notify({ type: "storage-failure", worker: workerStatus(worker), assignment: assignmentStatus(assignment), reportAvailable: assignment.report !== undefined, verified: false });
      delivery.storageWarningSent = true;
    }
  }
}
