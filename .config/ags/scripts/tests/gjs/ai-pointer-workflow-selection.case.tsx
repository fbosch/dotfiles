import GLib from "gi://GLib?version=2.0";
import type { AiPointerWorkflowView } from "@/components/ai-pointer/native-adapter";
import { AiPointerWorkflow } from "@/components/ai-pointer/workflow";
import { createTestAiPointerNativeAdapter } from "./ai-pointer-test-adapter";
import { assert, test } from "./harness";

function settleMainLoop(): Promise<void> {
	return new Promise((resolve) => {
		GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1, () => {
			resolve();
			return GLib.SOURCE_REMOVE;
		});
	});
}

const readyPreflight = async () => ({ kind: "ready" } as const);

test("AI Pointer preserves a release that arrives before the AGS start request", async () => {
	let captured = "";
	const cursorOutlineStates: boolean[] = [];
	let cursorOutlineDisableAttempts = 0;
	const view: Partial<AiPointerWorkflowView> = {
		create() {},
		beginStroke() {
			return true;
		},
		updateStroke() {},
		endStroke() {},
		finishStroke() {
			return Promise.resolve(true);
		},
showPrompt() {
			return { pixelHeight: 20, pixelWidth: 20 };
		},
		setOcrState() {},
		clearOcr() {},
		showError() {},
		hide() {},
		dispose() {},
	};
	const workflow = new AiPointerWorkflow(createTestAiPointerNativeAdapter({
		view,
		desktop: {
			prepareCaptureDirectory: () => "/run/user/1000/ai-pointer",
			readPointer: () => null,
			setCursorOutline: (enabled) => {
				cursorOutlineStates.push(enabled);
				if (enabled) return true;
				cursorOutlineDisableAttempts += 1;
				return cursorOutlineDisableAttempts !== 2;
			},
		},
		selection: { resolveAccessibility: async () => null, resolvePrograms: () => [] },
		capture: { create: async (_directory, geometry) => {
			captured = `${geometry.x},${geometry.y} ${geometry.width}x${geometry.height}`;
			return {
				kind: "captured",
				capture: { path: "/run/user/1000/ai-pointer/capture-test.png", geometry, sha256: "a".repeat(64) },
			};
		} },
		assistant: { preflight: readyPreflight, recognizeOcr: async () => ({ kind: "no-text" }) },
	}));
	workflow.init();
	try {
		assert(workflow.finish({ x: 30, y: 40 }), "release request was rejected");
		assert(workflow.start({ x: 10, y: 20 }), "start request was rejected");
		await settleMainLoop();
		assert(captured === "-22,-12 84x84", "release-first stroke geometry was not captured");
		assert(
			cursorOutlineStates.join(",") === "false,true",
			"cursor outline did not persist while the question prompt was active",
		);
	} finally {
		workflow.teardown();
	}
});

test("AI Pointer cancellation releases its captured artifact through the native adapter", async () => {
	const capturePath = "/run/user/1000/ai-pointer/capture-test.png";
	const removedPaths: string[] = [];
	const workflow = new AiPointerWorkflow(createTestAiPointerNativeAdapter({
		capture: {
			create: async (_directory, geometry) => ({
				kind: "captured",
				capture: { path: capturePath, geometry, sha256: "a".repeat(64) },
			}),
			remove: (path) => removedPaths.push(path),
		},
	}));
	workflow.init();
	try {
		assert(workflow.start({ x: 10, y: 20 }), "start request was rejected");
		assert(workflow.finish({ x: 30, y: 40 }), "finish request was rejected");
		await settleMainLoop();
		workflow.cancel();
		assert(
			removedPaths.join(",") === capturePath,
			"workflow cancellation did not release its capture",
		);
	} finally {
		workflow.teardown();
	}
});

test("AI Pointer removes the cursor outline when drawing is cancelled", async () => {
	const cursorOutlineStates: boolean[] = [];
	const view: Partial<AiPointerWorkflowView> = {
		create() {},
		beginStroke() {
			return true;
		},
		updateStroke() {},
		endStroke() {},
		clearOcr() {},
		hide() {},
		dispose() {},
	};
	const workflow = new AiPointerWorkflow(createTestAiPointerNativeAdapter({
		view,
		desktop: {
			prepareCaptureDirectory: () => "/run/user/1000/ai-pointer",
			readPointer: () => null,
			setCursorOutline: (enabled) => cursorOutlineStates.push(enabled),
		},
		assistant: { preflight: readyPreflight },
	}));
	workflow.init();
	try {
		assert(workflow.start({ x: 10, y: 20 }), "start request was rejected");
		await settleMainLoop();
		workflow.cancel();
		assert(
			cursorOutlineStates.join(",") === "false,true,false",
			"cursor outline survived drawing cancellation",
		);
	} finally {
		workflow.teardown();
	}
});

