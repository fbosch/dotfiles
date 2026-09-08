import { describe, expect, test } from "bun:test";
import type { CustomEntry, SessionEntry } from "@earendil-works/pi-coding-agent";
import {
  captureStartupBaseline,
  deferStartupMeasurement,
  readCurrentStartupMeasurement,
} from "../startup-time";

function entry(
  id: string,
  data: { reason: string; elapsedMs: number; timestamp: number },
): CustomEntry {
  return {
    type: "custom",
    id,
    parentId: null,
    timestamp: new Date(data.timestamp).toISOString(),
    customType: "startup-time",
    data,
  };
}

describe("startup-time adapter", () => {
  test("accepts only a newly appended measurement for the current dispatch", () => {
    const entries: SessionEntry[] = [
      entry("prior", { reason: "startup", elapsedMs: 80, timestamp: 1 }),
    ];
    const baseline = captureStartupBaseline(entries);
    entries.push(entry("current", { reason: "reload", elapsedMs: 42.5, timestamp: 2 }));

    expect(readCurrentStartupMeasurement(entries, baseline, "reload")).toEqual({
      reason: "reload",
      elapsedMs: 42.5,
      timestamp: 2,
    });
    expect(readCurrentStartupMeasurement(entries, baseline, "startup")).toBeUndefined();
    expect(readCurrentStartupMeasurement(entries.slice(0, 1), baseline, "startup")).toBeUndefined();
  });

  test("defers inspection so package handler order does not matter", () => {
    for (const packageRunsFirst of [true, false]) {
      const entries: SessionEntry[] = [];
      const baseline = captureStartupBaseline(entries);
      let callback = () => {};
      const published: number[] = [];
      if (packageRunsFirst) {
        entries.push(entry("current", { reason: "startup", elapsedMs: 21, timestamp: 1 }));
      }
      deferStartupMeasurement(
        () => entries,
        baseline,
        "startup",
        (measurement) => published.push(measurement.elapsedMs),
        (next) => {
          callback = next;
          return 1 as unknown as ReturnType<typeof setTimeout>;
        },
      );
      if (!packageRunsFirst) {
        entries.push(entry("current", { reason: "startup", elapsedMs: 21, timestamp: 1 }));
      }

      callback();
      expect(published).toEqual([21]);
    }
  });

  test("omits absent, invalid, stale, and unsupported measurements", () => {
    const prior = entry("prior", { reason: "startup", elapsedMs: 10, timestamp: 1 });
    expect(readCurrentStartupMeasurement([], undefined, "startup")).toBeUndefined();
    expect(readCurrentStartupMeasurement([prior], "prior", "startup")).toBeUndefined();
    expect(
      readCurrentStartupMeasurement(
        [prior, entry("invalid", { reason: "startup", elapsedMs: Number.NaN, timestamp: 2 })],
        "prior",
        "startup",
      ),
    ).toBeUndefined();
    expect(readCurrentStartupMeasurement([prior], "missing", "startup")).toBeUndefined();
    expect(readCurrentStartupMeasurement([prior], undefined, "resume")).toBeUndefined();
  });
});
