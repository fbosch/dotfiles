import { expect, test } from "bun:test";
import { normalizeLivePerformanceRecord } from "../live-policy";

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
