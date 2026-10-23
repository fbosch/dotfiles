import { Type } from "typebox";
import { Value } from "typebox/value";
import type { BudgetToolOutcome } from "./budget";

const hashlineKinds = new Map([
  ["read", "read"],
  ["grep", "grep"],
  ["replace", "edit"],
  ["replace_match", "edit"],
  ["insert", "edit"],
  ["copy", "edit"],
  ["move", "edit"],
  ["undo_last_change", "edit"],
]);
const structuredOutcome = Type.Object({
  structuredContent: Type.Object({
    kind: Type.Union(
      (["read", "grep", "edit", "error"] as const).map((value) => Type.Literal(value)),
    ),
    ok: Type.Boolean(),
  }),
});
const processOutcome = Type.Object({
  structuredContent: Type.Object({ exit_code: Type.Integer() }),
});

/** Read only wrapper-owned outcome fields, never model-authored text or printed JSON. */
export function budgetToolOutcome(
  toolName: string,
  result: unknown,
  isError: boolean,
): BudgetToolOutcome {
  if (isError) return "failure";
  if (hashlineKinds.has(toolName) && Value.Check(structuredOutcome, result)) {
    const outcome = result.structuredContent;
    if (!outcome.ok || outcome.kind === "error") return "failure";
    return outcome.kind === hashlineKinds.get(toolName) ? "success" : "unknown";
  }
  if (toolName === "bash" && Value.Check(processOutcome, result)) {
    return result.structuredContent.exit_code === 0 ? "success" : "failure";
  }
  // shortcut: wrappers without a versioned outcome envelope stay unknown; add only reviewed schemas.
  return "unknown";
}
