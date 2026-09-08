import { describe, expect, test } from "bun:test";
import {
  createLossyNumberBenchmarkFixtures,
  createToonBenchmarkFixtures,
  runToonBenchmarks,
} from "../toon-heuristic";

describe("TOON heuristic benchmark", () => {
  test("reports warmups, repetitions, percentiles, and reference decisions", () => {
    const fixture = createToonBenchmarkFixtures().find((item) => item.name === "uniform-5");
    if (fixture === undefined) throw new Error("uniform-5 fixture is missing");

    const report = runToonBenchmarks([fixture], {
      warmups: 2,
      repetitions: 5,
      tokenCounter: (text) => text.length,
    });

    expect(report.warmups).toBe(2);
    expect(report.repetitions).toBe(5);
    expect(report.measurements.map((measurement) => measurement.path)).toEqual([
      "baseline",
      "heuristic",
      "reference",
    ]);
    for (const measurement of report.measurements) {
      expect(measurement.p50Microseconds).toBeGreaterThan(0);
      expect(measurement.p95Microseconds).toBeGreaterThanOrEqual(measurement.p50Microseconds);
      expect(measurement.p99Microseconds).toBeGreaterThanOrEqual(measurement.p95Microseconds);
    }
    expect(report.decisionMismatches).toEqual([
      { fixture: "uniform-5", falsePositive: false, falseNegative: false },
    ]);
  });

  test("compares eager and deferred lossy-number scans", () => {
    expect(createLossyNumberBenchmarkFixtures().map((fixture) => fixture.name)).toEqual([
      "structural-reject-safe",
      "structural-reject-lossy",
      "candidate-safe",
      "candidate-lossy",
    ]);

    const report = runToonBenchmarks([], { warmups: 1, repetitions: 3 });
    expect(
      report.lossyNumberMeasurements.map(({ fixture, path, outcome }) => ({
        fixture,
        path,
        outcome,
      })),
    ).toEqual([
      { fixture: "structural-reject-safe", path: "eager-scan", outcome: "structural-reject" },
      { fixture: "structural-reject-safe", path: "deferred-scan", outcome: "structural-reject" },
      { fixture: "structural-reject-lossy", path: "eager-scan", outcome: "lossy-reject" },
      { fixture: "structural-reject-lossy", path: "deferred-scan", outcome: "structural-reject" },
      { fixture: "candidate-safe", path: "eager-scan", outcome: "candidate" },
      { fixture: "candidate-safe", path: "deferred-scan", outcome: "candidate" },
      { fixture: "candidate-lossy", path: "eager-scan", outcome: "lossy-reject" },
      { fixture: "candidate-lossy", path: "deferred-scan", outcome: "lossy-reject" },
    ]);
  });

  test("shows the heuristic skipping a singleton Hyprprop-shaped object", () => {
    const fixture = createToonBenchmarkFixtures().find(
      (item) => item.name === "hyprprop-singleton",
    );
    if (fixture === undefined) throw new Error("hyprprop-singleton fixture is missing");

    const report = runToonBenchmarks([fixture], { warmups: 1, repetitions: 3 });
    const heuristic = report.measurements.find((measurement) => measurement.path === "heuristic");

    expect(heuristic?.converted).toBe(false);
  });
});
