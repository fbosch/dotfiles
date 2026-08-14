import GLib from "gi://GLib?version=2.0";
import { SimulatedClock } from "xstate";
import { VolumeIndicatorController } from "../../../components/volume-indicator/controller";
import type { VolumePresentation } from "../../../components/volume-indicator/model";
import { createRequestHandler } from "../../../components/volume-indicator/request-handler";
import { VolumeIndicatorView } from "../../../components/volume-indicator/volume-indicator-view";
import { VolumeSource } from "../../../components/volume-indicator/volume-source";
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

function wait(milliseconds: number): Promise<void> {
	return new Promise((resolve) => {
		GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
			resolve();
			return GLib.SOURCE_REMOVE;
		});
	});
}

test("Volume Indicator handles its complete request lifecycle", async () => {
	let presentation: VolumePresentation | null = null;
	const controller = new VolumeIndicatorController({
		createView: () =>
			({
				show() {},
				hide() {},
				dispose() {},
				setPresentation(next: VolumePresentation) {
					presentation = next;
				},
			}) as unknown as VolumeIndicatorView,
		source: {
			init() {},
			read: () => Promise.resolve({ volume: 42, muted: false }),
			dispose() {},
		} as VolumeSource,
		playSound() {},
	});
	const handle = createRequestHandler(controller);
	controller.init();
	try {
		assert(request(handle, []) === "ok", "empty request response changed");
		assert(
			request(handle, ["not-json"]) === "error: invalid JSON",
			"invalid JSON was accepted",
		);
		for (const value of ["null", "false", "0", '""'])
			assert(
				request(handle, [value]) === "unknown action",
				`valid JSON ${value} did not receive a response`,
			);
		assert(
			request(handle, [JSON.stringify({ action: "show" })]) === "shown",
			"show request failed",
		);
		await Promise.resolve();
		assert(presentation?.volume === 42, "volume presentation was not applied");
		assert(
			request(handle, [JSON.stringify({ action: "get-visibility" })]) ===
				"visible",
			"visible state was not reported",
		);
		assert(
			request(handle, [JSON.stringify({ action: "hide" })]) === "hidden",
			"hide request failed",
		);
	} finally {
		controller.teardown();
	}
});

test("Volume Indicator controller drives delayed view transitions", () => {
	const clock = new SimulatedClock();
	const transitions: string[] = [];
	const controller = new VolumeIndicatorController({
		clock,
		createView: () =>
			({
				show() {
					transitions.push("show");
				},
				hide() {
					transitions.push("hide");
				},
				dispose() {},
				setPresentation() {},
			}) as unknown as VolumeIndicatorView,
		source: {
			init() {},
			read: () => Promise.resolve({ volume: 50, muted: false }),
			dispose() {},
		} as VolumeSource,
	});
	controller.init();
	transitions.length = 0;
	controller.show();
	clock.increment(1500);
	assert(
		transitions.join(",") === "show,hide",
		`unexpected delayed lifecycle: ${transitions.join(",")}`,
	);
	controller.teardown();
});

test("Volume Source coalesces active reads and throttles the next read", async () => {
	let runs = 0;
	const resolvers: Array<(value: string) => void> = [];
	const source = new VolumeSource(
		() =>
			new Promise((resolve) => {
				runs += 1;
				resolvers.push(resolve);
			}),
	);
	const first = source.read();
	const second = source.read();
	assert(first === second, "active volume command was not coalesced");
	assert(runs === 1, "concurrent reads started more than one initial command");
	resolvers[0]?.("Volume: 0.55");
	assert((await first).volume === 55, "initial volume response was not parsed");
	const trailing = source.read();
	assert(runs === 1, "throttled read started before its deadline");
	await wait(35);
	assert(runs === 2, "a trailing volume read was not started");
	resolvers[1]?.("Volume: 0.65");
	assert((await trailing).volume === 65, "throttled volume result was stale");
	assert(runs === 2, "more than one command ran per throttle window");
});

