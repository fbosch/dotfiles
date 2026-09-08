import type {
  StartupContextEstimate,
  StartupResourceCounts,
  StartupRuntimeSnapshot,
  StartupSnapshotAPI,
  StartupSnapshotValue,
} from "./runtime-types";

const CONTEXT_CATEGORIES = new Set([
  "system-prompt",
  "system-tools",
  "custom-tools",
  "mcp-tools",
  "context-files",
  "skills",
  "compacted-data",
]);

export function readStartupSnapshotAPI(value: unknown): StartupSnapshotAPI | undefined {
  if (!isRecord(value)) return undefined;
  if (value.capability !== "pi.startupSnapshot" || value.schemaVersion !== 1) return undefined;
  if (typeof value.get !== "function" || typeof value.subscribe !== "function") return undefined;
  return value as unknown as StartupSnapshotAPI;
}

export function readStartupRuntimeSnapshot(value: unknown): StartupRuntimeSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  if (!isNonEmptyString(value.sessionId) || !isNonEmptyString(value.generationId)) return undefined;
  if (value.ownerId !== "pi-runtime" || !isNonNegativeInteger(value.ownerRevision))
    return undefined;

  const resources =
    readSnapshotValue(value.resources, readResourceCounts) ?? ({ status: "unavailable" } as const);
  const context =
    readSnapshotValue(value.context, readContextEstimate) ?? ({ status: "unavailable" } as const);

  return Object.freeze({
    sessionId: value.sessionId,
    generationId: value.generationId,
    ownerId: "pi-runtime",
    ownerRevision: value.ownerRevision,
    resources,
    context,
  });
}

function readResourceCounts(value: unknown): StartupResourceCounts | undefined {
  if (!isRecord(value) || !isRecord(value.extensions) || !isRecord(value.skills)) {
    return undefined;
  }

  const { enabled, project, loadFailed } = value.extensions;
  const { available, project: projectSkills } = value.skills;
  if (
    !isNonNegativeInteger(enabled) ||
    !isNonNegativeInteger(project) ||
    !isNonNegativeInteger(loadFailed) ||
    !isNonNegativeInteger(available) ||
    !isNonNegativeInteger(projectSkills) ||
    project > enabled ||
    loadFailed > enabled ||
    projectSkills > available
  ) {
    return undefined;
  }

  return deepFreeze({
    extensions: { enabled, project, loadFailed },
    skills: { available, project: projectSkills },
  });
}

export function readContextEstimate(value: unknown): StartupContextEstimate | undefined {
  if (!isRecord(value) || !Array.isArray(value.categories)) return undefined;
  const { contextWindowTokens, autoCompactReserveTokens, estimatedTokens } = value;
  if (
    !isPositiveInteger(contextWindowTokens) ||
    !isNonNegativeInteger(autoCompactReserveTokens) ||
    autoCompactReserveTokens > contextWindowTokens ||
    !isNonNegativeInteger(estimatedTokens)
  ) {
    return undefined;
  }

  const seen = new Set<string>();
  const categories: StartupContextEstimate["categories"][number][] = [];
  let categoryTotal = 0;
  for (const category of value.categories) {
    if (!isRecord(category) || typeof category.id !== "string") return undefined;
    if (!CONTEXT_CATEGORIES.has(category.id) || seen.has(category.id)) return undefined;
    if (!isPositiveInteger(category.tokens)) return undefined;
    seen.add(category.id);
    categoryTotal += category.tokens;
    categories.push({
      id: category.id as StartupContextEstimate["categories"][number]["id"],
      tokens: category.tokens,
    });
  }
  if (categoryTotal !== estimatedTokens) return undefined;

  return deepFreeze({
    contextWindowTokens,
    autoCompactReserveTokens,
    estimatedTokens,
    categories,
  });
}

function readSnapshotValue<T>(
  value: unknown,
  readReadyValue: (candidate: unknown) => T | undefined,
): StartupSnapshotValue<T> | undefined {
  if (!isRecord(value)) return undefined;
  if (value.status === "collecting" || value.status === "unavailable") {
    return Object.freeze({ status: value.status });
  }
  if (value.status !== "ready") return undefined;
  const readyValue = readReadyValue(value.value);
  return readyValue === undefined
    ? undefined
    : Object.freeze({ status: "ready", value: readyValue });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
