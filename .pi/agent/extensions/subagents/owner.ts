import { randomUUID } from "node:crypto";
import { match, P } from "ts-pattern";
import {
  AssignmentBudget,
  assignmentCeiling,
  type BudgetDecision,
  type BudgetOptions,
  type BudgetSnapshot,
  type BudgetToolOutcome,
  budgetTaskKind,
} from "./budget";
import type { ResolvedSpecialist } from "./specialist";

export type WorkerId = string;
export type AssignmentId = string;
export type QuestionId = string;
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
export type PersistenceStatus = "not-attempted" | "pending" | "saved" | "failed";

export interface TranscriptEntry {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly text: string;
  readonly timestamp: number;
}

export interface PendingQuestion {
  readonly id: QuestionId;
  readonly workerId: WorkerId;
  readonly assignmentId: AssignmentId;
  readonly text: string;
}

export interface AssignmentSnapshot {
  readonly id: AssignmentId;
  readonly prompt: string;
  readonly outcome: AssignmentOutcome;
  readonly maxTurns: number;
  readonly turnsUsed: number;
  readonly remainingTurns: number;
  readonly budget?: BudgetSnapshot;
  readonly report?: string;
  readonly partialReport?: string;
  readonly error?: string;
  readonly persistence: PersistenceStatus;
  readonly persistenceError?: string;
  readonly transcript: readonly TranscriptEntry[];
}

export interface WorkerSnapshot {
  readonly parentSessionId: string;
  readonly id: WorkerId;
  readonly specialist: string;
  readonly config: ResolvedSpecialist;
  readonly status: WorkerStatus;
  readonly liveSession: LiveSessionAvailability;
  readonly currentAssignmentId: AssignmentId;
  readonly pendingQuestion?: PendingQuestion;
  readonly assignments: readonly AssignmentSnapshot[];
  readonly createdAt: number;
}

/** Lightweight UI/status projection; full evidence remains available through inspect() and list(). */
export type WorkerStatusSnapshot = Omit<WorkerSnapshot, "config" | "assignments"> & {
  readonly config: Pick<ResolvedSpecialist, "model">;
  readonly assignments: readonly Omit<AssignmentSnapshot, "transcript">[];
};

export interface PersistedEvidence {
  /** Complete detached state needed to reconstruct owner-scoped history without credentials. */
  readonly worker: WorkerSnapshot;
  readonly parentSessionId: string;
  readonly workerId: WorkerId;
  readonly specialist: string;
  readonly assignment: AssignmentSnapshot;
  readonly transcript: readonly TranscriptEntry[];
  readonly savedAt: number;
}

export interface WorkerPersistence {
  /** Store complete evidence; this boundary must not truncate report text. */
  save(evidence: PersistedEvidence): Promise<void>;
}

export interface CleanupUncertainty {
  readonly parentSessionId: string;
  readonly workerId: WorkerId;
  readonly assignmentId: AssignmentId;
  readonly diagnostic: string;
}

/** Parent-supplied, process-scoped health; it must survive owner/extension replacement. */
export interface ProcessCleanupHealth {
  isBlocked(): boolean;
  markUncertain(uncertainty: CleanupUncertainty): void;
}

/** Driver signal that startup failed cleanly and no live child session exists. */
export class ChildStartupFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChildStartupFailedError";
  }
}

/** Driver signal that startup allocated resources but could not confirm their cleanup. */
export class UnconfirmedChildStartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnconfirmedChildStartupError";
  }
}

export type ChildExecutionOutcome =
  | { readonly kind: "completed"; readonly turnsUsed: number; readonly report: string }
  | {
      readonly kind: "failed";
      readonly turnsUsed: number;
      readonly error: string;
      readonly partialReport?: string;
    }
  | {
      readonly kind: "budget-exhausted";
      readonly turnsUsed: number;
      readonly partialReport?: string;
    }
  | { readonly kind: "waiting-question"; readonly turnsUsed: number };

export interface ChildRunInput {
  readonly parentSessionId: string;
  readonly workerId: WorkerId;
  readonly assignmentId: AssignmentId;
  readonly specialist: string;
  /** A detached, deeply frozen snapshot retained unchanged for the live worker. */
  readonly config: ResolvedSpecialist;
  readonly prompt: string;
  /** Cumulative turns already used and the remaining allowance for this segment. */
  readonly turnsAlreadyUsed: number;
  readonly turnBudget: number;
  /** The adapter injects its wrap-up instruction with two turns remaining and enforces the hard ceiling. */
  readonly wrapUpAtRemaining: 2;
}

export interface ChildPromptInput extends ChildRunInput {
  readonly purpose: "question-reply" | "continuation";
  readonly questionId?: QuestionId;
}

export interface ChildDriverCallbacks {
  /** Call once when yielding for a parent answer; the owner assigns the correlated question ID. */
  onQuestion(text: string): void;
  /** Material worker-authored progress, attributed to the current assignment. */
  onUpdate(text: string): void;
  /** Append one transcript item, separately from the final report. */
  onTranscript(entry: Omit<TranscriptEntry, "timestamp"> & { readonly timestamp?: number }): void;
  /** Called before a child turn; turnsUsed is cumulative and one-based within the assignment. */
  onTurn(turnsUsed: number): void;
  onBeforeModel?(): Promise<{ readonly maxTurns: number; readonly admitted: boolean }>;
  onToolOutcome?(outcome: BudgetToolOutcome): void;
}

/**
 * Host adapter contract: `start` creates the child and runs its first prompt; `prompt` runs a
 * parent answer or explicit continuation in that same session. Both resolve only after that
 * execution segment settles. Return cumulative assignment turnsUsed. A waiting-question outcome
 * must follow exactly one onQuestion callback. A clean start failure throws ChildStartupFailedError;
 * uncertain partial cleanup throws UnconfirmedChildStartupError. `abort` requests stop and must settle or reject
 * within the adapter's bounded shutdown grace; its acceptance is not shutdown confirmation.
 * `close` must confirm shutdown rather than merely report abort acceptance or dispose synchronously.
 */