test("AI Pointer uses a bounded fallback for a click without an accessible target", async () => {
	let captured = "";
	let lookupMode = "";
	const view: Partial<AiPointerWorkflowView> = {
		create() {},
		beginStroke() {
			return true;
		},
		updateStroke() {},
		endStroke() {},
		finishStroke() {
			return Promise.resolve(true);
		},
showPrompt() {
			return { pixelHeight: 20, pixelWidth: 20 };
		},
		setOcrState() {},
		clearOcr() {},
		showError() {},
		hide() {},
		dispose() {},
	};
	const workflow = new AiPointerWorkflow(createTestAiPointerNativeAdapter({
		view,
		desktop: {
			prepareCaptureDirectory: () => "/run/user/1000/ai-pointer",
			readPointer: () => null,
		},
		selection: {
			resolveClickGeometry: () => ({ x: 72, y: 72, width: 256, height: 256 }),
			resolveAccessibility: async (
			_geometry,
			_stroke,
			_cancellable,
			_onProcess,
			_onDiagnostics,
			mode,
		) => {
			lookupMode = mode ?? "";
			return null;
			},
			resolvePrograms: () => [],
		},
		capture: { create: async (_directory, geometry) => {
			captured = `${geometry.x},${geometry.y} ${geometry.width}x${geometry.height}`;
			return {
				kind: "captured",
				capture: { path: "/run/user/1000/ai-pointer/capture-test.png", geometry, sha256: "a".repeat(64) },
			};
		} },
		assistant: { preflight: readyPreflight, recognizeOcr: async () => ({ kind: "no-text" }) },
	}));
	workflow.init();
	try {
		assert(workflow.start({ x: 200, y: 200 }), "click start was rejected");
		assert(workflow.finish({ x: 200, y: 200 }), "click finish was rejected");
		await settleMainLoop();
		assert(lookupMode === "click", "click did not use point accessibility policy");
		assert(captured === "72,72 256x256", "click fallback geometry was not captured");
	} finally {
		workflow.teardown();
	}
});

test("AI Pointer clears drawing on release and prepares the final highlight before capture", async () => {
	let captured = false;
	let drawingEnded = false;
	let preparingShown = false;
	let finishAccessibility: (() => void) | null = null;
	let confirmHidden: ((hidden: boolean) => void) | null = null;
	const view: Partial<AiPointerWorkflowView> = {
		create() {},
		beginStroke() {
			return true;
		},
		updateStroke() {},
		endStroke() { drawingEnded = true; },
		finishStroke() {
			return new Promise<boolean>((resolve) => {
				confirmHidden = resolve;
			});
		},
		showPreparing() {
			preparingShown = true;
		},
		showPrompt() {
			return { pixelHeight: 20, pixelWidth: 20 };
		},
		setOcrState() {},
		clearOcr() {},
		showError() {},
		hide() {},
		dispose() {},
	};
	const workflow = new AiPointerWorkflow(createTestAiPointerNativeAdapter({
		view,
		desktop: {
			prepareCaptureDirectory: () => "/run/user/1000/ai-pointer",
			readPointer: () => null,
		},
		selection: {
			resolveAccessibility: () =>
			new Promise<null>((resolve) => {
				finishAccessibility = () => resolve(null);
			}),
			resolvePrograms: () => [],
		},
		capture: { create: async (_directory, geometry) => {
			captured = true;
			return {
				kind: "captured",
				capture: { path: "/run/user/1000/ai-pointer/capture-test.png", geometry, sha256: "a".repeat(64) },
			};
		} },
		assistant: { preflight: readyPreflight, recognizeOcr: async () => ({ kind: "no-text" }) },
	}));
	workflow.init();
	try {
		assert(workflow.start({ x: 10, y: 20 }), "start request was rejected");
		assert(workflow.finish({ x: 30, y: 40 }), "finish request was rejected");
		await settleMainLoop();
		assert(preparingShown, "question input waited for target resolution");
		assert(drawingEnded, "drawing remained visible after release");
		assert(confirmHidden === null, "final highlight preparation started before target resolution completed");
		assert(captured === false, "capture started while the drawing was still mapped");
		assert(finishAccessibility !== null, "target resolution did not start");
		finishAccessibility();
		await settleMainLoop();
		assert(confirmHidden !== null, "final highlight preparation was not requested");
		confirmHidden(true);
		await settleMainLoop();
		assert(captured, "capture did not start after the final highlight was prepared");
	} finally {
		workflow.teardown();
	}
});

