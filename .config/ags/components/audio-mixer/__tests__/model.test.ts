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
	test("uses the stronger low-volume Bézier taper", () => {
		const points = [
			[0.25, 7.6171875],
			[0.5, 32.8125],
			[0.75, 79.1015625],
		] as const;

		for (const [position, volume] of points) {
			expect(sliderPositionToVolume(position)).toBeCloseTo(volume, 6);
			expect(volumeToSliderPosition(volume)).toBeCloseTo(position, 6);
		}
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
