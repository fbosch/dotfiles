import app from "ags/gtk4/app";
import Gio from "gi://Gio?version=2.0";
import Gdk from "gi://Gdk?version=4.0";
import GLib from "gi://GLib?version=2.0";
import { readBoundedHelperOutput } from "@/components/ai-pointer/accessibility";
import {
	decodeAccessibilityHelperArgument,
	encodeAccessibilityHelperArgument,
} from "@/components/ai-pointer/accessibility/helper-argument";
import { AiPointerController } from "@/components/ai-pointer/controller";
import { AiPointerView } from "@/components/ai-pointer/ai-pointer-view";
import { createCancelController } from "@/components/ai-pointer/cancel-controller";
import { pngDimensions, sha256 } from "@/components/ai-pointer/capture";
import {
	maximumOcrOutputBytes,
	readBoundedOcrOutput,
} from "@/components/ai-pointer/ocr";
import { StrokeOverlay } from "@/components/ai-pointer/stroke-overlay";
import { appendStrokePoint, createPointerStroke } from "@/components/ai-pointer/stroke";
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

test("AI Pointer Escape controller consumes Escape and cancels", () => {
	let cancellations = 0;
	const controller = createCancelController(() => { cancellations += 1; });
	assert(controller.emit("key-pressed", Gdk.KEY_Escape, 0, 0), "Escape was not consumed");
	assert(cancellations === 1, "Escape did not request cancellation");
	assert(controller.emit("key-pressed", Gdk.KEY_Return, 0, 0) === false, "non-Escape key was consumed");
});

test("AI Pointer reads helper output with a streaming byte limit", async () => {
	const shell = GLib.find_program_in_path("sh");
	assert(shell !== null, "shell fixture is unavailable");
	const expected = JSON.stringify({
		protocolVersion: 6,
		coordinateSpace: "window",
		candidates: [],
		complete: true,
		timings: {
			initialization: { startMs: 1, durationMs: 1 },
			applicationDiscovery: { startMs: 2, durationMs: 1 },
			windowMatching: { startMs: 3, durationMs: 1 },
			hitTesting: { startMs: 4, durationMs: 1 },
			ancestorTraversal: { startMs: 5, durationMs: 1 },
			candidateInspection: { startMs: 6, durationMs: 1 },
			serialization: { startMs: 7, durationMs: 1 },
		},
	});
	const valid = Gio.Subprocess.new(
		[shell, "-c", "printf '%s' \"$1\"", "fixture", expected],
		Gio.SubprocessFlags.STDOUT_PIPE,
	);
	assert(
		(await readBoundedHelperOutput(valid, new Gio.Cancellable())) === expected,
		"valid helper output was not read",
	);

	const oversized = Gio.Subprocess.new(
		[shell, "-c", "printf '%*s' 32769 ''"],
		Gio.SubprocessFlags.STDOUT_PIPE,
	);
	assert(
		(await readBoundedHelperOutput(oversized, new Gio.Cancellable())) === null,
		"oversized helper output was retained",
	);
});

test("AI Pointer helper arguments survive the generated shell launcher", () => {
	const input = JSON.stringify({ title: "Documentation * active tab — Zen Browser" });
	const encoded = encodeAccessibilityHelperArgument(input);
	assert(/^[A-Za-z0-9+/]+=*$/.test(encoded), "helper argument contains shell-splittable data");
	assert(decodeAccessibilityHelperArgument(encoded) === input, "helper argument did not round trip");
	assert(decodeAccessibilityHelperArgument("not base64") === null, "malformed base64 was accepted");
});

test("AI Pointer validates PNG headers and computes a capture digest", () => {
	const png = new Uint8Array([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
		0, 0, 0, 20, 0, 0, 0, 10,
	]);
	assert(JSON.stringify(pngDimensions(png)) === JSON.stringify({ width: 20, height: 10 }), "PNG dimensions were not parsed");
	assert(pngDimensions(png.slice(0, 12)) === null, "partial PNG was accepted");
	png[12] = 0;
	assert(pngDimensions(png) === null, "invalid PNG IHDR was accepted");
	png[12] = 0x49;
	assert(/^[a-f0-9]{64}$/.test(sha256(png)), "capture digest is not SHA-256");
	assert(sha256(png) !== sha256(png.slice(0, 23)), "different capture bytes shared a digest");
});

