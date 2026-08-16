import GLib from "gi://GLib?version=2.0";
import { AiPointerController } from "@/components/ai-pointer/controller";
import { AiPointerView } from "@/components/ai-pointer/ai-pointer-view";
import { StrokeOverlay } from "@/components/ai-pointer/stroke-overlay";
import { assert, test } from "./harness";

function settleMainLoop(): Promise<void> {
	return new Promise((resolve) => {
		GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1, () => {
			resolve();
			return GLib.SOURCE_REMOVE;
		});
	});
}

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
	assert(
		overlay.show(
			[
				{ x: 10, y: 10 },
				{ x: 80, y: 80 },
			],
			() => {},
		),
		"AI Pointer stroke overlay was unavailable",
	);
	await settleMainLoop();
	overlay.update([
		{ x: 10, y: 10 },
		{ x: 100, y: 100 },
	]);
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
		assert(captured === "-2,8 44x44", "release-first geometry was not captured");
	} finally {
		controller.teardown();
	}
});
