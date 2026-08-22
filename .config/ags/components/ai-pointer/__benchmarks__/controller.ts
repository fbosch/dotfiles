import app from "ags/gtk4/app";
import GLib from "gi://GLib?version=2.0";
import type { AccessibilityLookupMode } from "../accessibility";
import { AiPointerController } from "../controller";
import type { AiPointerView } from "../ai-pointer-view";
import { assertInertBenchmarkDependencies } from "./safety";
import { benchmarkEnvironmentInteger, benchmarkStatistics } from "./stats";

const samples = benchmarkEnvironmentInteger(
	"AI_POINTER_BENCH_SAMPLES",
	GLib.getenv("AI_POINTER_BENCH_SAMPLES"),
	20,
	5,
	200,
);
const batchSize = benchmarkEnvironmentInteger(
	"AI_POINTER_CONTROLLER_BATCH",
	GLib.getenv("AI_POINTER_CONTROLLER_BATCH"),
	10,
	1,
	1_000,
);
const clickFallback = { x: 372, y: 272, width: 256, height: 256 };
const dragTarget = { x: 408, y: 308, width: 224, height: 104 };

app.register(null);

const rssBeforeKb = readRssKb();
const metrics: Record<string, unknown> = {};
metrics["controller-init-teardown"] = await measure(async () => {
	createScenario("click").dispose();
});
for (const mode of ["click", "stroke"] as const) {
	const scenario = createScenario(mode);
	metrics[`${mode === "stroke" ? "drag" : mode}-controller-interaction`] = await measure(
		scenario.run,
	);
	scenario.dispose();
}
const rssAfterKb = readRssKb();

console.log(JSON.stringify({
	benchmark: "ai-pointer-controller",
	batchSize,
	processRssAcrossRunKb: {
		after: rssAfterKb,
		before: rssBeforeKb,
		deltaIncludingRuntimeAndJit:
			rssBeforeKb === null || rssAfterKb === null ? null : rssAfterKb - rssBeforeKb,
	},
	metrics,
	samples,
	unit: "milliseconds per operation",
	unavailableMetrics: ["cpuTime", "allocations"],
}, null, 2));

async function measure(operation: () => Promise<void>): Promise<unknown> {
	const firstStart = nowMs();
	await operation();
	const firstCallMs = nowMs() - firstStart;
	for (let index = 0; index < batchSize; index += 1) await operation();
	const warmSamples: number[] = [];
	for (let sample = 0; sample < samples; sample += 1) {
		const start = nowMs();
		for (let index = 0; index < batchSize; index += 1) await operation();
		warmSamples.push((nowMs() - start) / batchSize);
	}
	return { firstCallMs, warm: benchmarkStatistics(warmSamples) };
}

function createScenario(mode: AccessibilityLookupMode): {
	dispose(): void;
	run(): Promise<void>;
} {
	let completed: (() => void) | null = null;
	const view = {
		create() {},
		beginStroke() {
			return true;
		},
		updateStroke() {},
		endStroke() {},
		finishStroke() {
			return Promise.resolve(true);
		},
		showCapture() {
			throw new Error("Benchmark capture must remain inert");
		},
		setOcrState() {},
		clearOcr() {},
		showError(message: string) {
			throw new Error(message);
		},
		hide() {},
		dispose() {},
	} as unknown as AiPointerView;
	const dependencies = {
		view,
		prepareDirectory: () => "/run/user/benchmark/ai-pointer",
		preflight: async () => ({ kind: "ready" } as const),
		readPointer: () => null,
		resolveAccessibility: async (
			_geometry,
			_stroke,
			_cancellable,
			_onProcess,
			_onDiagnostics,
			lookupMode,
		) => {
			if (lookupMode !== mode) throw new Error(`Expected ${mode} lookup`);
			return mode === "click"
				? null
				: {
					geometry: dragTarget,
					metadata: { confidence: 1, role: "push button" },
				};
		},
		resolvePrograms: () => [],
		recognizeOcr: async () => ({ kind: "no-text" }),
		capture: async () => {
			completed?.();
			return { kind: "cancelled" } as const;
		},
	};
	assertInertBenchmarkDependencies(dependencies);
	const controller = new AiPointerController(dependencies);
	controller.init();
	return {
		dispose: () => controller.teardown(),
		run: async () => {
			const finished = new Promise<void>((resolve) => {
				completed = resolve;
			});
			const start = { x: 500, y: 400 };
			const end = mode === "click" ? start : { x: 540, y: 430 };
			if (controller.start(start) === false || controller.finish(end) === false)
				throw new Error("Benchmark lifecycle did not start");
			await finished;
			await settleMainLoop();
			completed = null;
		},
	};
}

function settleMainLoop(): Promise<void> {
	return new Promise((resolve) => {
		GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
			resolve();
			return GLib.SOURCE_REMOVE;
		});
	});
}

function nowMs(): number {
	return GLib.get_monotonic_time() / 1_000;
}

function readRssKb(): number | null {
	try {
		const [, contents] = GLib.file_get_contents("/proc/self/status");
		const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(new TextDecoder().decode(contents));
		return match ? Number(match[1]) : null;
	} catch {
		return null;
	}
}