test("AI Pointer bounds local OCR output while streaming", async () => {
	const shell = GLib.find_program_in_path("sh");
	assert(shell !== null, "shell fixture is unavailable");
	const valid = Gio.Subprocess.new(
		[shell, "-c", "printf 'recognized text'"],
		Gio.SubprocessFlags.STDOUT_PIPE,
	);
	const validOutput = await readBoundedOcrOutput(valid, new Gio.Cancellable());
	assert(
		validOutput.kind === "complete" && validOutput.text === "recognized text",
		"bounded OCR output was not read",
	);

	const oversized = Gio.Subprocess.new(
		[shell, "-c", `printf '%*s' ${maximumOcrOutputBytes + 1} '' | tr ' ' x`],
		Gio.SubprocessFlags.STDOUT_PIPE,
	);
	const oversizedOutput = await readBoundedOcrOutput(oversized, new Gio.Cancellable());
	assert(
		oversizedOutput.kind === "truncated" &&
			oversizedOutput.text.length === maximumOcrOutputBytes,
		"oversized OCR output was not truncated during streaming",
	);
});

test("AI Pointer stroke overlay maps, redraws, and disposes", async () => {
	const overlay = new StrokeOverlay();
	let stroke = createPointerStroke({ x: 10, y: 10 });
	stroke = appendStrokePoint(stroke, { x: 80, y: 80 }, true);
	assert(
		overlay.show(stroke, () => {}, () => {}),
		"AI Pointer stroke overlay was unavailable",
	);
	await settleMainLoop();
	stroke = appendStrokePoint(stroke, { x: 100, y: 100 }, true);
	overlay.update(stroke);
	await settleMainLoop();
	assert(await overlay.hideBeforeCapture(), "AI Pointer stroke overlay did not unmap");
	assert(
		overlay.showSelection({ x: 0, y: 0, width: 120, height: 120 }),
		"AI Pointer selection overlay was unavailable",
	);
	await settleMainLoop();
	assert(
		overlay.showSelection(
			{ x: 0, y: 0, width: 120, height: 120 },
			false,
			null,
			{
				kind: "evaluated",
				regionKind: "closed",
				candidateCount: 24,
				partial: true,
				diagnostics: [
					{
						centerHit: true,
						confidence: 0.9,
						geometry: { x: 20, y: 20, width: 60, height: 40 },
						hitCount: 3,
						reason: "eligible",
						role: "push button",
						selected: true,
					},
				],
			},
		),
		"AI Pointer accessibility debug overlay was unavailable",
	);
	await settleMainLoop();
	const previewWindow = app.get_window("ai-pointer-ags-ai-pointer-selection-preview-0");
	assert(previewWindow !== null, "AI Pointer accessibility preview was not registered");
	overlay.setSelectionFill(true);
	overlay.setSelectionDebugState({
		kind: "unavailable",
		regionKind: "corridor",
		reason: "helper incomplete",
	});
	await settleMainLoop();
	assert(
		app.get_window("ai-pointer-ags-ai-pointer-selection-preview-0") === previewWindow,
		"AI Pointer accessibility diagnostics recreated the preview window",
	);
	overlay.hide();
});

