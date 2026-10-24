import type { CleanupUncertainty, ProcessCleanupHealth } from "./owner";

const KEY = Symbol.for("fbb.minimal-subagents.cleanup-health.v1");
interface HealthScope {
  [KEY]?: unknown;
}
declare global {
  namespace NodeJS {
    interface Process extends HealthScope {}
  }
}
interface Cell {
  blocked: boolean;
  diagnostics: CleanupUncertainty[];
  retained: Map<string, readonly unknown[]>;
}

function isCell(value: unknown): value is Cell {
  return (
    typeof value === "object" &&
    value !== null &&
    "blocked" in value &&
    typeof value.blocked === "boolean" &&
    "diagnostics" in value &&
    Array.isArray(value.diagnostics) &&
    "retained" in value &&
    value.retained instanceof Map
  );
}

/** The process owns uncertain resources; extension reload and parent replacement cannot reset health. */
export function processCleanupHealth(scope: HealthScope = process): ProcessCleanupHealth & {
  retain(workerId: string, resources: readonly unknown[]): void;
  diagnostics(): readonly CleanupUncertainty[];
} {
  let existing: unknown = scope[KEY];
  if (existing === undefined) {
    existing = { blocked: false, diagnostics: [], retained: new Map() };
    scope[KEY] = existing;
  }
  if (!isCell(existing))
    throw new Error("Invalid process cleanup state; restart Pi before delegation");
  const cell = existing;
  return {
    isBlocked: () => cell.blocked,
    markUncertain(diagnostic) {
      cell.blocked = true;
      cell.diagnostics.push(Object.freeze({ ...diagnostic }));
    },
    retain(workerId, resources) {
      cell.blocked = true;
      cell.retained.set(workerId, resources);
    },
    diagnostics: () => cell.diagnostics.map((diagnostic) => ({ ...diagnostic })),
  };
}
