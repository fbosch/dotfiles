import { match } from "ts-pattern";
import { type ClassifierFailure, DEFAULT_CLASSIFIER_TIMEOUT_MS } from "../../lib/classifier";

export type BudgetMode = "fixed" | "advisory" | "automatic";
export type BudgetTaskKind =
  | "discovery"
  | "implementation"
  | "analysis"
  | "testing"
  | "benchmark"
  | "other";
export type BudgetToolOutcome = "success" | "failure" | "unknown";
export type BudgetFailureReason = ClassifierFailure["reason"] | "unsupported";
export interface BudgetUsage {
  readonly provider?: string;
  readonly providerAttempts: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cost?: number;
}
export interface BudgetProgress {
  readonly completedTools: number;
  readonly verifiedSuccesses: number;
  readonly failures: number;
  readonly unknownOutcomes: number;
  readonly consecutiveFailures: number;
}
export interface BudgetAdviceInput {
  readonly taskKind: BudgetTaskKind;
  readonly initialTurns: number;
  readonly grantedTurns: number;
  readonly hardMaxTurns: number;
  readonly turnsUsed: number;
  readonly automaticGrants: number;
  readonly progress: BudgetProgress;
}
export type BudgetAdvice =
  | { readonly kind: "judgment"; readonly probability: number; readonly usage?: BudgetUsage }
  | {
      readonly kind: "unavailable";
      readonly reason: BudgetFailureReason;
      readonly diagnostic?: boolean;
      readonly usage?: BudgetUsage;
    };
export type BudgetAdvisor = (
  input: BudgetAdviceInput,
  signal: AbortSignal,
) => Promise<BudgetAdvice>;
export interface BudgetDecision {
  readonly revision: number;
  readonly turnsUsed: number;
  readonly kind: "advised" | "granted" | "wrap-up" | "unavailable";
  readonly reason:
    | "productive"
    | "insufficient-confidence"
    | "insufficient-evidence"
    | "automatic-not-ready"
    | "advisory"
    | BudgetFailureReason;
  readonly proposedTurns: number;
  readonly grantedTurns: number;
  readonly probability?: number;
  readonly diagnostic?: boolean;
  readonly durationMs: number;
  readonly usage?: BudgetUsage;
}
export interface BudgetSnapshot {
  readonly version: 1;
  readonly initialTurns: number;
  readonly grantedTurns: number;
  readonly hardMaxTurns?: number;
  readonly mode: BudgetMode;
  readonly automaticGrants: number;
  readonly checks: number;
  readonly revision: number;
  readonly progress: BudgetProgress;
  readonly decisions: readonly BudgetDecision[];
}
export interface BudgetOptions {
  readonly hardMaxTurns?: number;
  readonly mode?: BudgetMode;
  readonly confidenceThreshold?: number;
  readonly advisor?: BudgetAdvisor;
  readonly taskKind?: BudgetTaskKind;
  readonly timeoutMs?: number;
}
export interface BudgetAdmission {
  readonly maxTurns: number;
  readonly decision?: BudgetDecision;
}

export const BUDGET_WRAP_UP_TURNS = 2;
export const BUDGET_INCREMENT = 4;
export const MAX_AUTOMATIC_GRANTS = 2;
export const MAX_BUDGET_CHECKS = 2;

