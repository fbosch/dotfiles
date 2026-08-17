import { aiPointerPerformanceMetrics } from "../performance-metrics";

const metricNames = new Set<string>(Object.values(aiPointerPerformanceMetrics));

export interface LivePerformanceRecord {
	component: "ai-pointer";
	duration_ms: number;
	name: string;
	ok: boolean;
	rss_after_kb: number;
	rss_before_kb: number;
	start_ms: number;
}

export function normalizeLivePerformanceRecord(value: unknown): LivePerformanceRecord | null {
	if (!isRecord(value) || value.component !== "ai-pointer") return null;
	if (typeof value.name !== "string" || metricNames.has(value.name) === false) return null;
	if (
		isFiniteNonNegativeNumber(value.start_ms) === false ||
		isFiniteNonNegativeNumber(value.duration_ms) === false ||
		isFiniteNonNegativeNumber(value.rss_before_kb) === false ||
		isFiniteNonNegativeNumber(value.rss_after_kb) === false ||
		typeof value.ok !== "boolean"
	)
		return null;
	return {
		component: "ai-pointer",
		duration_ms: value.duration_ms,
		name: value.name,
		ok: value.ok,
		rss_after_kb: value.rss_after_kb,
		rss_before_kb: value.rss_before_kb,
		start_ms: value.start_ms,
	};
}

export function recordsForSuccessfulWorkflows(
	records: LivePerformanceRecord[],
	maximumWorkflows = Number.POSITIVE_INFINITY,
): LivePerformanceRecord[] {
	const workflows = records.filter(
		(record) => record.name === aiPointerPerformanceMetrics.workflowCompletion && record.ok,
	).slice(0, maximumWorkflows);
	return records.filter((record) => workflows.some((workflow) =>
		record.start_ms >= workflow.start_ms &&
		record.start_ms <= workflow.start_ms + workflow.duration_ms
	));
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
