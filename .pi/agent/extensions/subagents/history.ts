import { statSync } from "node:fs";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { budgetEvidenceSchema, validBudgetEvidence } from "./budget-history";
import type { ChildObservation } from "./driver";
import type { PersistedEvidence, WorkerPersistence, WorkerSnapshot } from "./owner";

export const HISTORY_ENTRY = "minimal-subagents.worker.v1";
const strings = Type.Array(Type.String());
const positive = Type.Integer({ minimum: 1 });
const nonnegative = Type.Integer({ minimum: 0 });
const outcome = Type.Union(
  (
    [
      "queued",
      "running",
      "waiting-question",
      "stopping",
      "completed",
      "failed",
      "budget-exhausted",
      "cancelled",
      "cleanup-unknown",
    ] as const
  ).map((value) => Type.Literal(value)),
);
const workerSchema = Type.Object({
  parentSessionId: Type.String(),
  id: Type.String(),
  specialist: Type.String(),
  currentAssignmentId: Type.String(),
  createdAt: Type.Number(),
  status: Type.Union(
    (
      [
        "queued",
        "running",
        "waiting-question",
        "stopping",
        "idle",
        "cancelled",
        "cleanup-unknown",
        "releasing",
        "released",
        "historical",
      ] as const
    ).map((value) => Type.Literal(value)),
  ),
  liveSession: Type.Union(
    (["available", "released", "historical", "none"] as const).map((value) => Type.Literal(value)),
  ),
  config: Type.Object({
    name: Type.String(),
    description: Type.String(),
    prompt: Type.String(),
    model: Type.String(),
    maxTurns: positive,
    hardMaxTurns: Type.Optional(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
    thinking: Type.Optional(
      Type.Union(
        (["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const).map((value) =>
          Type.Literal(value),
        ),
      ),
    ),
    tools: strings,
    excludeTools: strings,
    extensions: strings,
    mcpServers: Type.Optional(strings),
    skills: Type.Array(Type.Object({ name: Type.String(), path: Type.String() })),
  }),
  pendingQuestion: Type.Optional(
    Type.Object({
      id: Type.String(),
      workerId: Type.String(),
      assignmentId: Type.String(),
      text: Type.String(),
    }),
  ),
  assignments: Type.Array(
    Type.Object({
      id: Type.String(),
      prompt: Type.String(),
      outcome,
      maxTurns: positive,
      turnsUsed: nonnegative,
      remainingTurns: nonnegative,
      budget: Type.Optional(budgetEvidenceSchema),
      report: Type.Optional(Type.String()),
      partialReport: Type.Optional(Type.String()),
      error: Type.Optional(Type.String()),
      persistence: Type.Union(
        (["not-attempted", "pending", "saved", "failed"] as const).map((value) =>
          Type.Literal(value),
        ),
      ),
      persistenceError: Type.Optional(Type.String()),
      transcript: Type.Array(
        Type.Object({
          role: Type.Union(
            (["system", "user", "assistant", "tool"] as const).map((value) => Type.Literal(value)),
          ),
          text: Type.String(),
          timestamp: Type.Number(),
        }),
      ),
    }),
  ),
});
const observationSchema = Type.Object({
  startedAt: Type.Number(),
  endedAt: Type.Optional(Type.Number()),
  activity: Type.String(),
  liveText: Type.String(),
  inputTokens: Type.Optional(Type.Number()),
  outputTokens: Type.Optional(Type.Number()),
  cost: Type.Optional(Type.Number()),
  resolvedModel: Type.Optional(Type.String()),
  resolvedThinking: Type.Optional(
    Type.Union(
      (["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const).map((value) =>
        Type.Literal(value),
      ),
    ),
  ),
});
const savedSchema = Type.Object({
  version: Type.Literal(1),
  worker: workerSchema,
  observation: Type.Optional(observationSchema),
});

export interface SavedWorker {
  version: 1;
  worker: WorkerSnapshot;
  observation?: ChildObservation;
}

export function restoreHistory(
  entries: readonly unknown[],
  parentSessionId: string,
): SavedWorker[] {
  const latest = new Map<string, SavedWorker>();
  for (const entry of entries) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("type" in entry) ||
      entry.type !== "custom" ||
      !("customType" in entry) ||
      entry.customType !== HISTORY_ENTRY
    )
      continue;
    if (!("data" in entry) || !Value.Check(savedSchema, entry.data))
      throw new Error("Invalid saved subagent history");
    const data = entry.data;
    // Forks copy session entries, but ownership remains with the originating parent.
    if (data.worker.parentSessionId !== parentSessionId) continue;
    if (
      !data.worker.assignments.some(
        (assignment) => assignment.id === data.worker.currentAssignmentId,
      )
    )
      throw new Error("Saved subagent history has no current assignment");
    for (const assignment of data.worker.assignments) {
      if (
        assignment.budget !== undefined &&
        !validBudgetEvidence(
          assignment.budget,
          assignment.maxTurns,
          data.worker.config.hardMaxTurns,
        )
      ) {
        throw new Error("Invalid saved subagent budget evidence");
      }
    }
    latest.set(data.worker.id, data);
  }
  return [...latest.values()];
}

function historyFileSize(file: string): number | undefined {
  try {
    const info = statSync(file, { throwIfNoEntry: false });
    if (info === undefined) return 0;
    return info.isFile() ? info.size : undefined;
  } catch {
    return undefined;
  }
}

/** Embedded custom entries inherit parent deletion and never enter model context. */
export function parentHistory(options: {
  parentSessionId: string;
  currentParentId: () => string;
  parentFile: () => string | undefined;
  append: (customType: string, data: SavedWorker) => void;
  observation: (workerId: string) => ChildObservation | undefined;
}): WorkerPersistence {
  return {
    async save(evidence: PersistedEvidence) {
      if (
        options.currentParentId() !== options.parentSessionId ||
        evidence.parentSessionId !== options.parentSessionId
      ) {
        throw new Error("Parent changed before subagent evidence could be saved");
      }
      const file = options.parentFile();
      if (!file) throw new Error("Parent session evidence is not persisted");
      const observation = options.observation(evidence.workerId);
      const workerWithPersistence = (
        persistence: "pending" | "saved" | "failed",
        persistenceError?: string,
      ): WorkerSnapshot => ({
        ...evidence.worker,
        assignments: evidence.worker.assignments.map((assignment) =>
          assignment.id === evidence.assignment.id
            ? { ...assignment, persistence, ...(persistenceError ? { persistenceError } : {}) }
            : assignment,
        ),
      });
      const appendStatus = (
        persistence: "pending" | "saved" | "failed",
        persistenceError?: string,
      ) => {
        // SDK custom appends may only buffer; unknown file state cannot acknowledge a write.
        const before = historyFileSize(file);
        options.append(HISTORY_ENTRY, {
          version: 1,
          worker: workerWithPersistence(persistence, persistenceError),
          ...(observation ? { observation } : {}),
        });
        const after = historyFileSize(file);
        if (before === undefined || after === undefined || after <= before) {
          throw new Error("Parent session evidence is not persisted");
        }
      };

      // SessionManager retains failed appends in memory, so only append "saved" after the pending write is confirmed.
      try {
        appendStatus("pending");
        appendStatus("saved");
      } catch (error) {
        try {
          appendStatus("failed", error instanceof Error ? error.message : String(error));
        } catch {
          // Keep the original persistence error; a failed marker is best effort.
        }
        throw error;
      }
    },
  };
}
