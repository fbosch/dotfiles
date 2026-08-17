export interface BenchmarkStatistics {
	averageMs: number;
	count: number;
	maximumMs: number;
	medianMs: number;
	minimumMs: number;
	p95Ms: number;
}

export function benchmarkEnvironmentInteger(
	name: string,
	value: string | null | undefined,
	fallback: number,
	minimum: number,
	maximum: number,
): number {
	if (value === null || value === undefined) return fallback;
	const parsed = Number(value);
	if (Number.isSafeInteger(parsed) === false || parsed < minimum || parsed > maximum)
		throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
	return parsed;
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
