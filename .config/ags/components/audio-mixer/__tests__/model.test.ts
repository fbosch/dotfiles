import { describe, expect, test } from "bun:test";
import {
	reconcileAudioSnapshot,
	sliderPositionToVolume,
	type AudioSnapshot,
	volumeToSliderPosition,
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

describe("volume slider mapping", () => {
	test("gives lower volume values more slider space", () => {
		expect(sliderPositionToVolume(0.5)).toBeCloseTo(46.17, 2);
		expect(volumeToSliderPosition(46.17)).toBeCloseTo(0.5, 2);
	});

	test("keeps the slider endpoints stable", () => {
		expect(sliderPositionToVolume(0)).toBe(0);
		expect(sliderPositionToVolume(1)).toBe(150);
		expect(volumeToSliderPosition(0)).toBe(0);
		expect(volumeToSliderPosition(150)).toBe(1);
	});
});

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
