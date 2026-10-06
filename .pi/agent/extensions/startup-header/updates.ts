import type { EventBus } from "@earendil-works/pi-coding-agent";
import { compareSemver, isSemver } from "../extension-releases/release-check";
import { installStartupOwnerPublisher, type StartupOwnerPublisher } from "./publisher";

export interface UpdateDetail {
  readonly name: string;
  readonly current: string;
  readonly latest: string;
}

export interface UpdateCoverageMetadata {
  readonly updates?: readonly UpdateDetail[];
  readonly observedAt?: number;
  readonly staleAt?: number;
  readonly expiresAt?: number;
  readonly gitNotChecked?: number;
  readonly unsupported?: number;
  readonly failed?: number;
}

export type UpdateCoverage =
  | ({
      readonly coverage: "complete" | "partial";
      readonly available: number;
    } & UpdateCoverageMetadata)
  | ({ readonly coverage: "offline" | "failed" } & UpdateCoverageMetadata);

export function readUpdateCoverage(value: unknown): UpdateCoverage | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const metadata = readCoverageMetadata(record);
  if (metadata === undefined) return undefined;
  if (record.coverage === "offline" || record.coverage === "failed") {
    return Object.freeze({ coverage: record.coverage, ...metadata });
  }
  if (
    (record.coverage !== "complete" && record.coverage !== "partial") ||
    typeof record.available !== "number" ||
    !Number.isSafeInteger(record.available) ||
    record.available < 0
  ) {
    return undefined;
  }
  return Object.freeze({ coverage: record.coverage, available: record.available, ...metadata });
}

function readCoverageMetadata(record: Record<string, unknown>): UpdateCoverageMetadata | undefined {
  const metadata: {
    observedAt?: number;
    staleAt?: number;
    expiresAt?: number;
    gitNotChecked?: number;
    unsupported?: number;
    failed?: number;
    updates?: readonly UpdateDetail[];
  } = {};
  for (const key of ["observedAt", "staleAt", "expiresAt"] as const) {
    const value = record[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
    metadata[key] = value;
  }
  for (const key of ["gitNotChecked", "unsupported", "failed"] as const) {
    const value = record[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return undefined;
    metadata[key] = value;
  }
  if (record.updates !== undefined) {
    if (!Array.isArray(record.updates) || record.updates.length > 100) return undefined;
    const updates = [];
    for (const entry of record.updates) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return undefined;
      const item = entry as Record<string, unknown>;
      if (
        typeof item.name !== "string" ||
        !/^[a-zA-Z0-9@._/-]{1,214}$/.test(item.name) ||
        typeof item.current !== "string" ||
        !isSemver(item.current) ||
        typeof item.latest !== "string" ||
        !isSemver(item.latest) ||
        compareSemver(item.latest, item.current) <= 0
      )
        return undefined;
      updates.push(Object.freeze({ name: item.name, current: item.current, latest: item.latest }));
    }
    metadata.updates = Object.freeze(updates);
  }
  return metadata;
}

export function installUpdateStartupPublisher(
  events: EventBus,
  getCoverage: () => UpdateCoverage | undefined,
): StartupOwnerPublisher<UpdateCoverage> {
  const status = () => {
    const value = getCoverage();
    const coverage = value === undefined ? undefined : readUpdateCoverage(value);
    return coverage === undefined ? { state: "unavailable" as const } : statusForCoverage(coverage);
  };
  const publisher = installStartupOwnerPublisher(events, "updates", status);
  return {
    publish(value) {
      const parsed = readUpdateCoverage(value.payload);
      if (parsed === undefined) return false;
      return publisher.publish(statusForCoverage(parsed, value));
    },
    dispose: () => publisher.dispose(),
  };
}

function statusForCoverage(
  coverage: UpdateCoverage,
  freshness: {
    readonly observedAt?: number;
    readonly staleAt?: number;
    readonly expiresAt?: number;
  } = {},
) {
  const observedAt = freshness.observedAt ?? coverage.observedAt;
  const staleAt = freshness.staleAt ?? coverage.staleAt;
  const expiresAt = freshness.expiresAt ?? coverage.expiresAt;
  return {
    state: coverage.coverage === "complete" ? ("ready" as const) : ("degraded" as const),
    ...(observedAt === undefined ? {} : { observedAt }),
    ...(staleAt === undefined ? {} : { staleAt }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    payload: coverage,
  };
}