test("AI Pointer preserves a release that arrives before the AGS start request", async () => {
	let captured = "";
	const cursorOutlineStates: boolean[] = [];
	let cursorOutlineDisableAttempts = 0;
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
showPrompt() {
			return { pixelHeight: 20, pixelWidth: 20 };
		},
		setOcrState() {},
		clearOcr() {},
		showError() {},
		hide() {},
		dispose() {},
	} as unknown as AiPointerView;
	const controller = new AiPointerController({
		view,
		prepareDirectory: () => "/run/user/1000/ai-pointer",
		preflight: readyPreflight,
		readPointer: () => null,
		resolveAccessibility: async () => null,
		resolvePrograms: () => [],
		recognizeOcr: async () => ({ kind: "no-text" }),
		capture: async (_directory, geometry) => {
			captured = `${geometry.x},${geometry.y} ${geometry.width}x${geometry.height}`;
			return {
				kind: "captured",
				capture: { path: "/run/user/1000/ai-pointer/capture-test.png", geometry, sha256: "a".repeat(64) },
			};
		},
		setCursorOutline: (enabled) => {
			cursorOutlineStates.push(enabled);
			if (enabled) return true;
			cursorOutlineDisableAttempts += 1;
			return cursorOutlineDisableAttempts !== 2;
		},
	});
	controller.init();
	try {
		assert(controller.finish({ x: 30, y: 40 }), "release request was rejected");
		assert(controller.start({ x: 10, y: 20 }), "start request was rejected");
		await settleMainLoop();
		assert(captured === "-22,-12 84x84", "release-first stroke geometry was not captured");
		assert(
			cursorOutlineStates.join(",") === "false,true",
			"cursor outline did not persist while the question prompt was active",
		);
	} finally {
		controller.teardown();
	}
});

test("AI Pointer removes the cursor outline when drawing is cancelled", async () => {
	const cursorOutlineStates: boolean[] = [];
	const view = {
		create() {},
		beginStroke() {
			return true;
		},
		updateStroke() {},
		endStroke() {},
		clearOcr() {},
		hide() {},
		dispose() {},
	} as unknown as AiPointerView;
	const controller = new AiPointerController({
		view,
		prepareDirectory: () => "/run/user/1000/ai-pointer",
		preflight: readyPreflight,
		readPointer: () => null,
		setCursorOutline: (enabled) => cursorOutlineStates.push(enabled),
	});
	controller.init();
	try {
		assert(controller.start({ x: 10, y: 20 }), "start request was rejected");
		await settleMainLoop();
		controller.cancel();
		assert(
			cursorOutlineStates.join(",") === "false,true,false",
			"cursor outline survived drawing cancellation",
		);
	} finally {
		controller.teardown();
	}
});

test("AI Pointer uses a bounded fallback for a click without an accessible target", async () => {
	let captured = "";
	let lookupMode = "";
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
showPrompt() {
			return { pixelHeight: 20, pixelWidth: 20 };
		},
		setOcrState() {},
		clearOcr() {},
		showError() {},
		hide() {},
		dispose() {},
	} as unknown as AiPointerView;
	const controller = new AiPointerController({
		view,
		prepareDirectory: () => "/run/user/1000/ai-pointer",
		preflight: readyPreflight,
		readPointer: () => null,
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
		recognizeOcr: async () => ({ kind: "no-text" }),
		capture: async (_directory, geometry) => {
			captured = `${geometry.x},${geometry.y} ${geometry.width}x${geometry.height}`;
			return {
				kind: "captured",
				capture: { path: "/run/user/1000/ai-pointer/capture-test.png", geometry, sha256: "a".repeat(64) },
			};
		},
	});
	controller.init();
	try {
		assert(controller.start({ x: 200, y: 200 }), "click start was rejected");
		assert(controller.finish({ x: 200, y: 200 }), "click finish was rejected");
		await settleMainLoop();
		assert(lookupMode === "click", "click did not use point accessibility policy");
		assert(captured === "72,72 256x256", "click fallback geometry was not captured");
	} finally {
		controller.teardown();
	}
});

test("AI Pointer clears drawing on release and prepares the final highlight before capture", async () => {
	let captured = false;
	let drawingEnded = false;
	let preparingShown = false;
	let finishAccessibility: (() => void) | null = null;
	let confirmHidden: ((hidden: boolean) => void) | null = null;
	const view = {
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
	} as unknown as AiPointerView;
	const controller = new AiPointerController({
		view,
		prepareDirectory: () => "/run/user/1000/ai-pointer",
		preflight: readyPreflight,
		readPointer: () => null,
		resolveAccessibility: () =>
			new Promise<null>((resolve) => {
				finishAccessibility = () => resolve(null);
			}),
		resolvePrograms: () => [],
		recognizeOcr: async () => ({ kind: "no-text" }),
		capture: async (_directory, geometry) => {
			captured = true;
			return {
				kind: "captured",
				capture: { path: "/run/user/1000/ai-pointer/capture-test.png", geometry, sha256: "a".repeat(64) },
			};
		},
	});
	controller.init();
	try {
		assert(controller.start({ x: 10, y: 20 }), "start request was rejected");
		assert(controller.finish({ x: 30, y: 40 }), "finish request was rejected");
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
		controller.teardown();
	}
});

