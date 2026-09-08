export type NeovimStartupPayload =
  | { readonly problem: "channel-problem" }
  | { readonly problem: "workspace-mismatch" };

export type DirenvStartupPayload =
  | { readonly problem: "blocked" }
  | { readonly problem: "load-failed" }
  | { readonly problem: "missing" };

export type LspStartupPayload =
  | { readonly observedDocuments: number }
  | { readonly problem: "server-problem" }
  | { readonly problem: "workspace-mismatch" };

export function readNeovimStartupPayload(value: unknown): NeovimStartupPayload | undefined {
  return readProblem(value, ["channel-problem", "workspace-mismatch"] as const);
}

export function readDirenvStartupPayload(value: unknown): DirenvStartupPayload | undefined {
  return readProblem(value, ["blocked", "load-failed", "missing"] as const);
}

export function readLspStartupPayload(value: unknown): LspStartupPayload | undefined {
  const problem = readProblem(value, ["server-problem", "workspace-mismatch"] as const);
  if (problem !== undefined) return problem;
  if (!isRecord(value) || !isCount(value.observedDocuments)) return undefined;
  return Object.freeze({ observedDocuments: value.observedDocuments });
}

function readProblem<T extends string>(
  value: unknown,
  allowed: readonly T[],
): { readonly problem: T } | undefined {
  if (
    !isRecord(value) ||
    typeof value.problem !== "string" ||
    !allowed.includes(value.problem as T)
  ) {
    return undefined;
  }
  return Object.freeze({ problem: value.problem as T });
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 64;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
