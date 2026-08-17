import { evaluateAccessibleSnap } from "../../components/ai-pointer/accessibility-policy";
import { evaluateAccessibleClick } from "../../components/ai-pointer/click-policy";
import {
	clickFallbackGeometry,
	clickTargetGeometry,
} from "../../components/ai-pointer/selection";
import { benchmarkStatistics } from "./ai-pointer-stats";

const samples = environmentInteger("AI_POINTER_BENCH_SAMPLES", 30, 5, 200);
const batchSize = environmentInteger("AI_POINTER_POLICY_BATCH", 5_000, 100, 100_000);
const monitor = { x: 0, y: 0, width: 2_560, height: 1_440 };
const client = { x: 100, y: 100, width: 1_200, height: 900 };
const clickPoint = { x: 500, y: 400 };
const dragSelection = { x: 400, y: 300, width: 240, height: 120 };
const accessibleClickCandidates = [
	{ centerHit: true, geometry: { x: 460, y: 380, width: 80, height: 40 }, role: "push button" },
	{ centerHit: true, geometry: { x: 490, y: 395, width: 20, height: 10 }, role: "text" },
];
const inaccessibleClickCandidates = [
	{ centerHit: false, geometry: { x: 510, y: 400, width: 60, height: 40 }, role: "push button" },
];
const accessibleDragCandidates = [
	{ geometry: { x: 420, y: 320, width: 200, height: 80 }, hitCount: 7, role: "push button" },
];
const inaccessibleDragCandidates = [
	{ geometry: { x: 420, y: 320, width: 200, height: 80 }, role: "panel" },
];
let sink: unknown;

const scenarios = {
	"click-accessible-policy": () =>
		evaluateAccessibleClick(clickPoint, accessibleClickCandidates, client, monitor),
	"click-fallback-geometry": () => clickFallbackGeometry(clickPoint, monitor),
	"click-inaccessible-policy": () =>
		evaluateAccessibleClick(clickPoint, inaccessibleClickCandidates, client, monitor),
	"click-target-geometry": () =>
		clickTargetGeometry(clickPoint, accessibleClickCandidates[0].geometry, monitor),
	"drag-accessible-policy": () =>
		evaluateAccessibleSnap(dragSelection, accessibleDragCandidates, client),
	"drag-inaccessible-policy": () =>
		evaluateAccessibleSnap(dragSelection, inaccessibleDragCandidates, client),
};

const rssBeforeKb = Math.round(process.memoryUsage().rss / 1_024);
const metrics: Record<string, unknown> = {};
for (const [name, operation] of Object.entries(scenarios)) {
	const firstStart = performance.now();
	consume(operation());
	const firstCallMs = performance.now() - firstStart;
	for (let index = 0; index < batchSize; index += 1) consume(operation());
	const warmSamples: number[] = [];
	for (let sample = 0; sample < samples; sample += 1) {
		const start = performance.now();
		for (let index = 0; index < batchSize; index += 1) consume(operation());
		warmSamples.push((performance.now() - start) / batchSize);
	}
	metrics[name] = {
		firstCallMs,
		warm: benchmarkStatistics(warmSamples),
	};
}
const rssAfterKb = Math.round(process.memoryUsage().rss / 1_024);

console.log(JSON.stringify({
	benchmark: "ai-pointer-policy",
	batchSize,
	processRssAcrossRunKb: {
		after: rssAfterKb,
		before: rssBeforeKb,
		deltaIncludingRuntimeAndJit: rssAfterKb - rssBeforeKb,
	},
	metrics,
	samples,
	unit: "milliseconds per operation",
	unavailableMetrics: ["cpuTime", "allocations"],
}, null, 2));

function environmentInteger(
	name: string,
	fallback: number,
	minimum: number,
	maximum: number,
): number {
	const value = process.env[name];
	if (value === undefined) return fallback;
	const parsed = Number(value);
	if (Number.isSafeInteger(parsed) === false || parsed < minimum || parsed > maximum)
		throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
	return parsed;
}

function consume(value: unknown): void {
	sink = value;
}
void sink;
