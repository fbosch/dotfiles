import type { CustomEntry, SessionEntry, SessionStartEvent } from "@earendil-works/pi-coding-agent";

const STARTUP_TIME_ENTRY = "startup-time";

export interface StartupMeasurement {
  readonly reason: "startup" | "reload";
  readonly elapsedMs: number;
  readonly timestamp: number;
}

export function captureStartupBaseline(entries: readonly SessionEntry[]): string | undefined {
  return findStartupEntries(entries).at(-1)?.id;
}

export function readCurrentStartupMeasurement(
  entries: readonly SessionEntry[],
  baselineEntryId: string | undefined,
  reason: SessionStartEvent["reason"],
): StartupMeasurement | undefined {
  if (reason !== "startup" && reason !== "reload") return undefined;

  const startupEntries = findStartupEntries(entries);
  const baselineIndex =
    baselineEntryId === undefined
      ? -1
      : startupEntries.findIndex((entry) => entry.id === baselineEntryId);
  if (baselineEntryId !== undefined && baselineIndex === -1) return undefined;

  for (let index = startupEntries.length - 1; index > baselineIndex; index--) {
    const data = startupEntries[index]?.data;
    if (!isRecord(data) || data.reason !== reason) continue;
    if (!isFiniteNonNegative(data.elapsedMs) || !isFiniteNonNegative(data.timestamp)) continue;
    return Object.freeze({ reason, elapsedMs: data.elapsedMs, timestamp: data.timestamp });
  }
  return undefined;
}

export function deferStartupMeasurement(
  readEntries: () => readonly SessionEntry[],
  baselineEntryId: string | undefined,
  reason: SessionStartEvent["reason"],
  publish: (measurement: StartupMeasurement) => void,
  schedule: (callback: () => void) => ReturnType<typeof setTimeout> = (callback) =>
    setTimeout(callback, 0),
  cancel: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout,
): () => void {
  const timer = schedule(() => {
    const measurement = readCurrentStartupMeasurement(readEntries(), baselineEntryId, reason);
    if (measurement !== undefined) publish(measurement);
  });
  return () => cancel(timer);
}

function findStartupEntries(entries: readonly SessionEntry[]): CustomEntry[] {
  return entries.filter(
    (entry): entry is CustomEntry =>
      entry.type === "custom" && entry.customType === STARTUP_TIME_ENTRY,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
