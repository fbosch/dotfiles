export interface BenchmarkStatistics {
	averageMs: number;
	count: number;
	maximumMs: number;
	medianMs: number;
	minimumMs: number;
	p95Ms: number;
}

export function benchmarkStatistics(values: number[]): BenchmarkStatistics {
	if (values.length === 0) throw new Error("Benchmark samples are required");
	const sorted = [...values].sort((left, right) => left - right);
	return {
		averageMs: values.reduce((total, value) => total + value, 0) / values.length,
		count: values.length,
		maximumMs: sorted.at(-1)!,
		medianMs: percentile(sorted, 0.5),
		minimumMs: sorted[0],
		p95Ms: percentile(sorted, 0.95),
	};
}

function percentile(sorted: number[], fraction: number): number {
	return sorted[Math.ceil(sorted.length * fraction) - 1];
}