export interface ChildDriver {
  start(input: ChildRunInput, callbacks: ChildDriverCallbacks): Promise<ChildExecutionOutcome>;
  prompt(input: ChildPromptInput, callbacks: ChildDriverCallbacks): Promise<ChildExecutionOutcome>;
  steer(workerId: WorkerId, text: string): Promise<void>;
  abort(workerId: WorkerId): Promise<void>;
  close(workerId: WorkerId): Promise<{ readonly confirmed: boolean; readonly diagnostic?: string }>;
}

export type OwnerEvent =
  | { readonly type: "state"; readonly worker: WorkerSnapshot }
  | { readonly type: "question"; readonly question: PendingQuestion }
  | {
      readonly type: "update";
      readonly workerId: WorkerId;
      readonly assignmentId: AssignmentId;
      readonly text: string;
      readonly state: WorkerStatus;
    }
  | {
      readonly type: "turn";
      readonly workerId: WorkerId;
      readonly assignmentId: AssignmentId;
      readonly turnsUsed: number;
      readonly remainingTurns: number;
      readonly wrapUp: boolean;
    }
  | {
      readonly type: "persistence";
      readonly workerId: WorkerId;
      readonly assignmentId: AssignmentId;
      readonly status: PersistenceStatus;
      readonly error?: string;
    };

export interface LaunchRequest {
  readonly config: ResolvedSpecialist;
  readonly prompt: string;
  readonly maxTurns?: number;
  readonly hardMaxTurns?: number;
}

export interface LaunchReceipt {
  readonly workerId: WorkerId;
  readonly assignmentId: AssignmentId;
  readonly worker: WorkerSnapshot;
}

export interface WaitOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export type WaitResult =
  | {
      readonly kind:
        | "completed"
        | "failed"
        | "budget-exhausted"
        | "cancelled"
        | "cleanup-unknown"
        | "question";
      readonly worker: WorkerSnapshot;
      readonly assignment: AssignmentSnapshot;
      readonly question?: PendingQuestion;
    }
  | {
      readonly kind: "timeout" | "interrupted";
      readonly worker: WorkerSnapshot;
      readonly assignment: AssignmentSnapshot;
      readonly cancelled: false;
    };

export interface TranscriptPage {
  readonly entries: readonly TranscriptEntry[];
  readonly offset: number;
  readonly nextOffset?: number;
}

export interface WorkerOwnerOptions {
  readonly parentSessionId: string;
  readonly driver: ChildDriver;
  readonly persistence: WorkerPersistence;
  readonly cleanupHealth: ProcessCleanupHealth;
  readonly capacity?: number;
  readonly budget?: Omit<BudgetOptions, "hardMaxTurns" | "taskKind">;
  /** Parent-loaded records are made read-only; they never recreate executable child sessions. */
  readonly historicalWorkers?: readonly WorkerSnapshot[];
}

interface MutableAssignment {
  id: AssignmentId;
  prompt: string;
  outcome: AssignmentOutcome;
  budget: AssignmentBudget;
  turnsUsed: number;
  report?: string;
  partialReport?: string;
  error?: string;
  persistence: PersistenceStatus;
  persistenceError?: string;
  transcript: TranscriptEntry[];
  saveVersion: number;
}

interface MutableWorker {
  parentSessionId: string;
  id: WorkerId;
  specialist: string;
  config: ResolvedSpecialist;
  status: WorkerStatus;
  liveSession: LiveSessionAvailability;
  currentAssignmentId: AssignmentId;
  pendingQuestion?: PendingQuestion;
  assignments: Map<AssignmentId, MutableAssignment>;
  createdAt: number;
  sessionStarted: boolean;
  active?: ActiveSegment;
}

interface QueueJob {
  readonly workerId: WorkerId;
  readonly assignmentId: AssignmentId;
  readonly purpose: "start" | "question-reply" | "continuation";
  readonly prompt?: string;
  readonly questionId?: QuestionId;
}

interface ActiveSegment {
  readonly token: string;
  readonly assignmentId: AssignmentId;
  readonly purpose: QueueJob["purpose"];
  readonly questionText: { value?: string };
  readonly observedTurns: { value: number };
}

const DEFAULT_CAPACITY = 6;
const MAX_TRANSCRIPT_PAGE = 500;

function positiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${label} must be a positive safe integer`);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function freezeConfig(config: ResolvedSpecialist): ResolvedSpecialist {
  return Object.freeze({
    ...config,
    tools: Object.freeze([...config.tools]),
    excludeTools: Object.freeze([...config.excludeTools]),
    extensions: Object.freeze([...config.extensions]),
    skills: Object.freeze(config.skills.map((skill) => Object.freeze({ ...skill }))),
    ...(config.skippedSkills === undefined
      ? {}
      : { skippedSkills: Object.freeze([...config.skippedSkills]) }),
    ...(config.mcpServers === undefined
      ? {}
      : { mcpServers: Object.freeze([...config.mcpServers]) }),
  });
}

function freezeAssignmentStatus(
  assignment: MutableAssignment,
): Omit<AssignmentSnapshot, "transcript"> {
  const maxTurns = assignment.budget.maxTurns;
  const budget = assignment.budget.snapshot();
  return Object.freeze({
    id: assignment.id,
    prompt: assignment.prompt,
    outcome: assignment.outcome,
    maxTurns,
    turnsUsed: assignment.turnsUsed,
    remainingTurns: Math.max(0, maxTurns - assignment.turnsUsed),
    ...(budget === undefined ? {} : { budget }),
    ...(assignment.report === undefined ? {} : { report: assignment.report }),
    ...(assignment.partialReport === undefined ? {} : { partialReport: assignment.partialReport }),
    ...(assignment.error === undefined ? {} : { error: assignment.error }),
    persistence: assignment.persistence,
    ...(assignment.persistenceError === undefined
      ? {}
      : { persistenceError: assignment.persistenceError }),
  });
}

function freezeAssignment(assignment: MutableAssignment): AssignmentSnapshot {
  return Object.freeze({
    ...freezeAssignmentStatus(assignment),
    transcript: Object.freeze(assignment.transcript.map((entry) => Object.freeze({ ...entry }))),
  });
}

export class WorkerOwner {
  readonly parentSessionId: string;
  private readonly driver: ChildDriver;
  private readonly persistence: WorkerPersistence;
  private readonly cleanupHealth: ProcessCleanupHealth;
  private readonly capacity: number;
  private readonly budgetOptions: Omit<BudgetOptions, "hardMaxTurns" | "taskKind">;
  private readonly notifiedBudgetGrants = new Set<string>();
  private readonly notifiedBudgetDiagnostics = new Set<string>();
  private readonly workers = new Map<WorkerId, MutableWorker>();
  private readonly queue: QueueJob[] = [];
  private readonly listeners = new Set<(event: OwnerEvent) => void>();
  private readonly pendingPersistence = new Set<Promise<void>>();
  private reservations = 0;
  private shuttingDown = false;
  private shutdownPromise?: Promise<void>;

  constructor(options: WorkerOwnerOptions) {
    if (!options.parentSessionId.trim())
      throw new Error("parentSessionId must be a non-empty string");
    this.parentSessionId = options.parentSessionId;
    this.driver = options.driver;
    this.persistence = options.persistence;
    this.cleanupHealth = options.cleanupHealth;
    this.capacity = options.capacity ?? DEFAULT_CAPACITY;
    positiveSafeInteger(this.capacity, "capacity");
    this.budgetOptions = { ...(options.budget ?? {}) };
    for (const historical of options.historicalWorkers ?? []) this.restoreHistorical(historical);
  }

  subscribe(listener: (event: OwnerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async launch(request: LaunchRequest): Promise<LaunchReceipt> {
    this.assertAdmissionOpen();
    if (!request.prompt.trim()) throw new Error("assignment prompt must be non-empty");
    const config = freezeConfig(request.config);
    const initialTurns = request.maxTurns ?? config.maxTurns;
    const ceiling = assignmentCeiling(initialTurns, config.hardMaxTurns, request.hardMaxTurns);
    const id = randomUUID();
    const assignmentId = randomUUID();
    const assignment = this.newAssignment(
      assignmentId,
      request.prompt,
      initialTurns,
      ceiling,
      config.name,
    );
    const worker: MutableWorker = {
      parentSessionId: this.parentSessionId,
      id,
      specialist: config.name,
      config,
      status: "queued",
      liveSession: "available",
      currentAssignmentId: assignmentId,
      assignments: new Map([[assignmentId, assignment]]),
      createdAt: Date.now(),
      sessionStarted: false,
    };
    this.workers.set(id, worker);
    this.queue.push({ workerId: id, assignmentId, purpose: "start" });
    this.emitState(worker);
    this.pump();
    return { workerId: id, assignmentId, worker: this.snapshot(worker) };
  }

  async launchForeground(request: LaunchRequest, options: WaitOptions = {}): Promise<WaitResult> {
    const receipt = await this.launch(request);
    return this.wait(receipt.workerId, receipt.assignmentId, options);
  }

  list(): WorkerSnapshot[] {
    return [...this.workers.values()].map((worker) => this.snapshot(worker));
  }

  listStatus(): WorkerStatusSnapshot[] {
    return [...this.workers.values()].map((worker) => this.statusSnapshot(worker));
  }

  findStatus(workerId: WorkerId): WorkerStatusSnapshot | undefined {
    const worker = this.workers.get(workerId);
    return worker?.parentSessionId === this.parentSessionId
      ? this.statusSnapshot(worker)
      : undefined;
  }

  inspect(workerId: WorkerId): WorkerSnapshot {
    return this.snapshot(this.requireWorker(workerId));
  }

  /** Full final report retrieval; no character cap is applied. */
  report(workerId: WorkerId, assignmentId?: AssignmentId): string {
    const worker = this.requireWorker(workerId);
    const assignment = this.requireAssignment(worker, assignmentId ?? worker.currentAssignmentId);
    if (assignment.report === undefined)
      throw new Error("No final report is available for this assignment");
    return assignment.report;
  }

  transcript(
    workerId: WorkerId,
    options: {
      readonly assignmentId?: AssignmentId;
      readonly offset?: number;
      readonly limit?: number;
    } = {},
  ): TranscriptPage {
    const worker = this.requireWorker(workerId);
    const assignment = this.requireAssignment(
      worker,
      options.assignmentId ?? worker.currentAssignmentId,
    );
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new Error("transcript offset must be a non-negative safe integer");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_TRANSCRIPT_PAGE) {
      throw new Error(`transcript limit must be between 1 and ${MAX_TRANSCRIPT_PAGE}`);
    }
    const entries = assignment.transcript
      .slice(offset, offset + limit)
      .map((entry) => Object.freeze({ ...entry }));
    return Object.freeze({
      entries: Object.freeze(entries),
      offset,
      ...(offset + entries.length < assignment.transcript.length
        ? { nextOffset: offset + entries.length }
        : {}),
    });
  }

  wait(
    workerId: WorkerId,
    assignmentId: AssignmentId,
    options: WaitOptions = {},
  ): Promise<WaitResult> {
    const worker = this.requireWorker(workerId);
    const assignment = this.requireAssignment(worker, assignmentId);
    if (
      options.timeoutMs !== undefined &&
      (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0)
    ) {
      throw new Error("timeoutMs must be a non-negative finite number");
    }
    const immediate = this.waitOutcome(worker, assignment);
    if (immediate) return Promise.resolve(immediate);
    const hasLiveSession = match(worker.liveSession)
      .with("available", () => true)
      .with("historical", "released", "none", () => false)
      .exhaustive();
    if (!hasLiveSession) {
      throw new Error(
        "No live execution is available to wait for; inspect the recorded history instead",
      );
    }
    if (options.signal?.aborted) return Promise.resolve(this.waitInterrupted(worker, assignment));

    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let unsubscribe = () => {};
      const cleanup = () => {
        unsubscribe();
        if (timer !== undefined) clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      };
      const finish = (result: WaitResult) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };
      const onAbort = () => finish(this.waitInterrupted(worker, assignment));
      unsubscribe = this.subscribe((event) => {
        if (event.type !== "state" || event.worker.id !== workerId) return;
        const result = this.waitOutcome(worker, assignment);
        if (result) finish(result);
      });
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.timeoutMs !== undefined)
        timer = setTimeout(() => finish(this.waitTimeout(worker, assignment)), options.timeoutMs);
      const afterSubscribe = this.waitOutcome(worker, assignment);
      if (afterSubscribe) finish(afterSubscribe);
    });
  }

  async steer(workerId: WorkerId, text: string): Promise<void> {
    const worker = this.requireWorker(workerId);
    if (worker.status !== "running")
      throw new Error(`Cannot steer worker in ${worker.status} state`);
    if (!text.trim()) throw new Error("steering text must be non-empty");
    await this.driver.steer(workerId, text);
  }

  async reply(workerId: WorkerId, questionId: QuestionId, text: string): Promise<WorkerSnapshot> {
    this.assertAdmissionOpen();
    const worker = this.requireWorker(workerId);
    const question = worker.pendingQuestion;
    if (!question || worker.status !== "waiting-question" || question.id !== questionId) {
      throw new Error("Question is not current for this worker");
    }
    if (!text.trim()) throw new Error("question reply must be non-empty");
    const assignment = this.requireAssignment(worker, question.assignmentId);
    if (assignment.budget.maxTurns - assignment.turnsUsed < 1) {
      throw new Error("No turns remain; explicitly extend the assignment budget before replying");
    }
    delete worker.pendingQuestion;
    worker.status = "queued";
    assignment.outcome = "queued";
    this.queue.push({
      workerId,
      assignmentId: assignment.id,
      purpose: "question-reply",
      prompt: text,
      questionId,
    });
    this.emitState(worker);
    this.pump();
    return this.snapshot(worker);
  }

  async extendBudget(
    workerId: WorkerId,
    assignmentId: AssignmentId,
    additionalTurns: number,
  ): Promise<WorkerSnapshot> {
    this.assertAdmissionOpen();
    positiveSafeInteger(additionalTurns, "additionalTurns");
    const worker = this.requireWorker(workerId);
    if (assignmentId !== worker.currentAssignmentId)
      throw new Error("Cannot extend a non-current assignment budget");
    const assignment = this.requireAssignment(worker, assignmentId);
    const canExtend =
      worker.liveSession === "available" &&
      match(worker.status)
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
    if (!canExtend) {
      throw new Error(`Cannot extend assignment budget in ${worker.status} state`);
    }
    assignment.budget.extend(additionalTurns);
    this.emitState(worker);
    return this.snapshot(worker);
  }

  async continue(
    workerId: WorkerId,
    prompt: string,
    maxTurns?: number,
    hardMaxTurns?: number,
  ): Promise<LaunchReceipt> {
    this.assertAdmissionOpen();
    if (!prompt.trim()) throw new Error("continuation prompt must be non-empty");
    const worker = this.requireWorker(workerId);
    if (worker.status !== "idle" || worker.liveSession !== "available") {
      throw new Error(`Cannot continue worker in ${worker.status} state`);
    }
    const previous = this.requireAssignment(worker, worker.currentAssignmentId);
    match(previous.outcome)
      .with("completed", "failed", "budget-exhausted", () => undefined)
      .with(
        "queued",
        "running",
        "waiting-question",
        "stopping",
        "cancelled",
        "cleanup-unknown",
        () => {
          throw new Error(`Cannot continue assignment with ${previous.outcome} outcome`);
        },
      )
      .exhaustive();
    const initialTurns = maxTurns ?? worker.config.maxTurns;
    const ceiling = assignmentCeiling(initialTurns, worker.config.hardMaxTurns, hardMaxTurns);
    const assignmentId = randomUUID();
    const assignment = this.newAssignment(
      assignmentId,
      prompt,
      initialTurns,
      ceiling,
      worker.config.name,
    );
    previous.budget.invalidate();
    previous.budget.invalidate();
    worker.assignments.set(assignmentId, assignment);
    worker.currentAssignmentId = assignmentId;
    worker.status = "queued";
    this.queue.push({ workerId, assignmentId, purpose: "continuation" });
    this.emitState(worker);
    this.pump();
    return { workerId, assignmentId, worker: this.snapshot(worker) };
  }

  async cancel(workerId: WorkerId): Promise<WorkerSnapshot> {
    const worker = this.requireWorker(workerId);
    return match(worker.status)
      .with("queued", () => this.cancelQueued(worker))
      .with("waiting-question", () => this.cancelQuestion(worker))
      .with("running", () => this.cancelRunning(worker))
      .with("stopping", "cleanup-unknown", "cancelled", () => this.snapshot(worker))
      .with("idle", "releasing", "released", "historical", () => {
        throw new Error(`Cannot cancel worker in ${worker.status} state`);
      })
      .exhaustive();
  }

  private cancelQueued(worker: MutableWorker): WorkerSnapshot {
    this.removeQueued(worker.id);
    const assignment = this.requireAssignment(worker, worker.currentAssignmentId);
    assignment.budget.invalidate();
    assignment.budget.invalidate();
    delete worker.pendingQuestion;
    if (worker.sessionStarted) {
      worker.status = "stopping";
      assignment.outcome = "stopping";
      this.emitState(worker);
      void this.closeCancelledIdle(worker, assignment);
    } else {
      assignment.outcome = "cancelled";
      worker.status = "cancelled";
      worker.liveSession = "none";
      this.emitState(worker);
      this.persist(worker, assignment);
    }
    this.pump();
    return this.snapshot(worker);
  }

  private cancelQuestion(worker: MutableWorker): WorkerSnapshot {
    worker.status = "stopping";
    delete worker.pendingQuestion;
    const assignment = this.requireAssignment(worker, worker.currentAssignmentId);
    assignment.budget.invalidate();
    assignment.budget.invalidate();
    assignment.outcome = "stopping";
    this.emitState(worker);
    void this.closeCancelledIdle(worker, assignment);
    return this.snapshot(worker);
  }

  private cancelRunning(worker: MutableWorker): WorkerSnapshot {
    const active = worker.active;
    if (!active) throw new Error(`Cannot cancel worker in ${worker.status} state`);
    worker.status = "stopping";
    const assignment = this.requireAssignment(worker, active.assignmentId);
    assignment.budget.invalidate();
    assignment.budget.invalidate();
    assignment.outcome = "stopping";
    this.emitState(worker);
    try {
      void this.driver.abort(worker.id).catch((error: unknown) => {
        this.markCleanupUnknown(worker, assignment, `Abort request failed: ${errorText(error)}`);
      });
    } catch (error) {
      this.markCleanupUnknown(worker, assignment, `Abort request failed: ${errorText(error)}`);
    }
    return this.snapshot(worker);
  }

  async release(workerId: WorkerId): Promise<WorkerSnapshot> {
    const worker = this.requireWorker(workerId);
    if (worker.liveSession === "released" || worker.liveSession === "none")
      return this.snapshot(worker);
    if (worker.status !== "idle" && worker.status !== "cancelled")
      throw new Error(`Cannot release worker in ${worker.status} state`);
    for (const assignment of worker.assignments.values()) assignment.budget.invalidate();
    for (const assignment of worker.assignments.values()) assignment.budget.invalidate();
    worker.status = "releasing";
    this.emitState(worker);
    let result: { readonly confirmed: boolean; readonly diagnostic?: string };
    try {
      result = await this.driver.close(workerId);
    } catch (error) {
      result = { confirmed: false, diagnostic: errorText(error) };
    }
    if (!result.confirmed) {
      this.markCleanupUnknown(
        worker,
        this.requireAssignment(worker, worker.currentAssignmentId),
        result.diagnostic ?? "Child session shutdown was not confirmed",
      );
    } else {
      worker.status = "released";
      worker.liveSession = "released";
      this.emitState(worker);
    }
    return this.snapshot(worker);
  }

  /**
   * Stop admission, settle active work, close retained sessions, and drain evidence writes.
   * Cleanup-unknown workers keep their execution reservations and remain referenced.
   */
  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shuttingDown = true;
    for (const worker of this.workers.values()) {
      for (const assignment of worker.assignments.values()) assignment.budget.invalidate();
    }
    for (const worker of this.workers.values()) {
      for (const assignment of worker.assignments.values()) assignment.budget.invalidate();
    }
    this.shutdownPromise = this.performShutdown();
    return this.shutdownPromise;
  }

  private async performShutdown(): Promise<void> {
    const workerIds = [...this.workers.keys()];
    await Promise.all(
      workerIds.map((workerId) => {
        const worker = this.workers.get(workerId);
        if (!worker) return Promise.resolve();
        return match(worker.status)
          .with("queued", "running", "waiting-question", () => this.cancel(workerId))
          .with(
            "stopping",
            "idle",
            "cancelled",
            "cleanup-unknown",
            "releasing",
            "released",
            "historical",
            () => Promise.resolve(),
          )
          .exhaustive();
      }),
    );
    await Promise.all(workerIds.map((workerId) => this.awaitShutdownSettlement(workerId)));
    await Promise.all(
      workerIds.map((workerId) => {
        const worker = this.workers.get(workerId);
        if (!worker || worker.liveSession !== "available") return Promise.resolve();
        return match(worker.status)
          .with("idle", "cancelled", () => this.release(workerId))
          .with(
            "queued",
            "running",
            "waiting-question",
            "stopping",
            "cleanup-unknown",
            "releasing",
            "released",
            "historical",
            () => Promise.resolve(),
          )
          .exhaustive();
      }),
    );
    await Promise.allSettled([...this.pendingPersistence]);
  }

  private awaitShutdownSettlement(workerId: WorkerId): Promise<void> {
    const isSettled = () => {
      const status = this.workers.get(workerId)?.status;
      return match(status)
        .with(
          undefined,
          "idle",
          "cancelled",
          "cleanup-unknown",
          "released",
          "historical",
          () => true,
        )
        .with("queued", "running", "waiting-question", "stopping", "releasing", () => false)
        .exhaustive();
    };
    if (isSettled()) return Promise.resolve();
    return new Promise((resolve) => {
      let unsubscribe = () => {};
      const check = () => {
        if (!isSettled()) return;
        unsubscribe();
        resolve();
      };
      unsubscribe = this.subscribe((event) => {
        if (event.type === "state" && event.worker.id === workerId) check();
      });
      check();
    });
  }

  /** Parent-loaded history is readable but cannot recreate a live child or resume an assignment. */
  restoreHistorical(snapshot: WorkerSnapshot): void {
    if (snapshot.parentSessionId !== this.parentSessionId)
      throw new Error("Historical worker belongs to another parent session");
    if (this.workers.has(snapshot.id)) throw new Error(`Duplicate worker ID: ${snapshot.id}`);
    const assignments = new Map<AssignmentId, MutableAssignment>();
    for (const item of snapshot.assignments) {
      assignments.set(item.id, {
        id: item.id,
        prompt: item.prompt,
        outcome: item.outcome,
        budget: AssignmentBudget.fromHistory(item.maxTurns, item.budget),
        turnsUsed: item.turnsUsed,
        ...(item.report === undefined ? {} : { report: item.report }),
        ...(item.partialReport === undefined ? {} : { partialReport: item.partialReport }),
        ...(item.error === undefined ? {} : { error: item.error }),
        persistence: item.persistence,
        ...(item.persistenceError === undefined ? {} : { persistenceError: item.persistenceError }),
        transcript: item.transcript.map((entry) => ({ ...entry })),
        saveVersion: 0,
      });
    }
    if (!assignments.has(snapshot.currentAssignmentId))
      throw new Error("Historical worker has no current assignment record");
    const worker: MutableWorker = {
      parentSessionId: this.parentSessionId,
      id: snapshot.id,
      specialist: snapshot.specialist,
      config: freezeConfig(snapshot.config),
      status: "historical",
      liveSession: "historical",
      currentAssignmentId: snapshot.currentAssignmentId,
      ...(snapshot.pendingQuestion === undefined
        ? {}
        : { pendingQuestion: Object.freeze({ ...snapshot.pendingQuestion }) }),
      assignments,
      createdAt: snapshot.createdAt,
      sessionStarted: false,
    };
    this.workers.set(worker.id, worker);
    this.emitState(worker);
  }

  private newAssignment(
    id: AssignmentId,
    prompt: string,
    initialTurns: number,
    hardMaxTurns: number | undefined,
    specialist: string,
  ): MutableAssignment {
    return {
      id,
      prompt,
      outcome: "queued",
      budget: new AssignmentBudget(initialTurns, {
        ...this.budgetOptions,
        taskKind: budgetTaskKind(specialist),
        ...(hardMaxTurns === undefined ? {} : { hardMaxTurns }),
      }),
      turnsUsed: 0,
      persistence: "not-attempted",
      transcript: [],
      saveVersion: 0,
    };
  }

  private assertAdmissionOpen(): void {
    if (this.shuttingDown) throw new Error("Worker owner is shutting down");
    if (this.cleanupHealth.isBlocked())
      throw new Error("Worker delegation is blocked by process cleanup uncertainty");
  }

  private requireWorker(workerId: WorkerId): MutableWorker {
    const worker = this.workers.get(workerId);
    if (!worker || worker.parentSessionId !== this.parentSessionId)
      throw new Error("Worker is not owned by this parent session");
    return worker;
  }

  private requireAssignment(worker: MutableWorker, assignmentId: AssignmentId): MutableAssignment {
    const assignment = worker.assignments.get(assignmentId);
    if (!assignment) throw new Error("Assignment is not owned by this worker");
    return assignment;
  }

  private statusSnapshot(worker: MutableWorker): WorkerStatusSnapshot {
    return Object.freeze({
      parentSessionId: worker.parentSessionId,
      id: worker.id,
      specialist: worker.specialist,
      config: Object.freeze({ model: worker.config.model }),
      status: worker.status,
      liveSession: worker.liveSession,
      currentAssignmentId: worker.currentAssignmentId,
      ...(worker.pendingQuestion === undefined
        ? {}
        : { pendingQuestion: Object.freeze({ ...worker.pendingQuestion }) }),
      assignments: Object.freeze([...worker.assignments.values()].map(freezeAssignmentStatus)),
      createdAt: worker.createdAt,
    });
  }

  private snapshot(worker: MutableWorker): WorkerSnapshot {
    return Object.freeze({
      parentSessionId: worker.parentSessionId,
      id: worker.id,
      specialist: worker.specialist,
      config: worker.config,
      status: worker.status,
      liveSession: worker.liveSession,
      currentAssignmentId: worker.currentAssignmentId,
      ...(worker.pendingQuestion === undefined
        ? {}
        : { pendingQuestion: Object.freeze({ ...worker.pendingQuestion }) }),
      assignments: Object.freeze([...worker.assignments.values()].map(freezeAssignment)),
      createdAt: worker.createdAt,
    });
  }

  private emit(event: OwnerEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private emitState(worker: MutableWorker): void {
    this.emit({ type: "state", worker: this.snapshot(worker) });
  }

  private pump(): void {
    if (this.shuttingDown || this.cleanupHealth.isBlocked()) return;
    while (this.reservations < this.capacity && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) return;
      const worker = this.workers.get(job.workerId);
      if (!worker || worker.status !== "queued") continue;
      const assignment = worker.assignments.get(job.assignmentId);
      if (!assignment || assignment.outcome !== "queued") continue;
      this.startSegment(worker, assignment, job);
    }
  }

  private emitBudgetDecision(
    worker: MutableWorker,
    assignment: MutableAssignment,
    decision: BudgetDecision,
  ): void {
    if (decision.kind === "granted" && decision.grantedTurns > 0) {
      const ceiling = assignment.budget.snapshot()?.hardMaxTurns;
      const key = `${assignment.id}:${decision.revision}`;
      if (ceiling === undefined || this.notifiedBudgetGrants.has(key)) return;
      this.notifiedBudgetGrants.add(key);
      this.emit({
        type: "update",
        workerId: worker.id,
        assignmentId: assignment.id,
        text: `Granted ${decision.grantedTurns} additional turns; allowance ${assignment.budget.maxTurns}, ceiling ${ceiling}.`,
        state: worker.status,
      });
      return;
    }
    if (
      decision.diagnostic !== true ||
      decision.reason === "unsupported" ||
      this.notifiedBudgetDiagnostics.has(decision.reason)
    ) {
      return;
    }
    this.notifiedBudgetDiagnostics.add(decision.reason);
    this.emit({
      type: "update",
      workerId: worker.id,
      assignmentId: assignment.id,
      text:
        decision.reason === "automatic-not-ready"
          ? `Automatic budget grants need a reviewed confidence threshold; turn allowance remains ${assignment.budget.maxTurns}.`
          : `Budget advice unavailable (${decision.reason}); turn allowance remains ${assignment.budget.maxTurns}.`,
      state: worker.status,
    });
  }

  private startSegment(worker: MutableWorker, assignment: MutableAssignment, job: QueueJob): void {
    this.reservations++;
    worker.status = "running";
    assignment.outcome = "running";
    const remaining = assignment.budget.maxTurns - assignment.turnsUsed;
    const token = randomUUID();
    const questionText: { value?: string } = {};
    const observedTurns = { value: assignment.turnsUsed };
    worker.active = {
      token,
      assignmentId: assignment.id,
      purpose: job.purpose,
      questionText,
      observedTurns,
    };
    this.emitState(worker);

    const isCurrent = () => worker.active?.token === token;
    const isBudgetEligible = () =>
      worker.parentSessionId === this.parentSessionId &&
      this.workers.get(worker.id) === worker &&
      worker.assignments.get(assignment.id) === assignment &&
      worker.currentAssignmentId === assignment.id &&
      worker.active?.token === token &&
      worker.active.assignmentId === assignment.id &&
      worker.status === "running" &&
      assignment.outcome === "running" &&
      questionText.value === undefined &&
      worker.pendingQuestion === undefined &&
      !this.shuttingDown &&
      !this.cleanupHealth.isBlocked();
    const callbacks: ChildDriverCallbacks = {
      onQuestion: (text) => {
        if (!isCurrent() || worker.status === "stopping" || worker.status === "cleanup-unknown")
          return;
        if (questionText.value !== undefined) {
          questionText.value = "";
          return;
        }
        questionText.value = text.trim();
        assignment.budget.invalidate();
      },
      onUpdate: (text) => {
        if (isCurrent() && worker.status === "running") {
          this.emit({
            type: "update",
            workerId: worker.id,
            assignmentId: assignment.id,
            text,
            state: worker.status,
          });
        }
      },
      onTranscript: (entry) => {
        if (!isCurrent()) return;
        assignment.transcript.push(
          Object.freeze({ ...entry, timestamp: entry.timestamp ?? Date.now() }),
        );
      },
      onTurn: (turnsUsed) => {
        if (
          !isCurrent() ||
          worker.status === "cleanup-unknown" ||
          !Number.isSafeInteger(turnsUsed) ||
          turnsUsed < 1 ||
          turnsUsed > assignment.budget.maxTurns
        )
          return;
        observedTurns.value = Math.max(observedTurns.value, turnsUsed);
        assignment.turnsUsed = Math.max(assignment.turnsUsed, turnsUsed);
        const remainingTurns = Math.max(0, assignment.budget.maxTurns - turnsUsed);
        this.emit({
          type: "turn",
          workerId: worker.id,
          assignmentId: assignment.id,
          turnsUsed,
          remainingTurns,
          wrapUp: remainingTurns <= 2,
        });
        this.emitState(worker);
      },
      onBeforeModel: async () => {
        const nextTurn = assignment.turnsUsed + 1;
        const admission = await assignment.budget.beforeModel(nextTurn, isBudgetEligible);
        const eligible = isBudgetEligible();
        if (eligible && admission.decision !== undefined) {
          this.emitState(worker);
          this.emitBudgetDecision(worker, assignment, admission.decision);
        }
        const maxTurns = assignment.budget.maxTurns;
        return {
          maxTurns,
          admitted: eligible && Number.isSafeInteger(nextTurn) && nextTurn <= maxTurns,
        };
      },
      onToolOutcome: (outcome) => {
        if (!isBudgetEligible()) return;
        assignment.budget.observe(outcome);
        this.emitState(worker);
      },
    };
    const common: ChildRunInput = {
      parentSessionId: this.parentSessionId,
      workerId: worker.id,
      assignmentId: assignment.id,
      specialist: worker.specialist,
      config: worker.config,
      prompt: job.prompt ?? assignment.prompt,
      turnsAlreadyUsed: assignment.turnsUsed,
      turnBudget: remaining,
      wrapUpAtRemaining: 2,
    };
    let execution: Promise<ChildExecutionOutcome>;
    try {
      execution = match(job.purpose)
        .with("start", () => {
          worker.sessionStarted = true;
          return this.driver.start(common, callbacks);
        })
        .with("question-reply", "continuation", (purpose) =>
          this.driver.prompt(
            {
              ...common,
              purpose,
              ...(job.questionId === undefined ? {} : { questionId: job.questionId }),
            },
            callbacks,
          ),
        )
        .exhaustive();
    } catch (error) {
      execution = Promise.reject(error);
    }
    void Promise.resolve(execution).then(
      (result) => this.settleSegment(worker, assignment, token, result),
      (error: unknown) => this.settleSegmentFailure(worker, assignment, token, error),
    );
  }

  private settleSegmentFailure(
    worker: MutableWorker,
    assignment: MutableAssignment,
    token: string,
    error: unknown,
  ): void {
    if (worker.active?.token !== token) return;
    assignment.budget.invalidate();
    assignment.budget.invalidate();
    assignment.turnsUsed = Math.max(assignment.turnsUsed, worker.active.observedTurns.value);
    if (error instanceof UnconfirmedChildStartupError) {
      this.markCleanupUnknown(worker, assignment, error.message);
      return;
    }
    if (error instanceof ChildStartupFailedError && worker.active.purpose === "start") {
      worker.sessionStarted = false;
      worker.liveSession = "none";
    }
    if (worker.status === "cleanup-unknown") {
      assignment.partialReport ??= errorText(error);
      this.emitState(worker);
      return;
    }
    if (worker.status === "stopping") {
      assignment.partialReport ??= errorText(error);
      void this.finishCancellation(worker, assignment, token);
      return;
    }
    assignment.outcome = "failed";
    assignment.error = errorText(error);
    delete worker.active;
    worker.status = "idle";
    this.reservations--;
    this.emitState(worker);
    this.persist(worker, assignment);
    this.pump();
  }

  private settleSegment(
    worker: MutableWorker,
    assignment: MutableAssignment,
    token: string,
    result: ChildExecutionOutcome,
  ): void {
    const active = worker.active;
    if (!active || active.token !== token) return;
    assignment.budget.invalidate();
    assignment.budget.invalidate();
    if (
      !Number.isSafeInteger(result.turnsUsed) ||
      result.turnsUsed < assignment.turnsUsed ||
      result.turnsUsed > assignment.budget.maxTurns
    ) {
      this.settleSegmentFailure(
        worker,
        assignment,
        token,
        new Error("Child driver returned invalid or over-budget cumulative turnsUsed"),
      );
      return;
    }
    assignment.turnsUsed = Math.max(result.turnsUsed, active.observedTurns.value);
    if (worker.status === "cleanup-unknown") {
      this.retainPartialOutcome(assignment, result);
      this.emitState(worker);
      return;
    }
    if (worker.status === "stopping") {
      this.retainPartialOutcome(assignment, result);
      void this.finishCancellation(worker, assignment, token);
      return;
    }
    if (result.kind === "waiting-question") {
      const text = active.questionText.value;
      if (!text) {
        this.settleSegmentFailure(
          worker,
          assignment,
          token,
          new Error("Child driver yielded without exactly one correlated question"),
        );
        return;
      }
      const question: PendingQuestion = Object.freeze({
        id: randomUUID(),
        workerId: worker.id,
        assignmentId: assignment.id,
        text,
      });
      worker.pendingQuestion = question;
      assignment.outcome = "waiting-question";
      delete worker.active;
      worker.status = "waiting-question";
      this.reservations--;
      this.emitState(worker);
      this.emit({ type: "question", question });
      this.persist(worker, assignment);
      this.pump();
      return;
    }
    delete worker.active;
    worker.status = "idle";
    this.reservations--;
    match(result)
      .with({ kind: "completed" }, ({ report }) => {
        assignment.outcome = "completed";
        assignment.report = report;
      })
      .with({ kind: "failed" }, ({ error, partialReport }) => {
        assignment.outcome = "failed";
        assignment.error = error;
        this.setPartialReport(assignment, partialReport);
      })
      .with({ kind: "budget-exhausted" }, ({ partialReport }) => {
        assignment.outcome = "budget-exhausted";
        this.setPartialReport(assignment, partialReport);
      })
      .exhaustive();
    this.emitState(worker);
    this.persist(worker, assignment);
    this.pump();
  }

  private retainPartialOutcome(assignment: MutableAssignment, result: ChildExecutionOutcome): void {
    match(result)
      .with({ kind: "completed" }, ({ report }) => {
        assignment.partialReport = report;
      })
      .with({ kind: P.union("failed", "budget-exhausted") }, ({ partialReport }) =>
        this.setPartialReport(assignment, partialReport),
      )
      .with({ kind: "waiting-question" }, () => undefined)
      .exhaustive();
  }

  private setPartialReport(assignment: MutableAssignment, report: string | undefined): void {
    if (report === undefined) delete assignment.partialReport;
    else assignment.partialReport = report;
  }

  private async finishCancellation(
    worker: MutableWorker,
    assignment: MutableAssignment,
    token: string,
  ): Promise<void> {
    let result: { readonly confirmed: boolean; readonly diagnostic?: string };
    try {
      result = await this.driver.close(worker.id);
    } catch (error) {
      result = { confirmed: false, diagnostic: errorText(error) };
    }
    if (worker.active?.token !== token) return;
    if (!result.confirmed) {
      this.markCleanupUnknown(
        worker,
        assignment,
        result.diagnostic ?? "Child session shutdown was not confirmed",
      );
      return;
    }
    delete worker.active;
    worker.status = "cancelled";
    worker.liveSession = "released";
    assignment.outcome = "cancelled";
    delete worker.pendingQuestion;
    this.reservations--;
    this.emitState(worker);
    this.persist(worker, assignment);
    this.pump();
  }

  private async closeCancelledIdle(
    worker: MutableWorker,
    assignment: MutableAssignment,
  ): Promise<void> {
    let result: { readonly confirmed: boolean; readonly diagnostic?: string };
    try {
      result = await this.driver.close(worker.id);
    } catch (error) {
      result = { confirmed: false, diagnostic: errorText(error) };
    }
    if (worker.status !== "stopping") return;
    if (!result.confirmed) {
      this.markCleanupUnknown(
        worker,
        assignment,
        result.diagnostic ?? "Child session shutdown was not confirmed",
      );
      return;
    }
    worker.status = "cancelled";
    worker.liveSession = "released";
    assignment.outcome = "cancelled";
    delete worker.pendingQuestion;
    this.emitState(worker);
    this.persist(worker, assignment);
  }

  private markCleanupUnknown(
    worker: MutableWorker,
    assignment: MutableAssignment,
    diagnostic: string,
  ): void {
    assignment.budget.invalidate();
    assignment.budget.invalidate();
    worker.status = "cleanup-unknown";
    assignment.outcome = "cleanup-unknown";
    assignment.error = diagnostic;
    delete worker.pendingQuestion;
    this.cleanupHealth.markUncertain({
      parentSessionId: this.parentSessionId,
      workerId: worker.id,
      assignmentId: assignment.id,
      diagnostic,
    });
    this.emitState(worker);
    this.persist(worker, assignment);
  }

  private persist(worker: MutableWorker, assignment: MutableAssignment): void {
    const version = ++assignment.saveVersion;
    assignment.persistence = "pending";
    delete assignment.persistenceError;
    const frozen = freezeAssignment(assignment);
    const evidence: PersistedEvidence = Object.freeze({
      worker: this.snapshot(worker),
      parentSessionId: this.parentSessionId,
      workerId: worker.id,
      specialist: worker.specialist,
      assignment: frozen,
      transcript: frozen.transcript,
      savedAt: Date.now(),
    });
    this.emit({
      type: "persistence",
      workerId: worker.id,
      assignmentId: assignment.id,
      status: "pending",
    });
    const save = Promise.resolve()
      .then(() => this.persistence.save(evidence))
      .then(
        () => {
          if (assignment.saveVersion !== version) return;
          assignment.persistence = "saved";
          this.emit({
            type: "persistence",
            workerId: worker.id,
            assignmentId: assignment.id,
            status: "saved",
          });
          this.emitState(worker);
        },
        (error: unknown) => {
          if (assignment.saveVersion !== version) return;
          assignment.persistence = "failed";
          assignment.persistenceError = errorText(error);
          this.emit({
            type: "persistence",
            workerId: worker.id,
            assignmentId: assignment.id,
            status: "failed",
            error: assignment.persistenceError,
          });
          this.emitState(worker);
        },
      );
    this.pendingPersistence.add(save);
    void save.then(
      () => this.pendingPersistence.delete(save),
      () => this.pendingPersistence.delete(save),
    );
  }

  private waitOutcome(
    worker: MutableWorker,
    assignment: MutableAssignment,
  ): WaitResult | undefined {
    return match(assignment.outcome)
      .returnType<WaitResult | undefined>()
      .with("waiting-question", () => {
        const question = worker.pendingQuestion;
        return question
          ? {
              kind: "question",
              worker: this.snapshot(worker),
              assignment: freezeAssignment(assignment),
              question,
            }
          : undefined;
      })
      .with("completed", "failed", "budget-exhausted", "cancelled", "cleanup-unknown", (kind) => ({
        kind,
        worker: this.snapshot(worker),
        assignment: freezeAssignment(assignment),
      }))
      .with("queued", "running", "stopping", () => undefined)
      .exhaustive();
  }

  private waitTimeout(worker: MutableWorker, assignment: MutableAssignment): WaitResult {
    return {
      kind: "timeout",
      worker: this.snapshot(worker),
      assignment: freezeAssignment(assignment),
      cancelled: false,
    };
  }

  private waitInterrupted(worker: MutableWorker, assignment: MutableAssignment): WaitResult {
    return {
      kind: "interrupted",
      worker: this.snapshot(worker),
      assignment: freezeAssignment(assignment),
      cancelled: false,
    };
  }

  private removeQueued(workerId: WorkerId): void {
    for (let index = this.queue.length - 1; index >= 0; index--) {
      if (this.queue[index]?.workerId === workerId) this.queue.splice(index, 1);
    }
  }
}
