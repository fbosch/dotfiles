import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { readBoundedHelperOutput } from "@/components/ai-pointer/accessibility";
import { AiPointerController } from "@/components/ai-pointer/controller";
import { AiPointerView } from "@/components/ai-pointer/ai-pointer-view";
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
	const expected = '{"protocolVersion":1,"coordinateSpace":"window","candidates":[]}';
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

test("AI Pointer view presents a capture and disposes", async () => {
	const view = new AiPointerView();
	view.create({ onCancel() {} });
	const capturePath = GLib.canonicalize_filename(
		"../../../components/ai-pointer/__tests__/capture.svg",
		GLib.get_current_dir(),
	);
	assert(
		view.showCapture({
			path: capturePath,
			geometry: { x: 10, y: 20, width: 20, height: 20 },
		}),
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
			return true;
		},
		showError() {},
		hide() {},
		dispose() {},
	} as unknown as AiPointerView;
	const controller = new AiPointerController({
		view,
		prepareDirectory: () => "/run/user/1000/ai-pointer",
		readPointer: () => null,
		resolveAccessibility: async () => null,
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
		assert(captured === "-14,-4 68x68", "release-first geometry was not captured");
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
			return true;
		},
		showError() {},
		hide() {},
		dispose() {},
	} as unknown as AiPointerView;
	const controller = new AiPointerController({
		view,
		prepareDirectory: () => "/run/user/1000/ai-pointer",
		readPointer: () => null,
		resolveAccessibility: async () => null,
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

test("AI Pointer captures and presents a confident accessible snap", async () => {
	let captured = "";
	let presentedTarget = "";
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
		showCapture(_capture, accessibility) {
			presentedTarget = `${accessibility?.role}:${accessibility?.name}`;
			return true;
		},
		showError() {},
		hide() {},
		dispose() {},
	} as unknown as AiPointerView;
	const controller = new AiPointerController({
		view,
		prepareDirectory: () => "/run/user/1000/ai-pointer",
		readPointer: () => null,
		resolveAccessibility: async () => ({
			geometry: { x: 100, y: 200, width: 120, height: 60 },
			metadata: { confidence: 0.9, name: "Submit", role: "push button" },
		}),
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
			return true;
		},
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
