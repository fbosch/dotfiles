import { match } from "ts-pattern";
import { Type } from "typebox";
import type { BudgetDecision, BudgetSnapshot } from "./budget";

const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const positive = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const measured = Type.Number({ minimum: 0, maximum: Number.MAX_VALUE });
const failures = [
  "invalid-config",
  "disabled",
  "invalid-input",
  "model-unavailable",
  "auth-failure",
  "timeout",
  "caller-cancellation",
  "request-failure",
  "http-status",
  "invalid-response",
  "unsupported",
] as const;
const reasons = [
  ...failures,
  "productive",
  "insufficient-confidence",
  "insufficient-evidence",
  "automatic-not-ready",
  "advisory",
] as const satisfies readonly BudgetDecision["reason"][];
const usage = Type.Object({
  provider: Type.Optional(Type.String()),
  providerAttempts: count,
  inputTokens: Type.Optional(count),
  outputTokens: Type.Optional(count),
  cost: Type.Optional(measured),
});
export const budgetEvidenceSchema = Type.Object({
  version: Type.Literal(1),
  initialTurns: positive,
  grantedTurns: positive,
  hardMaxTurns: Type.Optional(positive),
  mode: Type.Union(
    (["fixed", "advisory", "automatic"] as const).map((value) => Type.Literal(value)),
  ),
  automaticGrants: Type.Integer({ minimum: 0, maximum: 2 }),
  checks: Type.Integer({ minimum: 0, maximum: 2 }),
  revision: count,
  progress: Type.Object({
    completedTools: count,
    verifiedSuccesses: count,
    failures: count,
    unknownOutcomes: count,
    consecutiveFailures: count,
  }),
  decisions: Type.Array(
    Type.Object({
      revision: count,
      turnsUsed: positive,
      kind: Type.Union(
        (["advised", "granted", "wrap-up", "unavailable"] as const).map((value) =>
          Type.Literal(value),
        ),
      ),
      reason: Type.Union(reasons.map((value) => Type.Literal(value))),
      proposedTurns: Type.Integer({ minimum: 0, maximum: 4 }),
      grantedTurns: Type.Integer({ minimum: 0, maximum: 4 }),
      probability: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      diagnostic: Type.Optional(Type.Boolean()),
      durationMs: measured,
      usage: Type.Optional(usage),
    }),
    { maxItems: 2 },
  ),
});

/** Validate evidence relationships only; restored records never become execution authority. */
export function validBudgetEvidence(
  budget: BudgetSnapshot,
  grantedTurns: number,
  specialistCeiling: number | undefined,
): boolean {
  if (
    budget.grantedTurns !== grantedTurns ||
    budget.initialTurns > grantedTurns ||
    budget.checks < budget.decisions.length ||
    budget.automaticGrants > budget.checks ||
    budget.revision < budget.automaticGrants ||
    (budget.hardMaxTurns !== undefined &&
      (grantedTurns > budget.hardMaxTurns ||
        specialistCeiling === undefined ||
        budget.hardMaxTurns > specialistCeiling)) ||
    (specialistCeiling !== undefined && budget.hardMaxTurns === undefined) ||
    (budget.mode !== "automatic" && budget.automaticGrants !== 0)
  )
    return false;
  const progress = budget.progress;
  if (
    progress.completedTools !==
      progress.verifiedSuccesses + progress.failures + progress.unknownOutcomes ||
    progress.consecutiveFailures > progress.failures
  )
    return false;
  let previousRevision = -1;
  let grants = 0;
  let extraTurns = 0;
  for (const decision of budget.decisions) {
    if (
      decision.revision <= previousRevision ||
      decision.revision > budget.revision ||
      decision.turnsUsed > grantedTurns ||
      decision.grantedTurns > decision.proposedTurns
    )
      return false;
    previousRevision = decision.revision;
    const valid = match(decision.kind)
      .with("granted", () => {
        grants++;
        extraTurns += decision.grantedTurns;
        return (
          budget.mode === "automatic" &&
          budget.hardMaxTurns !== undefined &&
          decision.reason === "productive" &&
          decision.grantedTurns > 0 &&
          decision.probability !== undefined
        );
      })
      .with(
        "advised",
        () =>
          decision.grantedTurns === 0 &&
          decision.probability !== undefined &&
          (decision.reason === "advisory" || decision.reason === "automatic-not-ready"),
      )
      .with(
        "wrap-up",
        () =>
          decision.grantedTurns === 0 &&
          decision.probability !== undefined &&
          (decision.reason === "insufficient-confidence" ||
            decision.reason === "insufficient-evidence"),
      )
      .with(
        "unavailable",
        () => decision.grantedTurns === 0 && failures.some((reason) => reason === decision.reason),
      )
      .exhaustive();
    if (!valid) return false;
  }
  const minimumAllowance = budget.initialTurns + extraTurns;
  return (
    grants === budget.automaticGrants &&
    Number.isSafeInteger(minimumAllowance) &&
    minimumAllowance <= grantedTurns
  );
}