test("Volume Indicator coalesces burst refresh continuations", async () => {
	const resolvers: Array<(info: { volume: number; muted: boolean }) => void> = [];
	let reads = 0;
	let appliedVolume = 0;
	const controller = new VolumeIndicatorController({
		createView: () =>
			({
				show() {},
				hide() {},
				dispose() {},
				setPresentation(presentation: VolumePresentation) {
					appliedVolume = presentation.volume;
				},
			}) as unknown as VolumeIndicatorView,
		source: {
			init() {},
			read: () => {
				reads += 1;
				return new Promise((resolve) => resolvers.push(resolve));
			},
			dispose() {},
		} as VolumeSource,
		playSound() {},
	});
	controller.init();
	controller.show();
	controller.show();
	controller.show();
	assert(reads === 1, "burst requests created concurrent refresh reads");
	resolvers[0]?.({ volume: 40, muted: false });
	await Promise.resolve();
	assert(reads === 2, "burst demand did not schedule one trailing refresh");
	resolvers[1]?.({ volume: 60, muted: false });
	await Promise.resolve();
	assert(appliedVolume === 60, "final burst volume was stale");
	assert(reads === 2, "burst demand created excess refresh continuations");
	controller.teardown();
});

test("Volume Source disposal prevents a queued trailing command", async () => {
	let runs = 0;
	let resolveCommand: ((value: string) => void) | null = null;
	const source = new VolumeSource(
		() =>
			new Promise((resolve) => {
				runs += 1;
				resolveCommand = resolve;
			}),
	);
	const pending = source.read();
	resolveCommand?.("Volume: 0.40");
	await pending;
	const queued = source.read();
	source.dispose();
	await queued;
	await wait(35);
	assert(runs === 1, "disposal allowed a queued volume command to start");
});

test("Volume Source disposal cancels an active command", async () => {
	let cancelled = false;
	const source = new VolumeSource(
		(cancellable) =>
			new Promise((_resolve, reject) => {
				cancellable.connect(() => {
					cancelled = true;
					reject(new Error("cancelled"));
				});
			}),
	);
	const pending = source.read();
	source.dispose();
	await pending;
	assert(cancelled, "active volume command was not cancelled");
});

test("Volume Indicator rejects results from a previous lifecycle", async () => {
	const resolvers: Array<(info: { volume: number; muted: boolean }) => void> = [];
	const applied: number[] = [];
	let reads = 0;
	const controller = new VolumeIndicatorController({
		createView: () =>
			({
				show() {},
				hide() {},
				dispose() {},
				setPresentation(presentation: VolumePresentation) {
					applied.push(presentation.volume);
				},
			}) as unknown as VolumeIndicatorView,
		source: {
			init() {},
			read: () => {
				reads += 1;
				return new Promise((resolve) => resolvers.push(resolve));
			},
			dispose() {},
		} as VolumeSource,
		playSound() {},
	});
	controller.init();
	controller.show();
	controller.teardown();
	controller.init();
	controller.show();
	resolvers[0]?.({ volume: 40, muted: false });
	await Promise.resolve();
	await Promise.resolve();
	assert(reads === 2, "new lifecycle did not start a fresh volume read");
	resolvers[1]?.({ volume: 60, muted: false });
	await Promise.resolve();
	assert(applied.join(",") === "60", "stale lifecycle result reached the view");
	controller.teardown();
});

test("Volume Indicator view creates, renders, hides, and disposes", async () => {
	const view = new VolumeIndicatorView();
	view.show();
	await settleMainLoop();
	assert(view.isCreated, "volume indicator view was not created");
	assert(view.segmentCount === 16, "volume indicator did not render 16 segments");
	view.setPresentation({
		volume: 50,
		muted: false,
		speakerState: "medium",
		icon: "\uE994",
		label: "50%",
		filledSegments: 8,
	});
	view.hide();
	view.dispose();
	assert(view.isCreated === false, "volume indicator view was not disposed");
});
