import { expect, test } from "bun:test";
import {
	normalizeLivePerformanceRecord,
	recordsForSuccessfulWorkflows,
	type LivePerformanceRecord,
} from "../live-policy";

test("normalizes allowlisted AI Pointer timing records without diagnostic fields", () => {
	expect(normalizeLivePerformanceRecord({
		component: "ai-pointer",
		duration_ms: 12.5,
		error: "must not cross the collector boundary",
		name: "capture",
		ok: true,
		rss_after_kb: 101,
		rss_before_kb: 100,
		start_ms: 42,
	})).toEqual({
		component: "ai-pointer",
		duration_ms: 12.5,
		name: "capture",
		ok: true,
		rss_after_kb: 101,
		rss_before_kb: 100,
		start_ms: 42,
	});
});

test("rejects unknown components, metrics, and malformed timings", () => {
	const valid = {
		component: "ai-pointer",
		duration_ms: 1,
		name: "capture",
		ok: true,
		rss_after_kb: 101,
		rss_before_kb: 100,
		start_ms: 42,
	};
	expect(normalizeLivePerformanceRecord({ ...valid, component: "calendar-widget" })).toBeNull();
	expect(normalizeLivePerformanceRecord({ ...valid, name: "selectedText" })).toBeNull();
	expect(normalizeLivePerformanceRecord({ ...valid, duration_ms: -1 })).toBeNull();
});

test("keeps stages only from successful workflow windows", () => {
	const record = (
		name: string,
		start_ms: number,
		duration_ms: number,
		ok: boolean,
	): LivePerformanceRecord => ({
		component: "ai-pointer",
		duration_ms,
		name,
		ok,
		rss_after_kb: 101,
		rss_before_kb: 100,
		start_ms,
	});
	const failedStage = record("capture", 12, 2, false);
	const successfulStage = record("capture", 102, 2, true);
	const records = [
		failedStage,
		record("workflowCompletion", 10, 10, false),
		successfulStage,
		record("workflowCompletion", 100, 10, true),
	];

	expect(recordsForSuccessfulWorkflows(records)).toEqual([
		successfulStage,
		records[3],
	]);
});

test("limits coalesced successful workflows to the requested count", () => {
	const records: LivePerformanceRecord[] = [
		{
			component: "ai-pointer",
			duration_ms: 10,
			name: "workflowCompletion",
			ok: true,
			rss_after_kb: 101,
			rss_before_kb: 100,
			start_ms: 10,
		},
		{
			component: "ai-pointer",
			duration_ms: 10,
			name: "workflowCompletion",
			ok: true,
			rss_after_kb: 101,
			rss_before_kb: 100,
			start_ms: 30,
		},
	];

	expect(recordsForSuccessfulWorkflows(records, 1)).toEqual([records[0]]);
});
