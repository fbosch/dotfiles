import { describe, expect, test } from "bun:test";
import {
	reconcileAudioSnapshot,
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

describe("reconcileAudioSnapshot", () => {
	test("preserves active row wrappers when GTK rows can be reused", () => {
		const current = snapshot();
		const next = snapshot();
		next.rows.playback[0].object = current.rows.playback[0].object;
		const reconciled = reconcileAudioSnapshot(current, next, "playback");
		expect(reconciled.rows.playback).toBe(current.rows.playback);
	});

	test("accepts changed presentation state", () => {
		const current = snapshot();
		const next = snapshot(75);
		next.rows.playback[0].object = current.rows.playback[0].object;
		const reconciled = reconcileAudioSnapshot(current, next, "playback");
		expect(reconciled.rows.playback).toBe(next.rows.playback);
	});
});
