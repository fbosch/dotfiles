import { describe, expect, test } from "bun:test";
import {
	audioPresentationKey,
	emptySnapshot,
	type AudioSnapshot,
} from "../model";

function snapshot(volume = 50): AudioSnapshot {
	return {
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
					volume,
				},
			],
			output: [],
			input: [],
		},
	};
}

describe("audioPresentationKey", () => {
	test("ignores backend object identity", () => {
		expect(audioPresentationKey(snapshot(), "playback")).toBe(
			audioPresentationKey(snapshot(), "playback"),
		);
	});

	test("changes with visible row state", () => {
		expect(audioPresentationKey(snapshot(), "playback")).not.toBe(
			audioPresentationKey(snapshot(75), "playback"),
		);
	});

	test("includes empty-state status and message", () => {
		expect(audioPresentationKey(emptySnapshot("Loading", "loading"), "input")).not.toBe(
			audioPresentationKey(emptySnapshot("Unavailable", "error"), "input"),
		);
	});
});
