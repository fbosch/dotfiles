import GLib from "gi://GLib?version=2.0";
import { SimulatedClock } from "xstate";
import { KeyboardSwitcherController } from "@/components/keyboard-switcher/controller";
import { KeyboardSwitcherView } from "@/components/keyboard-switcher/keyboard-switcher-view";
import { createRequestHandler } from "@/components/keyboard-switcher/request-handler";
import { assert, test } from "./harness";

function request(
	handler: (argv: string[], respond: (value: string) => void) => void,
	argv: string[],
): string {
	let response = "";
	handler(argv, (value) => {
		response = value;
	});
	return response;
}

function settleMainLoop(): Promise<void> {
	return new Promise((resolve) => {
		GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1, () => {
			resolve();
			return GLib.SOURCE_REMOVE;
		});
	});
}

test("Keyboard Switcher handles its complete request lifecycle", () => {
	let shown = 0;
	let hiding = 0;
	const controller = new KeyboardSwitcherController({
		createView: () =>
			({
				show() {
					shown += 1;
				},
				beginHide() {
					hiding += 1;
				},
				hide() {},
				dispose() {},
			}) as unknown as KeyboardSwitcherView,
	});
	const handle = createRequestHandler(controller);
	controller.init();
	try {
		assert(request(handle, []) === "ready", "empty request was not ready");
		assert(
			request(handle, ["not-json"]) === "error: invalid JSON",
			"invalid JSON was accepted",
		);
		assert(
			request(handle, [JSON.stringify({ action: "missing" })]) ===
				"unknown action",
			"unknown action was accepted",
		);
		for (const value of ["null", "false", "0", '""'])
			assert(
				request(handle, [value]) === "unknown action",
				`valid JSON ${value} did not receive a response`,
			);
		assert(
			request(handle, [
				JSON.stringify({
					action: "show",
					config: { layouts: ["EN", "DA"], activeLayout: "DA", size: "xl" },
				}),
			]) === "unknown action",
			"invalid size was accepted",
		);
		assert(
			request(handle, [
				JSON.stringify({
					action: "show",
					config: { layouts: ["EN", "DA"], activeLayout: "DE" },
				}),
			]) === "unknown action",
			"unknown active layout was accepted",
		);
		assert(
			request(handle, [
				JSON.stringify({
					action: "show",
					config: { layouts: ["EN", "DA"], activeLayout: "DA", size: "sm" },
				}),
			]) === "shown",
			"show request failed",
		);
		assert(shown === 1, "show did not update the view");
		assert(
			request(handle, [JSON.stringify({ action: "get-visibility" })]) ===
				"visible",
			"visible state was not reported",
		);
		assert(
			request(handle, [JSON.stringify({ action: "hide" })]) === "hidden",
			"hide request failed",
		);
		assert(hiding === 1, "hide did not start the fade");
	} finally {
		controller.teardown();
	}
});

test("Keyboard Switcher view creates, shows, hides, and disposes", async () => {
	const view = new KeyboardSwitcherView();
	view.show({ layouts: ["EN", "DA"], activeLayout: "DA", size: "sm" });
	await settleMainLoop();
	assert(view.isCreated, "keyboard switcher view was not created");
	view.show({ layouts: ["EN", "DA"], activeLayout: "EN", size: "md" });
	view.beginHide();
	view.hide();
	view.dispose();
	assert(view.isCreated === false, "keyboard switcher view was not disposed");
});

test("Keyboard Switcher controller drives delayed view transitions", () => {
	const clock = new SimulatedClock();
	const transitions: string[] = [];
	const controller = new KeyboardSwitcherController({
		clock,
		createView: () =>
			({
				show() {
					transitions.push("show");
				},
				beginHide() {
					transitions.push("begin-hide");
				},
				hide() {
					transitions.push("hide");
				},
				dispose() {
					transitions.push("dispose");
				},
			}) as unknown as KeyboardSwitcherView,
	});
	controller.init();
	transitions.length = 0;
	controller.show({ layouts: ["EN", "DA"], activeLayout: "DA" });
	clock.increment(700);
	clock.increment(60);
	assert(
		transitions.join(",") === "show,begin-hide,hide",
		`unexpected delayed lifecycle: ${transitions.join(",")}`,
	);
	controller.teardown();
});