function positiveTurns(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${label} must be a positive safe integer`);
  return value;
}

export function assignmentCeiling(
  initialTurns: number,
  specialistCeiling?: number,
  requestedCeiling?: number,
): number | undefined {
  positiveTurns(initialTurns, "maxTurns");
  if (specialistCeiling !== undefined) positiveTurns(specialistCeiling, "hard_max_turns");
  if (requestedCeiling !== undefined) {
    positiveTurns(requestedCeiling, "hardMaxTurns");
    if (specialistCeiling === undefined || requestedCeiling > specialistCeiling)
      throw new Error("hardMaxTurns must not raise the configured specialist ceiling");
  }
  const ceiling = requestedCeiling ?? specialistCeiling;
  if (ceiling !== undefined && initialTurns > ceiling)
    throw new Error("maxTurns exceeds the configured assignment ceiling");
  return ceiling;
}

export function budgetTaskKind(specialist: string): BudgetTaskKind {
  // Only closed categories cross the classifier boundary, never arbitrary specialist names.
  return match(specialist)
    .returnType<BudgetTaskKind>()
    .with("explore", "lookup", "quick", "patterns", () => "discovery")
    .with("general", "refactor", () => "implementation")
    .with("analyze", "review", "adversarial", "debug", "spec", () => "analysis")
    .with("test", "validate", () => "testing")
    .with("benchmark", () => "benchmark")
    .otherwise(() => "other");
}

export class AssignmentBudget {
  readonly initialTurns: number;
  readonly hardMaxTurns: number | undefined;
  readonly mode: BudgetMode;
  private granted: number;
  private revision = 0;
  private grants = 0;
  private checks = 0;
  private checkedRevision = -1;
  private readonly decisions: BudgetDecision[] = [];
  private progress: BudgetProgress = {
    completedTools: 0,
    verifiedSuccesses: 0,
    failures: 0,
    unknownOutcomes: 0,
    consecutiveFailures: 0,
  };
  private pending:
    | { revision: number; controller: AbortController; promise: Promise<BudgetAdmission> }
    | undefined;
  private restored = false;
  private restoredSnapshot: BudgetSnapshot | undefined;

  constructor(
    initialTurns: number,
    private readonly options: BudgetOptions = {},
  ) {
    this.options = Object.freeze({ ...options });
    this.initialTurns = positiveTurns(initialTurns, "maxTurns");
    this.granted = initialTurns;
    this.hardMaxTurns = assignmentCeiling(initialTurns, options.hardMaxTurns);
    const threshold = options.confidenceThreshold;
    if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 0 || threshold > 1))
      throw new Error("Budget confidence threshold must be between zero and one");
    if (
      options.timeoutMs !== undefined &&
      (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
    )
      throw new Error("Budget check timeout must be positive");
    this.mode = options.mode ?? "advisory";
  }

  static fromHistory(maxTurns: number, snapshot?: BudgetSnapshot): AssignmentBudget {
    const budget = new AssignmentBudget(maxTurns, { mode: "fixed" });
    // Saved evidence is never a reconstructed executable policy or a guessed initial allocation.
    budget.restored = true;
    budget.restoredSnapshot =
      snapshot === undefined
        ? undefined
        : Object.freeze({
            ...snapshot,
            progress: Object.freeze({ ...snapshot.progress }),
            decisions: Object.freeze(
              snapshot.decisions.map((decision) =>
                Object.freeze({
                  ...decision,
                  ...(decision.usage === undefined
                    ? {}
                    : { usage: Object.freeze({ ...decision.usage }) }),
                }),
              ),
            ),
          });
    return budget;
  }

  get maxTurns(): number {
    return this.granted;
  }

  snapshot(): BudgetSnapshot | undefined {
    if (this.restored) return this.restoredSnapshot;
    return Object.freeze({
      version: 1,
      initialTurns: this.initialTurns,
      grantedTurns: this.granted,
      ...(this.hardMaxTurns === undefined ? {} : { hardMaxTurns: this.hardMaxTurns }),
      mode: this.mode,
      automaticGrants: this.grants,
      checks: this.checks,
      revision: this.revision,
      progress: Object.freeze({ ...this.progress }),
      decisions: Object.freeze([...this.decisions]),
    });
  }

  observe(outcome: BudgetToolOutcome): void {
    if (this.restored) return;
    const consecutiveFailures = match(outcome)
      .with("failure", () => this.progress.consecutiveFailures + 1)
      .with("success", () => 0)
      .with("unknown", () => this.progress.consecutiveFailures)
      .exhaustive();
    this.progress = {
      completedTools: this.progress.completedTools + 1,
      verifiedSuccesses: this.progress.verifiedSuccesses + Number(outcome === "success"),
      failures: this.progress.failures + Number(outcome === "failure"),
      unknownOutcomes: this.progress.unknownOutcomes + Number(outcome === "unknown"),
      consecutiveFailures,
    };
  }

  extend(additionalTurns: number): void {
    if (this.restored) throw new Error("Historical budgets are read-only");
    positiveTurns(additionalTurns, "additionalTurns");
    const extended = this.granted + additionalTurns;
    if (!Number.isSafeInteger(extended))
      throw new Error("Extended budget exceeds the safe integer limit");
    if (this.hardMaxTurns !== undefined && extended > this.hardMaxTurns)
      throw new Error("Extended budget exceeds the configured ceiling");
    this.invalidate();
    this.granted = extended;
    this.revision++;
  }

  invalidate(): void {
    this.pending?.controller.abort();
  }

  beforeModel(nextTurn: number, isCurrent: () => boolean): Promise<BudgetAdmission> {
    if (this.pending?.revision === this.revision) return this.pending.promise;
    const remaining = this.granted - nextTurn + 1;
    if (
      this.restored ||
      this.mode === "fixed" ||
      !this.options.advisor ||
      this.hardMaxTurns === undefined ||
      this.granted >= this.hardMaxTurns ||
      this.grants >= MAX_AUTOMATIC_GRANTS ||
      this.checks >= MAX_BUDGET_CHECKS ||
      this.checkedRevision === this.revision ||
      this.progress.completedTools === 0 ||
      !Number.isSafeInteger(nextTurn) ||
      nextTurn < 2 ||
      remaining < 1 ||
      remaining > BUDGET_WRAP_UP_TURNS ||
      !isCurrent()
    ) {
      return Promise.resolve({ maxTurns: this.granted });
    }
    const revision = this.revision;
    this.checkedRevision = revision;
    this.checks++;
    const controller = new AbortController();
    const input: BudgetAdviceInput = Object.freeze({
      taskKind: this.options.taskKind ?? "other",
      initialTurns: this.initialTurns,
      grantedTurns: this.granted,
      hardMaxTurns: this.hardMaxTurns,
      // The request being admitted is not completed progress.
      turnsUsed: nextTurn - 1,
      automaticGrants: this.grants,
      progress: Object.freeze({ ...this.progress }),
    });
    const promise = this.assess(input, revision, controller, isCurrent);
    this.pending = { revision, controller, promise };
    return promise;
  }

  private async assess(
    input: BudgetAdviceInput,
    revision: number,
    controller: AbortController,
    isCurrent: () => boolean,
  ): Promise<BudgetAdmission> {
    const started = Date.now();
    let timedOut = false;
    const advice = await new Promise<BudgetAdvice>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (value: BudgetAdvice) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        controller.signal.removeEventListener("abort", onAbort);
        resolve(value);
      };
      const onAbort = () =>
        finish({
          kind: "unavailable",
          reason: timedOut ? "timeout" : "caller-cancellation",
        });
      controller.signal.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.options.timeoutMs ?? DEFAULT_CLASSIFIER_TIMEOUT_MS);
      Promise.resolve()
        .then(() => this.options.advisor?.(input, controller.signal))
        .then(
          (value) => finish(value ?? { kind: "unavailable", reason: "unsupported" }),
          () => finish({ kind: "unavailable", reason: "request-failure", diagnostic: true }),
        );
    });
    if (this.pending?.controller === controller) this.pending = undefined;
    if (
      this.restored ||
      revision !== this.revision ||
      !isCurrent() ||
      (controller.signal.aborted && !timedOut)
    )
      return { maxTurns: this.granted };

    const proposedTurns = Math.min(
      BUDGET_INCREMENT,
      (this.hardMaxTurns ?? this.granted) - this.granted,
    );
    const durationMs = Math.max(0, Date.now() - started);
    const base = {
      revision,
      turnsUsed: input.turnsUsed,
      proposedTurns,
      durationMs,
      ...(advice.usage === undefined ? {} : { usage: Object.freeze({ ...advice.usage }) }),
    };
    const decision = match(advice)
      .returnType<BudgetDecision>()
      .with({ kind: "unavailable" }, (value) => ({
        ...base,
        kind: "unavailable",
        reason: value.reason,
        grantedTurns: 0,
        ...(value.diagnostic ? { diagnostic: true } : {}),
      }))
      .with({ kind: "judgment" }, (value) => {
        if (!Number.isFinite(value.probability) || value.probability < 0 || value.probability > 1) {
          return {
            ...base,
            kind: "unavailable",
            reason: "invalid-response",
            grantedTurns: 0,
            diagnostic: true,
          };
        }
        const incomplete =
          this.mode === "automatic" && this.options.confidenceThreshold === undefined;
        const automaticReady = this.mode === "automatic" && !incomplete;
        const sufficientEvidence =
          this.progress.verifiedSuccesses > 0 && this.progress.consecutiveFailures < 2;
        const grant =
          automaticReady &&
          sufficientEvidence &&
          value.probability >= (this.options.confidenceThreshold ?? 1) &&
          proposedTurns > 0 &&
          this.grants < MAX_AUTOMATIC_GRANTS;
        if (grant) {
          this.granted += proposedTurns;
          this.grants++;
          this.revision++;
        }
        const { kind, reason } = match({ grant, incomplete, automaticReady, sufficientEvidence })
          .returnType<Pick<BudgetDecision, "kind" | "reason">>()
          .with({ grant: true }, () => ({ kind: "granted", reason: "productive" }))
          .with({ incomplete: true }, () => ({ kind: "advised", reason: "automatic-not-ready" }))
          .with({ automaticReady: false }, () => ({ kind: "advised", reason: "advisory" }))
          .with({ sufficientEvidence: false }, () => ({
            kind: "wrap-up",
            reason: "insufficient-evidence",
          }))
          .with({ sufficientEvidence: true }, () => ({
            kind: "wrap-up",
            reason: "insufficient-confidence",
          }))
          .exhaustive();
        return {
          ...base,
          probability: value.probability,
          kind,
          reason,
          grantedTurns: grant ? proposedTurns : 0,
          ...(incomplete ? { diagnostic: true } : {}),
        };
      })
      .exhaustive();
    const frozen = Object.freeze(decision);
    this.decisions.push(frozen);
    return { maxTurns: this.granted, decision: frozen };
  }
}
