import { AudioMixerController } from "@/components/audio-mixer/controller";
import { AudioMixerView } from "@/components/audio-mixer/audio-mixer-view";
import GLib from "gi://GLib?version=2.0";
import {
	emptySnapshot,
	type AudioBackend,
} from "@/components/audio-mixer/model";
import { createRequestHandler } from "@/components/audio-mixer/request-handler";
import { assert, test } from "./harness";

function fakeBackend(): AudioBackend {
	return {
		init() {},
		setActive() {},
		refresh() {},
		stop() {},
		setVolume() {},
		toggleMute() {},
		setDefault() {},
	};
}

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

test("Audio Mixer handles its complete request lifecycle", () => {
	const controller = new AudioMixerController({
		createBackend: () => fakeBackend(),
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
		assert(
			request(handle, [
				JSON.stringify({ action: "set-tab", tab: "missing" }),
			]) === "unknown action",
			"invalid tab was accepted",
		);
		assert(
			request(handle, [JSON.stringify({ action: "is-visible" })]) === "false",
			"mixer started visible",
		);
		assert(
			request(handle, [
				JSON.stringify({
					action: "prepare",
					source: "waybar:pulseaudio",
				}),
			]) === "preparing",
			"prepare request failed",
		);
		assert(
			request(handle, [
				JSON.stringify({ action: "release", source: "waybar:pulseaudio" }),
			]) === "released",
			"release request failed",
		);
		assert(
			request(handle, [JSON.stringify({ action: "show" })]) === "shown",
			"show request failed",
		);
		assert(
			request(handle, [JSON.stringify({ action: "set-tab", tab: "input" })]) ===
				"ok",
			"set-tab request failed",
		);
		assert(
			request(handle, [JSON.stringify({ action: "toggle" })]) === "hidden",
			"toggle request failed",
		);
		assert(
			request(handle, [JSON.stringify({ action: "toggle" })]) === "shown",
			"rapid toggle request was ignored",
		);
		assert(
			request(handle, [JSON.stringify({ action: "hide" })]) === "hidden",
			"hide request failed",
		);
	} finally {
		controller.teardown();
	}
});

test("Audio Mixer view creates, renders, switches tabs, hides, and disposes", () => {
	const backend = fakeBackend();
	const view = new AudioMixerView(
		{
			onHide() {},
			isVisible: () => true,
			onSetVolume: backend.setVolume,
			onToggleMute: backend.toggleMute,
			onSetDefault: backend.setDefault,
		},
		emptySnapshot("", "loading"),
	);
	view.create();
	assert(view.isCreated, "view was not created");
	view.setSnapshot({
		status: "ready",
		message: "",
		rows: {
			playback: [
				{
					id: "stream:1",
					name: "Player",
					icon: "",
					kind: "stream",
					tab: "playback",
					object: {},
					volume: 50,
				},
			],
			output: [],
			input: [],
		},
	});
	view.setTab("output");
	view.show();
	view.hide();
	view.dispose();
	assert(view.isCreated === false, "view was not disposed");
});

test("Audio Mixer prepares its view and defers Waybar signaling", async () => {
	let creates = 0;
	let shows = 0;
	let signals = 0;
	let applySnapshot = (_snapshot: ReturnType<typeof emptySnapshot>) => {};
	const view = {
		create: () => {
			creates += 1;
		},
		show: () => {
			shows += 1;
		},
		hide() {},
		setSnapshot() {},
		setTab() {},
		dispose() {},
	} as unknown as AudioMixerView;
	const controller = new AudioMixerController({
		createBackend: (nextSnapshot) => {
			applySnapshot = nextSnapshot;
			return fakeBackend();
		},
		createView: () => view,
		signalWaybar: () => {
			signals += 1;
		},
	});
	controller.init();
	try {
		assert(creates === 0, "view was created before the mixer was shown");
		controller.show();
		assert(shows === 0, "view was shown before backend data was ready");
		applySnapshot(emptySnapshot("", "ready"));
		assert(shows === 1, "view was not shown on demand");
		assert(signals === 0, "Waybar signaling blocked the show request");
		await flushIdle();
		assert(signals === 1, "deferred Waybar signal did not run");

		controller.hide();
		controller.show();
		controller.hide();
		await flushIdle();
		assert(signals === 1, "hide did not cancel deferred Waybar signaling");

		controller.show();
		controller.teardown();
		await flushIdle();
		assert(signals === 1, "teardown did not cancel deferred Waybar signaling");
	} finally {
		controller.teardown();
	}
});

test("Audio Mixer waits for backend data before its first presentation", () => {
	let applySnapshot = (_snapshot: ReturnType<typeof emptySnapshot>) => {};
	let shows = 0;
	const backend = fakeBackend();
	const view = {
		create() {},
		show: () => {
			shows += 1;
		},
		hide() {},
		setSnapshot() {},
		setTab() {},
		dispose() {},
	} as unknown as AudioMixerView;
	const controller = new AudioMixerController({
		createBackend: (nextSnapshot) => {
			applySnapshot = nextSnapshot;
			return backend;
		},
		createView: () => view,
		signalWaybar: () => {},
	});

	controller.init();
	try {
		controller.show();
		assert(shows === 0, "mixer presented its placeholder before backend data");
		applySnapshot(emptySnapshot("", "loading"));
		assert(shows === 0, "mixer presented its loading snapshot");
		applySnapshot(emptySnapshot("", "ready"));
		assert(shows === 1, "mixer did not present its first ready snapshot");
		controller.hide();
		controller.show();
		assert(shows === 2, "warm mixer presentation was delayed");
	} finally {
		controller.teardown();
	}
});

test("Audio Mixer scopes backend refresh work to its visible lifecycle", () => {
	const events: string[] = [];
	const backend: AudioBackend = {
		init: () => events.push("init"),
		setActive: (active) => events.push(`active:${active}`),
		refresh: () => events.push("refresh"),
		stop: () => events.push("stop"),
		setVolume() {},
		toggleMute() {},
		setDefault() {},
	};
	const view = {
		create() {},
		show() {},
		hide() {},
		setSnapshot() {},
		setTab() {},
		dispose() {},
	} as unknown as AudioMixerView;
	const controller = new AudioMixerController({
		createBackend: () => backend,
		createView: () => view,
		signalWaybar: () => {},
	});

	controller.init();
	controller.show();
	controller.hide();
	controller.teardown();

	assert(
		events.join(",") === "active:true,init,active:false,stop",
		"backend work did not follow visibility",
	);
});

test("Audio Mixer prepares its backend without presenting the view", () => {
	const events: string[] = [];
	let shows = 0;
	const backend: AudioBackend = {
		init: () => events.push("init"),
		setActive: (active) => events.push(`active:${active}`),
		refresh: () => events.push("refresh"),
		stop: () => events.push("stop"),
		setVolume() {},
		toggleMute() {},
		setDefault() {},
	};
	const view = {
		create() {},
		show: () => {
			shows += 1;
		},
		hide() {},
		setSnapshot() {},
		setTab() {},
		dispose() {},
	} as unknown as AudioMixerView;
	const controller = new AudioMixerController({
		createBackend: () => backend,
		createView: () => view,
		signalWaybar: () => {},
	});

	controller.init();
	controller.prepare("waybar:pulseaudio");
	controller.prepare("waybar:pulseaudio");
	assert(shows === 0, "preparation presented the mixer");
	assert(
		events.join(",") === "active:true,init",
		"preparation did not initialize the backend exactly once",
	);
	controller.release("waybar:pulseaudio");
	assert(
		events.join(",") === "active:true,init,active:false",
		"release did not suspend the hidden backend",
	);
	controller.teardown();
});

function flushIdle(): Promise<void> {
	return new Promise((resolve) => {
		GLib.idle_add(GLib.PRIORITY_LOW, () => {
			resolve();
			return GLib.SOURCE_REMOVE;
		});
	});
}
