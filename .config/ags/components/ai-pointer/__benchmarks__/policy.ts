import { evaluateAccessibleSnap } from "../accessibility-policy";
import { evaluateAccessibleClick } from "../click-policy";
import {
	clickFallbackGeometry,
	clickTargetGeometry,
} from "../selection";
import { strokeSelectionRegion } from "../stroke";
import { benchmarkEnvironmentInteger, benchmarkStatistics } from "./stats";

const samples = benchmarkEnvironmentInteger(
	"AI_POINTER_BENCH_SAMPLES",
	process.env.AI_POINTER_BENCH_SAMPLES,
	30,
	5,
	200,
);
const batchSize = benchmarkEnvironmentInteger(
	"AI_POINTER_POLICY_BATCH",
	process.env.AI_POINTER_POLICY_BATCH,
	5_000,
	100,
	100_000,
);
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
const dragRegion = strokeSelectionRegion([
	{ x: 400, y: 360 },
	{ x: 420, y: 310 },
	{ x: 500, y: 280 },
	{ x: 590, y: 300 },
	{ x: 640, y: 360 },
	{ x: 600, y: 420 },
	{ x: 510, y: 440 },
	{ x: 430, y: 410 },
	{ x: 405, y: 370 },
]);
const maximumRegionStroke = Array.from({ length: 1_024 }, (_, index) => {
	const angle = (index / 1_023) * Math.PI * 2;
	return {
		x: Math.round(520 + Math.cos(angle) * 150),
		y: Math.round(360 + Math.sin(angle) * 100),
	};
});
const maximumClickCandidates = Array.from({ length: 24 }, (_, index) => ({
	centerHit: true,
	geometry: {
		height: 20 + index * 2,
		width: 40 + index * 4,
		x: 500 - Math.floor((40 + index * 4) / 2),
		y: 400 - Math.floor((20 + index * 2) / 2),
	},
	role: index === 0 ? "push button" : index % 2 === 0 ? "link" : "text",
}));
const maximumDragCandidates = Array.from({ length: 24 }, (_, index) => ({
	geometry: {
		height: 50,
		width: 80,
		x: 410 + (index % 6) * 30,
		y: 310 + Math.floor(index / 6) * 18,
	},
	role: "text",
}));
let sink: unknown;

const scenarios = {
	"click-accessible-policy": () =>
		evaluateAccessibleClick(clickPoint, accessibleClickCandidates, client, monitor),
	"click-fallback-geometry": () => clickFallbackGeometry(clickPoint, monitor),
	"click-inaccessible-policy": () =>
		evaluateAccessibleClick(clickPoint, inaccessibleClickCandidates, client, monitor),
	"click-maximum-candidates-policy": () =>
		evaluateAccessibleClick(clickPoint, maximumClickCandidates, client, monitor),
	"click-target-geometry": () =>
		clickTargetGeometry(clickPoint, accessibleClickCandidates[0].geometry, monitor),
	"drag-accessible-policy": () =>
		evaluateAccessibleSnap(dragSelection, accessibleDragCandidates, client),
	"drag-inaccessible-policy": () =>
		evaluateAccessibleSnap(dragSelection, inaccessibleDragCandidates, client),
	"drag-maximum-candidates-policy": () =>
		evaluateAccessibleSnap(dragSelection, maximumDragCandidates, client),
	"drag-region-policy": () =>
		evaluateAccessibleSnap(dragSelection, maximumDragCandidates, client, dragRegion),
	"drag-maximum-region-construction": () => strokeSelectionRegion(maximumRegionStroke),
	"drag-maximum-region-policy": () =>
		evaluateAccessibleSnap(
			dragSelection,
			maximumDragCandidates,
			client,
			strokeSelectionRegion(maximumRegionStroke),
		),
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

function consume(value: unknown): void {
	sink = value;
}
void sink;