test("AI Pointer rejects a second finish while overlay teardown is pending", async () => {
	let captures = 0;
	let confirmHidden: ((hidden: boolean) => void) | null = null;
	const view: Partial<AiPointerWorkflowView> = {
		create() {},
		beginStroke() {
			return true;
		},
		updateStroke() {},
		endStroke() {},
		finishStroke() {
			return new Promise<boolean>((resolve) => {
				confirmHidden = resolve;
			});
		},
		showPrompt() {
			return { pixelHeight: 20, pixelWidth: 20 };
		},
		setOcrState() {},
		clearOcr() {},
		showError() {},
		hide() {},
		dispose() {},
	};
	const workflow = new AiPointerWorkflow(createTestAiPointerNativeAdapter({
		view,
		desktop: {
			prepareCaptureDirectory: () => "/run/user/1000/ai-pointer",
			readPointer: () => null,
		},
		selection: { resolveAccessibility: async () => null, resolvePrograms: () => [] },
		capture: { create: async () => {
			captures += 1;
			return { kind: "cancelled" };
		} },
		assistant: { preflight: readyPreflight, recognizeOcr: async () => ({ kind: "no-text" }) },
	}));
	workflow.init();
	try {
		assert(workflow.start({ x: 10, y: 20 }), "start request was rejected");
		assert(workflow.finish({ x: 30, y: 40 }), "first finish request was rejected");
		assert(workflow.finish({ x: 31, y: 41 }) === false, "second finish request was accepted");
		await settleMainLoop();
		assert(confirmHidden !== null, "drawing teardown was not requested");
		confirmHidden(true);
		await settleMainLoop();
		assert(captures === 1, "duplicate finish started multiple captures");
	} finally {
		workflow.teardown();
	}
});

test("AI Pointer converts an unexpected OCR rejection into a bounded failure", async () => {
	const ocrStates: string[] = [];
	const view: Partial<AiPointerWorkflowView> = {
		create() {},
		beginStroke() {
			return true;
		},
		updateStroke() {},
		endStroke() {},
		finishStroke() {
			return Promise.resolve(true);
		},
showPrompt() {
			return { pixelHeight: 20, pixelWidth: 20 };
		},
		setOcrState(state) {
			ocrStates.push(state.kind);
		},
		clearOcr() {},
		showError() {},
		hide() {},
		dispose() {},
	};
	const workflow = new AiPointerWorkflow(createTestAiPointerNativeAdapter({
		view,
		desktop: {
			prepareCaptureDirectory: () => "/run/user/1000/ai-pointer",
			readPointer: () => null,
		},
		selection: { resolveAccessibility: async () => null, resolvePrograms: () => [] },
		capture: { create: async (_directory, geometry) => ({
			kind: "captured",
			capture: { path: "/run/user/1000/ai-pointer/capture-test.png", geometry, sha256: "a".repeat(64) },
		}) },
		assistant: {
			preflight: readyPreflight,
			recognizeOcr: async () => {
			throw new Error("fixture failure");
		},
		},
	}));
	workflow.init();
	try {
		assert(workflow.start({ x: 10, y: 20 }), "start request was rejected");
		assert(workflow.finish({ x: 30, y: 40 }), "finish request was rejected");
		await settleMainLoop();
		await settleMainLoop();
		assert(ocrStates.join(",") === "pending,unavailable", "OCR rejection escaped the workflow");
	} finally {
		workflow.teardown();
	}
});