test("AI Pointer rejects a second finish while overlay teardown is pending", async () => {
	let captures = 0;
	let confirmHidden: ((hidden: boolean) => void) | null = null;
	const view = {
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
	} as unknown as AiPointerView;
	const controller = new AiPointerController({
		view,
		prepareDirectory: () => "/run/user/1000/ai-pointer",
		preflight: readyPreflight,
		readPointer: () => null,
		resolveAccessibility: async () => null,
		resolvePrograms: () => [],
		recognizeOcr: async () => ({ kind: "no-text" }),
		capture: async () => {
			captures += 1;
			return { kind: "cancelled" };
		},
	});
	controller.init();
	try {
		assert(controller.start({ x: 10, y: 20 }), "start request was rejected");
		assert(controller.finish({ x: 30, y: 40 }), "first finish request was rejected");
		assert(controller.finish({ x: 31, y: 41 }) === false, "second finish request was accepted");
		await settleMainLoop();
		assert(confirmHidden !== null, "drawing teardown was not requested");
		confirmHidden(true);
		await settleMainLoop();
		assert(captures === 1, "duplicate finish started multiple captures");
	} finally {
		controller.teardown();
	}
});

test("AI Pointer converts an unexpected OCR rejection into a bounded failure", async () => {
	const ocrStates: string[] = [];
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
	} as unknown as AiPointerView;
	const controller = new AiPointerController({
		view,
		prepareDirectory: () => "/run/user/1000/ai-pointer",
		preflight: readyPreflight,
		readPointer: () => null,
		resolveAccessibility: async () => null,
		resolvePrograms: () => [],
		recognizeOcr: async () => {
			throw new Error("fixture failure");
		},
		capture: async (_directory, geometry) => ({
			kind: "captured",
			capture: { path: "/run/user/1000/ai-pointer/capture-test.png", geometry, sha256: "a".repeat(64) },
		}),
	});
	controller.init();
	try {
		assert(controller.start({ x: 10, y: 20 }), "start request was rejected");
		assert(controller.finish({ x: 30, y: 40 }), "finish request was rejected");
		await settleMainLoop();
		await settleMainLoop();
		assert(ocrStates.join(",") === "pending,unavailable", "OCR rejection escaped the workflow");
	} finally {
		controller.teardown();
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
	} as unknown as AiPointerView;
	const controller = new AiPointerController({
		view,
		prepareDirectory: () => "/run/user/1000/ai-pointer",
		preflight: readyPreflight,
		readPointer: () => null,
		resolveAccessibility: async (_geometry, _stroke, _cancellable, _onProcess, onDebugState) => {
			resolvedAccessibility = true;
			onDebugState?.({
				kind: "evaluated",
				regionKind: "closed",
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
		recognizeOcr: async (input) => {
			presentationOrder.push("ocr");
			ocrInput = `${input.path}:${input.pixelWidth}x${input.pixelHeight}`;
			return { kind: "text", text: "Local text" };
		},
		capture: async (_directory, geometry) => {
			captured = `${geometry.x},${geometry.y} ${geometry.width}x${geometry.height}`;
			return {
				kind: "captured",
				capture: { path: "/run/user/1000/ai-pointer/capture-test.png", geometry, sha256: "a".repeat(64) },
			};
		},
	});
	controller.init();
	try {
		assert(controller.start({ x: 10, y: 20 }), "start request was rejected");
		assert(controller.finish({ x: 30, y: 40 }), "finish request was rejected");
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
		controller.teardown();
	}
});
