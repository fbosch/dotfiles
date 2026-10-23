import { match } from "ts-pattern";
import { type BudgetSnapshot, MAX_AUTOMATIC_GRANTS, MAX_BUDGET_CHECKS } from "./budget";

export function budgetMetadata(
  budget: BudgetSnapshot | undefined,
  grantedTurns: number,
): Array<readonly [string, string]> {
  const rows: Array<readonly [string, string]> = [
    ["Budget", budget?.mode ?? "Unavailable"],
    ["Initial", budget === undefined ? "—" : String(budget.initialTurns)],
    ["Granted", String(grantedTurns)],
    ["Ceiling", budget?.hardMaxTurns === undefined ? "—" : String(budget.hardMaxTurns)],
    [
      "Grants",
      budget === undefined ? "—" : `${budget.automaticGrants} / ${MAX_AUTOMATIC_GRANTS} automatic`,
    ],
    ["Checks", budget === undefined ? "—" : `${budget.checks} / ${MAX_BUDGET_CHECKS}`],
  ];
  for (const decision of budget?.decisions ?? []) {
    const label = match(decision.kind)
      .with("granted", () => `Applied +${decision.grantedTurns}`)
      .with("advised", () => `Advisory · candidate +${decision.proposedTurns} · no grant`)
      .with("wrap-up", () => "No grant · wrap-up")
      .with("unavailable", () => "Unavailable · no grant")
      .exhaustive();
    rows.push(
      ["Decision", `${label} · revision ${decision.revision}`],
      ["Reason", decision.reason.replaceAll("-", " ")],
      [
        "Score",
        decision.probability === undefined ? "—" : `${(decision.probability * 100).toFixed(1)}%`,
      ],
      ["Advisor", decision.usage?.provider ?? "—"],
      ["Attempts", decision.usage === undefined ? "—" : String(decision.usage.providerAttempts)],
      ["Check ms", String(decision.durationMs)],
      [
        "Cls tokens",
        `${decision.usage?.inputTokens ?? "—"} input · ${decision.usage?.outputTokens ?? "—"} output`,
      ],
      ["Cls cost", decision.usage?.cost === undefined ? "—" : String(decision.usage.cost)],
    );
  }
  return rows;
}
