import type { EventBus } from "@earendil-works/pi-coding-agent";
import { installStartupOwnerPublisher, type StartupOwnerPublisher } from "./publisher";

export type UpdateCoverage =
  | { readonly coverage: "complete" | "partial"; readonly available: number }
  | { readonly coverage: "offline" | "failed" };

export function readUpdateCoverage(value: unknown): UpdateCoverage | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.coverage === "offline" || record.coverage === "failed") {
    return Object.freeze({ coverage: record.coverage });
  }
  if (
    (record.coverage !== "complete" && record.coverage !== "partial") ||
    typeof record.available !== "number" ||
    !Number.isSafeInteger(record.available) ||
    record.available < 0
  ) {
    return undefined;
  }
  return Object.freeze({ coverage: record.coverage, available: record.available });
}

export function installUpdateStartupPublisher(
  events: EventBus,
  getCoverage: () => UpdateCoverage,
): StartupOwnerPublisher<UpdateCoverage> {
  const status = () => {
    const coverage = readUpdateCoverage(getCoverage());
    if (coverage === undefined) return { state: "unavailable" as const };
    return {
      state: coverage.coverage === "complete" ? ("ready" as const) : ("degraded" as const),
      payload: coverage,
    };
  };
  const publisher = installStartupOwnerPublisher(events, "updates", status);
  return {
    publish(coverage) {
      const parsed = readUpdateCoverage(coverage.payload);
      if (parsed === undefined) return false;
      return publisher.publish({
        state: parsed.coverage === "complete" ? "ready" : "degraded",
        payload: parsed,
      });
    },
    dispose: () => publisher.dispose(),
  };
}
