import { describe, expect, test } from "bun:test";
import {
	reconcileAudioSnapshot,
	meterSegments,
	snapToNormalVolume,
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
	test("curves the normal range and keeps amplification linear", () => {
		const points = [
			[0.25, 37.79296875],
			[0.5, 74.53125],
			[8 / meterSegments, 100],
			[0.75, 112.5],
		] as const;

		for (const [position, volume] of points) {
			expect(sliderPositionToVolume(position)).toBeCloseTo(volume, 6);
			expect(volumeToSliderPosition(volume)).toBeCloseTo(position, 6);
		}
	});

	test("snaps adjustments within two percentage points of normal volume", () => {
		expect(snapToNormalVolume(98)).toBe(100);
		expect(snapToNormalVolume(102)).toBe(100);
		expect(snapToNormalVolume(97.99)).toBe(97.99);
		expect(snapToNormalVolume(102.01)).toBe(102.01);
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
