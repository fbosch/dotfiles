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
import {
  type AssignmentOutcome,
  historicalWorker,
  isSettled,
  type LifecycleEffect,
  type LifecycleEvent,
  type LifecycleState,
  type LiveSessionAvailability,
  launchedWorker,
  type Operation,
  permission,
  type SegmentPurpose,
  transition,
  type WorkerStatus,
} from "./lifecycle";
import type { ResolvedSpecialist } from "./specialist";
import { transcriptPage } from "./transcript-page";

export type { AssignmentOutcome, LiveSessionAvailability, WorkerStatus } from "./lifecycle";

export type WorkerId = string;
export type AssignmentId = string;
export type QuestionId = string;
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
  readonly textOffset?: number;
  readonly nextTextOffset?: number;
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
  reserved: boolean;
  closeAttempt?: number;
  active?: ActiveSegment;
}

interface QueueJob {
  readonly workerId: WorkerId;
  readonly assignmentId: AssignmentId;
  readonly purpose: SegmentPurpose;
  readonly prompt?: string;
  readonly questionId?: QuestionId;
}

interface ActiveSegment {
  readonly token: string;
  readonly assignmentId: AssignmentId;
  readonly purpose: QueueJob["purpose"];
  questionText?: string;
  observedTurns: number;
}

