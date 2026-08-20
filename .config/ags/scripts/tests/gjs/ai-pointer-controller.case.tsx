import GLib from "gi://GLib?version=2.0";
import { AiPointerController } from "@/components/ai-pointer/controller";
import { AiPointerView } from "@/components/ai-pointer/ai-pointer-view";
import { assert, test } from "./harness";

function settleMainLoop(): Promise<void> {
	return new Promise((resolve) => {
		GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1, () => {
			resolve();
			return GLib.SOURCE_REMOVE;
		});
	});
}

test("AI Pointer keeps the selected-region preview active without a metadata window", async () => {
	let captured = 0;
	let programLookups = 0;
	let previewCalls = 0;
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
			previewCalls += 1;
			return { pixelHeight: 20, pixelWidth: 20 };
		},
		setOcrState() {},
		clearOcr() {},
		hide() {},
		dispose() {},
	} as unknown as AiPointerView;
	const controller = new AiPointerController({
		view,
		prepareDirectory: () => "/run/user/1000/ai-pointer",
		readPointer: () => null,
		resolveAccessibility: async () => null,
		resolvePrograms: () => {
			programLookups += 1;
			return [];
		},
		recognizeOcr: async () => ({ kind: "no-text" }),
		capture: async (_directory, geometry) => {
			captured += 1;
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
		assert(captured === 1, "selection was not captured");
		assert(programLookups === 1, "local context was not resolved");
		assert(previewCalls === 1, "selected-region preview was not shown");
		assert(controller.start({ x: 50, y: 60 }) === false, "selection preview did not remain active");
		controller.cancel();
		assert(controller.start({ x: 50, y: 60 }), "cancelling the preview did not return to idle");
	} finally {
		controller.teardown();
	}
});
