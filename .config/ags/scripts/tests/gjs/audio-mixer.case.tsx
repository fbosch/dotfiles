import { AudioMixerController } from "../../../components/audio-mixer/controller";
import { AudioMixerView } from "../../../components/audio-mixer/audio-mixer-view";
import {
	emptySnapshot,
	type AudioBackend,
} from "../../../components/audio-mixer/model";
import { createRequestHandler } from "../../../components/audio-mixer/request-handler";
import { assert, test } from "./harness";

function fakeBackend(): AudioBackend {
	return {
		init() {},
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
