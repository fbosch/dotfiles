import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { readBoundedHelperOutput } from "@/components/ai-pointer/accessibility";
import {
	decodeAccessibilityHelperArgument,
	encodeAccessibilityHelperArgument,
} from "@/components/ai-pointer/accessibility-helper-argument";
import { AiPointerController } from "@/components/ai-pointer/controller";
import { AiPointerView } from "@/components/ai-pointer/ai-pointer-view";
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

test("AI Pointer view presents a capture and disposes", async () => {
	const view = new AiPointerView();
	view.create({ onCancel() {} });
	const capturePath = GLib.canonicalize_filename(
		"../../../components/ai-pointer/__tests__/capture.svg",
		GLib.get_current_dir(),
	);
	assert(
		view.showCapture(
			{
				path: capturePath,
				geometry: { x: 10, y: 20, width: 20, height: 20 },
			},
			{
				centerHit: true,
				confidence: 0.9,
				hitCount: 7,
				name: "Submit",
				program: {
					class: "org.example.App",
					geometry: { x: 0, y: 0, width: 100, height: 100 },
					pid: 123,
					title: "Example",
				},
				role: "push button",
				targetGeometry: { x: 12, y: 22, width: 16, height: 12 },
				url: "https://example.com/action",
			},
		),
		"AI Pointer capture preview was rejected",
	);
	await settleMainLoop();
	assert(view.isCreated, "AI Pointer view was not created");
	view.hide();
	view.dispose();
	assert(view.isCreated === false, "AI Pointer view was not disposed");
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
		"AI Pointer selection preview was unavailable",
	);
	await settleMainLoop();
	overlay.hide();
});

