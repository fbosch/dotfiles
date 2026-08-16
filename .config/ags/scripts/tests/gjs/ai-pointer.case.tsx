import GLib from "gi://GLib?version=2.0";
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

test("AI Pointer view presents an unavailable state and disposes", async () => {
	const view = new AiPointerView();
	view.create({ onCancel() {} });
	view.showError("slurp is unavailable.");
	await settleMainLoop();
	assert(view.isCreated, "AI Pointer view was not created");
	view.hide();
	view.dispose();
	assert(view.isCreated === false, "AI Pointer view was not disposed");
});