test("AI Pointer captures a confident accessible snap without presenting metadata", async () => {
	let captured = "";
	let debugCandidateRole = "";
	let previewArgumentCount = 0;
	let resolvedAccessibility = false;
	let resolvedPrograms = false;
	let ocrInput = "";
	const presentationOrder: string[] = [];
	const ocrStates: string[] = [];
	const view: Partial<AiPointerWorkflowView> = {
		create() {},
		beginStroke() {
			return true;
		},
		updateStroke() {},
		endStroke() {},
		finishStroke() {
			return Promise.resolve(true);
		},
showPrompt(...args) {
presentationOrder.push("prompt");
previewArgumentCount = args.length;
			return { pixelHeight: 20, pixelWidth: 20 };
		},
		setAccessibilityDebugState(state) {
			debugCandidateRole = state.kind === "evaluated" ? state.diagnostics[0]?.role ?? "" : "";
		},
		setOcrState(state) {
			ocrStates.push(state.kind);
		},
		clearOcr() {},
		showError() {},
		hide() {},
		dispose() {},
	};
	const workflow = new AiPointerWorkflow(createTestAiPointerNativeAdapter({
		view,
		desktop: {
			prepareCaptureDirectory: () => "/run/user/1000/ai-pointer",
			readPointer: () => null,
		},
		selection: {
			resolveAccessibility: async (_geometry, _stroke, _cancellable, _onProcess, onDebugState) => {
			resolvedAccessibility = true;
			onDebugState?.({
				kind: "evaluated",
				regionKind: "box",
				candidateCount: 1,
				partial: false,
				diagnostics: [
					{
						centerHit: true,
						confidence: 0.9,
						geometry: { x: 100, y: 200, width: 120, height: 60 },
						hitCount: 7,
						name: "Submit",
						reason: "eligible",
						role: "push button",
						selected: true,
					},
				],
			});
			return {
				geometry: { x: 100, y: 200, width: 120, height: 60 },
				metadata: { confidence: 0.9, name: "Submit", role: "push button" },
			};
			},
			resolvePrograms: () => {
			resolvedPrograms = true;
			return [
				{
					class: "org.wezfurlong.wezterm",
					geometry: { x: 0, y: 0, width: 500, height: 400 },
					pid: 123,
					title: "Terminal",
				},
			];
			},
		},
		capture: { create: async (_directory, geometry) => {
			captured = `${geometry.x},${geometry.y} ${geometry.width}x${geometry.height}`;
			return {
				kind: "captured",
				capture: { path: "/run/user/1000/ai-pointer/capture-test.png", geometry, sha256: "a".repeat(64) },
			};
		} },
		assistant: {
			preflight: readyPreflight,
			recognizeOcr: async (input) => {
			presentationOrder.push("ocr");
			ocrInput = `${input.path}:${input.pixelWidth}x${input.pixelHeight}`;
			return { kind: "text", text: "Local text" };
		},
		},
	}));
	workflow.init();
	try {
		assert(workflow.start({ x: 10, y: 20 }), "start request was rejected");
		assert(workflow.finish({ x: 30, y: 40 }), "finish request was rejected");
		await settleMainLoop();
		await settleMainLoop();
		assert(captured === "100,200 120x60", "accessible geometry was not captured");
		assert(resolvedAccessibility, "accessible metadata was not resolved");
		assert(resolvedPrograms, "program metadata was not resolved");
		assert(debugCandidateRole === "push button", "accessibility diagnostics were not presented");
assert(previewArgumentCount === 1, "private context was passed to the prompt view");
assert(presentationOrder.join(",") === "prompt,ocr", "OCR started before presentation");
		assert(
			ocrInput === "/run/user/1000/ai-pointer/capture-test.png:20x20",
			"OCR did not reuse the presented capture",
		);
		assert(ocrStates.join(",") === "pending,text", "OCR states were not presented");
	} finally {
		workflow.teardown();
	}
});

test("AI Pointer prompt failure settles when capture cleanup throws", async () => {
	let failure = "";
	const workflow = new AiPointerWorkflow(createTestAiPointerNativeAdapter({
		view: {
			showPrompt: () => null,
			showError: (message) => { failure = message; },
		},
		capture: {
			create: async (_directory, geometry) => ({
				kind: "captured",
				capture: {
					path: "/run/user/1000/ai-pointer/capture-test.png",
					geometry,
					sha256: "a".repeat(64),
				},
			}),
			remove: () => { throw new Error("fixture cleanup failure"); },
		},
	}));
	workflow.init();
	try {
		assert(workflow.start({ x: 10, y: 20 }), "start request was rejected");
		assert(workflow.finish({ x: 30, y: 40 }), "finish request was rejected");
		await settleMainLoop();
		assert(
			failure === "The question field could not be presented.",
			"capture cleanup replaced the prompt failure",
		);
		workflow.cancel();
		assert(workflow.start({ x: 50, y: 60 }), "prompt failure did not settle");
	} finally {
		workflow.teardown();
	}
});

test("AI Pointer owns one host shutdown connection per lifecycle", () => {
	let connectCount = 0;
	let disconnectCount = 0;
	let shutdown: (() => void) | null = null;
	const workflow = new AiPointerWorkflow(createTestAiPointerNativeAdapter({
		host: {
			connectShutdown(callback) {
				connectCount += 1;
				shutdown = callback;
				return () => { disconnectCount += 1; };
			},
		},
	}));

	workflow.init();
	workflow.init();
	assert(connectCount === 1, "repeated initialization duplicated the shutdown connection");
	assert(shutdown !== null, "shutdown callback was not registered");
	shutdown();
	assert(disconnectCount === 1, "host shutdown did not disconnect its signal");
	workflow.teardown();
	assert(disconnectCount === 1, "repeated teardown disconnected twice");

	workflow.init();
	assert(connectCount === 2, "reinitialization did not reconnect shutdown");
	workflow.teardown();
	workflow.teardown();
	assert(disconnectCount === 2, "reinitialized lifecycle did not disconnect exactly once");
});