test("AI Pointer preserves a release that arrives before the AGS start request", async () => {
	let captured = "";
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
		readPointer: () => null,
		resolveAccessibility: async () => null,
		resolvePrograms: () => [],
		recognizeOcr: async () => ({ kind: "no-text" }),
		capture: async (_directory, geometry) => {
			captured = `${geometry.x},${geometry.y} ${geometry.width}x${geometry.height}`;
			return {
				kind: "captured",
				capture: { path: "/run/user/1000/ai-pointer/capture-test.png", geometry },
			};
		},
	});
	controller.init();
	try {
		assert(controller.finish({ x: 30, y: 40 }), "release request was rejected");
		assert(controller.start({ x: 10, y: 20 }), "start request was rejected");
		await settleMainLoop();
		assert(captured === "-22,-12 84x84", "release-first geometry was not captured");
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
		showCapture() {
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
				capture: { path: "/run/user/1000/ai-pointer/capture-test.png", geometry },
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

test("AI Pointer waits for the drawing overlay before capture", async () => {
	let captured = false;
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
		showCapture() {
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
		readPointer: () => null,
		resolveAccessibility: async () => null,
		resolvePrograms: () => [],
		recognizeOcr: async () => ({ kind: "no-text" }),
		capture: async (_directory, geometry) => {
			captured = true;
			return {
				kind: "captured",
				capture: { path: "/run/user/1000/ai-pointer/capture-test.png", geometry },
			};
		},
	});
	controller.init();
	try {
		assert(controller.start({ x: 10, y: 20 }), "start request was rejected");
		assert(controller.finish({ x: 30, y: 40 }), "finish request was rejected");
		await settleMainLoop();
		assert(captured === false, "capture started while the drawing was still mapped");
		assert(confirmHidden !== null, "drawing teardown was not requested");
		confirmHidden(true);
		await settleMainLoop();
		assert(captured, "capture did not start after the drawing was removed");
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
		showCapture() {
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
		showCapture() {
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
		readPointer: () => null,
		resolveAccessibility: async () => null,
		resolvePrograms: () => [],
		recognizeOcr: async () => {
			throw new Error("fixture failure");
		},
		capture: async (_directory, geometry) => ({
			kind: "captured",
			capture: { path: "/run/user/1000/ai-pointer/capture-test.png", geometry },
		}),
	});
	controller.init();
	try {
		assert(controller.start({ x: 10, y: 20 }), "start request was rejected");
		assert(controller.finish({ x: 30, y: 40 }), "finish request was rejected");
		await settleMainLoop();
		assert(ocrStates.join(",") === "pending,unavailable", "OCR rejection escaped the workflow");
	} finally {
		controller.teardown();
	}
});

test("AI Pointer captures and presents a confident accessible snap", async () => {
	let captured = "";
	let presentedTarget = "";
	let presentedProgram = "";
	let presentedDiagnostics = 0;
	let ocrInput = "";
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
		showCapture(_capture, accessibility, programs, diagnostics) {
			presentedTarget = `${accessibility?.role}:${accessibility?.name}`;
			presentedProgram = `${programs[0]?.class}:${programs[0]?.pid}`;
			presentedDiagnostics = diagnostics.length;
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
		readPointer: () => null,
		resolveAccessibility: async (_geometry, _stroke, _cancellable, _onProcess, onDiagnostics) => {
			onDiagnostics?.([
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
			]);
			return {
				geometry: { x: 100, y: 200, width: 120, height: 60 },
				metadata: { confidence: 0.9, name: "Submit", role: "push button" },
			};
		},
		resolvePrograms: () => [
			{
				class: "org.wezfurlong.wezterm",
				geometry: { x: 0, y: 0, width: 500, height: 400 },
				pid: 123,
				title: "Terminal",
			},
		],
		recognizeOcr: async (input) => {
			ocrInput = `${input.path}:${input.pixelWidth}x${input.pixelHeight}`;
			return { kind: "text", text: "Local text" };
		},
		capture: async (_directory, geometry) => {
			captured = `${geometry.x},${geometry.y} ${geometry.width}x${geometry.height}`;
			return {
				kind: "captured",
				capture: { path: "/run/user/1000/ai-pointer/capture-test.png", geometry },
			};
		},
	});
	controller.init();
	try {
		assert(controller.start({ x: 10, y: 20 }), "start request was rejected");
		assert(controller.finish({ x: 30, y: 40 }), "finish request was rejected");
		await settleMainLoop();
		assert(captured === "100,200 120x60", "accessible geometry was not captured");
		assert(presentedTarget === "push button:Submit", "accessible metadata was not presented");
		assert(
			presentedProgram === "org.wezfurlong.wezterm:123",
			"coordinate-matched program metadata was not presented",
		);
		assert(presentedDiagnostics === 1, "candidate diagnostics were not presented");
		assert(
			ocrInput === "/run/user/1000/ai-pointer/capture-test.png:20x20",
			"OCR did not reuse the presented capture",
		);
		assert(ocrStates.join(",") === "pending,text", "OCR states were not presented");
	} finally {
		controller.teardown();
	}
});

test("AI Pointer cancellation rejects a pending accessibility result", async () => {
	let captured = false;
	let resolveLookup: (() => void) | null = null;
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
		readPointer: () => null,
		resolveAccessibility: () =>
			new Promise((resolve) => {
				resolveLookup = () => resolve({
					geometry: { x: 100, y: 200, width: 120, height: 60 },
					metadata: { confidence: 0.9, role: "push button" },
				});
			}),
		resolvePrograms: () => [],
		recognizeOcr: async () => ({ kind: "no-text" }),
		capture: async (_directory, geometry) => {
			captured = true;
			return {
				kind: "captured",
				capture: { path: "/run/user/1000/ai-pointer/capture-test.png", geometry },
			};
		},
	});
	controller.init();
	try {
		assert(controller.start({ x: 10, y: 20 }), "start request was rejected");
		assert(controller.finish({ x: 30, y: 40 }), "finish request was rejected");
		await settleMainLoop();
		assert(resolveLookup !== null, "accessibility lookup did not start");
		controller.cancel();
		resolveLookup();
		await settleMainLoop();
		assert(captured === false, "cancelled accessibility geometry was captured");
	} finally {
		controller.teardown();
	}
});
