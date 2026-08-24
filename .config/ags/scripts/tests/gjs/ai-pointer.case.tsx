import app from "ags/gtk4/app";
import Gio from "gi://Gio?version=2.0";
import Gdk from "gi://Gdk?version=4.0";
import GLib from "gi://GLib?version=2.0";
import { readBoundedHelperOutput } from "@/components/ai-pointer/accessibility";
import {
	decodeAccessibilityHelperArgument,
	encodeAccessibilityHelperArgument,
} from "@/components/ai-pointer/accessibility/helper-argument";
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
				regionKind: "box",
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
		regionKind: "box",
		reason: "helper incomplete",
	});
	await settleMainLoop();
	assert(
		app.get_window("ai-pointer-ags-ai-pointer-selection-preview-0") === previewWindow,
		"AI Pointer accessibility diagnostics recreated the preview window",
	);
	overlay.hide();
});