const DEFAULT_CAPACITY = 6;

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
      ...launchedWorker,
      currentAssignmentId: assignmentId,
      assignments: new Map([[assignmentId, assignment]]),
      createdAt: Date.now(),
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
      readonly textOffset?: number;
    } = {},
  ): TranscriptPage {
    const worker = this.requireWorker(workerId);
    const assignment = this.requireAssignment(
      worker,
      options.assignmentId ?? worker.currentAssignmentId,
    );
    return transcriptPage(assignment.transcript, options.offset, options.limit, options.textOffset);
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
    this.assertPermitted(worker, "steer");
    if (!text.trim()) throw new Error("steering text must be non-empty");
    await this.driver.steer(workerId, text);
  }

  async reply(workerId: WorkerId, questionId: QuestionId, text: string): Promise<WorkerSnapshot> {
    this.assertAdmissionOpen();
    const worker = this.requireWorker(workerId);
    const question = worker.pendingQuestion;
    this.assertPermitted(worker, "reply");
    if (!question || question.id !== questionId) {
      throw new Error("Question is not current for this worker");
    }
    if (!text.trim()) throw new Error("question reply must be non-empty");
    const assignment = this.requireAssignment(worker, question.assignmentId);
    if (assignment.budget.maxTurns - assignment.turnsUsed < 1) {
      throw new Error("No turns remain; explicitly extend the assignment budget before replying");
    }
    this.queue.push({
      workerId,
      assignmentId: assignment.id,
      purpose: "question-reply",
      prompt: text,
      questionId,
    });
    this.dispatch(worker, { type: "replied" });
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
    this.assertPermitted(worker, "extendBudget");
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
    this.assertPermitted(worker, "continue");
    const previous = this.requireAssignment(worker, worker.currentAssignmentId);
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
    worker.assignments.set(assignmentId, assignment);
    worker.currentAssignmentId = assignmentId;
    this.queue.push({ workerId, assignmentId, purpose: "continuation" });
    this.dispatch(worker, { type: "continued" });
    return { workerId, assignmentId, worker: this.snapshot(worker) };
  }

  async cancel(workerId: WorkerId): Promise<WorkerSnapshot> {
    const worker = this.requireWorker(workerId);
    if (worker.status === "running" && !worker.active)
      throw new Error(`Cannot cancel worker in ${worker.status} state`);
    void this.dispatch(worker, { type: "cancelRequested" });
    return this.snapshot(worker);
  }

  async release(workerId: WorkerId): Promise<WorkerSnapshot> {
    const worker = this.requireWorker(workerId);
    const verdict = permission(this.lifecycleState(worker), "release");
    if (verdict.kind === "noop") return this.snapshot(worker);
    if (verdict.kind === "refused") throw new Error(verdict.reason);
    await this.dispatch(worker, { type: "releaseRequested" });
    return this.snapshot(worker);
  }

  /**
   * Stop admission, settle active work, close retained sessions, and drain evidence writes.  /**
   * Stop admission, settle active work, close retained sessions, and drain evidence writes.
   * Cleanup-unknown workers keep their execution reservations and remain referenced.
   */
  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shuttingDown = true;
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
        if (!worker || !this.permits(worker, "cancel")) return Promise.resolve();
        return this.cancel(workerId);
      }),
    );
    await Promise.all(workerIds.map((workerId) => this.awaitShutdownSettlement(workerId)));
    await Promise.all(
      workerIds.map((workerId) => {
        const worker = this.workers.get(workerId);
        if (!worker || !this.permits(worker, "release")) return Promise.resolve();
        return this.release(workerId);
      }),
    );
    await Promise.allSettled([...this.pendingPersistence]);
  }

  private awaitShutdownSettlement(workerId: WorkerId): Promise<void> {
    const settled = () => isSettled(this.workers.get(workerId)?.status);
    if (settled()) return Promise.resolve();
    return new Promise((resolve) => {
      let unsubscribe = () => {};
      const check = () => {
        if (!settled()) return;
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
      ...historicalWorker,
      currentAssignmentId: snapshot.currentAssignmentId,
      ...(snapshot.pendingQuestion === undefined
        ? {}
        : { pendingQuestion: Object.freeze({ ...snapshot.pendingQuestion }) }),
      assignments,
      createdAt: snapshot.createdAt,
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
    while (this.reservedCount() < this.capacity && this.queue.length > 0) {
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
    const remaining = assignment.budget.maxTurns - assignment.turnsUsed;
    const token = randomUUID();
    const active: ActiveSegment = {
      token,
      assignmentId: assignment.id,
      purpose: job.purpose,
      observedTurns: assignment.turnsUsed,
    };
    worker.active = active;
    this.dispatch(worker, { type: "segmentStarted", purpose: job.purpose });

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
      active.questionText === undefined &&
      worker.pendingQuestion === undefined &&
      !this.shuttingDown &&
      !this.cleanupHealth.isBlocked();
    const callbacks: ChildDriverCallbacks = {
      onQuestion: (text) => {
        if (!isCurrent() || worker.status === "stopping" || worker.status === "cleanup-unknown")
          return;
        if (active.questionText !== undefined) {
          active.questionText = "";
          return;
        }
        active.questionText = text.trim();
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
        active.observedTurns = Math.max(active.observedTurns, turnsUsed);
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
        .with("start", () => this.driver.start(common, callbacks))
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
    assignment.turnsUsed = Math.max(assignment.turnsUsed, worker.active.observedTurns);
    const startup =
      error instanceof UnconfirmedChildStartupError
        ? "unconfirmed"
        : error instanceof ChildStartupFailedError && worker.active.purpose === "start"
          ? "failed"
          : "none";
    void this.dispatch(worker, { type: "segmentFailed", error: errorText(error), startup });
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
    assignment.turnsUsed = Math.max(result.turnsUsed, active.observedTurns);
    void this.dispatch(worker, {
      type: "segmentSettled",
      result,
      questionAsked: Boolean(active.questionText),
    });
  }

  private lifecycleState(worker: MutableWorker): LifecycleState {
    return {
      status: worker.status,
      outcome: this.requireAssignment(worker, worker.currentAssignmentId).outcome,
      liveSession: worker.liveSession,
      reserved: worker.reserved,
      sessionStarted: worker.sessionStarted,
      ...(worker.closeAttempt === undefined ? {} : { closeAttempt: worker.closeAttempt }),
    };
  }

  private permits(worker: MutableWorker, operation: Operation): boolean {
    return permission(this.lifecycleState(worker), operation).kind === "allowed";
  }

  private assertPermitted(worker: MutableWorker, operation: Operation): void {
    const verdict = permission(this.lifecycleState(worker), operation);
    if (verdict.kind === "refused") throw new Error(verdict.reason);
  }

  private reservedCount(): number {
    let count = 0;
    for (const worker of this.workers.values()) if (worker.reserved) count++;
    return count;
  }

  /** Applies one lifecycle transition; resolves once any child close it started has settled. */
  private dispatch(worker: MutableWorker, event: LifecycleEvent): Promise<void> {
    const assignment = this.requireAssignment(worker, worker.currentAssignmentId);
    const { state, effects } = transition(this.lifecycleState(worker), event);
    worker.status = state.status;
    assignment.outcome = state.outcome;
    worker.liveSession = state.liveSession;
    worker.reserved = state.reserved;
    worker.sessionStarted = state.sessionStarted;
    if (state.closeAttempt === undefined) delete worker.closeAttempt;
    else worker.closeAttempt = state.closeAttempt;
    const closing: Promise<void>[] = [];
    for (const effect of effects) {
      if (effect.kind === "close") closing.push(this.closeChild(worker, effect.attempt));
      else this.runEffect(worker, assignment, effect);
    }
    return Promise.all(closing).then(() => undefined);
  }

  private runEffect(
    worker: MutableWorker,
    assignment: MutableAssignment,
    effect: Exclude<LifecycleEffect, { kind: "close" }>,
  ): void {
    match(effect)
      .with({ kind: "dequeue" }, () => this.removeQueued(worker.id))
      .with({ kind: "invalidateBudget" }, () => assignment.budget.invalidate())
      .with({ kind: "invalidateAllBudgets" }, () => {
        for (const item of worker.assignments.values()) item.budget.invalidate();
      })
      .with({ kind: "clearQuestion" }, () => {
        delete worker.pendingQuestion;
      })
      .with({ kind: "raiseQuestion" }, () => {
        const text = worker.active?.questionText;
        if (!text) throw new Error("Cannot raise a question without its text");
        worker.pendingQuestion = Object.freeze({
          id: randomUUID(),
          workerId: worker.id,
          assignmentId: assignment.id,
          text,
        });
      })
      .with({ kind: "clearActive" }, () => {
        delete worker.active;
      })
      .with({ kind: "recordFinal" }, ({ result }) =>
        match(result)
          .with({ kind: "completed" }, ({ report }) => {
            assignment.report = report;
          })
          .with({ kind: "failed" }, ({ error, partialReport }) => {
            assignment.error = error;
            this.setPartialReport(assignment, partialReport);
          })
          .with({ kind: "budget-exhausted" }, ({ partialReport }) =>
            this.setPartialReport(assignment, partialReport),
          )
          .exhaustive(),
      )
      .with({ kind: "recordPartial" }, ({ result }) =>
        this.retainPartialOutcome(assignment, result),
      )
      .with({ kind: "recordPartialText" }, ({ text }) => {
        assignment.partialReport ??= text;
      })
      .with({ kind: "recordError" }, ({ text }) => {
        assignment.error = text;
      })
      .with({ kind: "markUncertain" }, ({ diagnostic }) =>
        this.cleanupHealth.markUncertain({
          parentSessionId: this.parentSessionId,
          workerId: worker.id,
          assignmentId: assignment.id,
          diagnostic,
        }),
      )
      .with({ kind: "emitState" }, () => this.emitState(worker))
      .with({ kind: "emitQuestion" }, () => {
        const question = worker.pendingQuestion;
        if (question) this.emit({ type: "question", question });
      })
      .with({ kind: "persist" }, () => this.persist(worker, assignment))
      .with({ kind: "pump" }, () => this.pump())
      .with({ kind: "abort" }, () => this.abortChild(worker))
      .exhaustive();
  }

  private abortChild(worker: MutableWorker): void {
    const uncertain = (error: unknown) => {
      void this.dispatch(worker, {
        type: "cleanupUncertain",
        diagnostic: `Abort request failed: ${errorText(error)}`,
      });
    };
    try {
      void this.driver.abort(worker.id).catch(uncertain);
    } catch (error) {
      uncertain(error);
    }
  }

  private async closeChild(worker: MutableWorker, attempt: number): Promise<void> {
    let result: { readonly confirmed: boolean; readonly diagnostic?: string };
    try {
      result = await this.driver.close(worker.id);
    } catch (error) {
      result = { confirmed: false, diagnostic: errorText(error) };
    }
    await this.dispatch(
      worker,
      result.confirmed
        ? { type: "closeConfirmed", attempt }
        : {
            type: "closeUnconfirmed",
            attempt,
            diagnostic: result.diagnostic ?? "Child session shutdown was not confirmed",
          },
    );
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
