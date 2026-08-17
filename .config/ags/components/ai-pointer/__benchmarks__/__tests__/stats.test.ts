import { expect, test } from "bun:test";
import { benchmarkEnvironmentInteger, benchmarkStatistics } from "../stats";

test("summarizes benchmark samples with nearest-rank percentiles", () => {
	expect(benchmarkStatistics([5, 1, 3, 2, 4])).toEqual({
		averageMs: 3,
		count: 5,
		maximumMs: 5,
		medianMs: 3,
		minimumMs: 1,
		p95Ms: 5,
	});
});

test("requires at least one benchmark sample", () => {
	expect(() => benchmarkStatistics([])).toThrow("Benchmark samples are required");
});

test("parses bounded benchmark environment integers", () => {
	expect(benchmarkEnvironmentInteger("COUNT", undefined, 10, 1, 20)).toBe(10);
	expect(benchmarkEnvironmentInteger("COUNT", "15", 10, 1, 20)).toBe(15);
	expect(() => benchmarkEnvironmentInteger("COUNT", "21", 10, 1, 20)).toThrow(
		"COUNT must be an integer from 1 to 20",
	);
});
