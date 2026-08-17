import { expect, test } from "bun:test";
import { benchmarkStatistics } from "../ai-pointer-stats";

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
