import assert from "node:assert/strict";
import test from "node:test";
import type { Monitor } from "../types.ts";
import { getSpanCrops } from "../utils/span-wallpaper.ts";

const monitor = (
	name: string,
	x: number,
	y: number,
	width: number,
	height: number,
	scale = 1,
	transform = 0,
): Monitor => ({
	id: 0,
	name,
	x,
	y,
	width,
	height,
	scale,
	refreshRate: 60,
	activeWorkspace: { id: 1, name: "1" },
	focused: false,
	dpmsStatus: true,
	transform,
});

test("getSpanCrops normalizes monitor positions into one virtual canvas", () => {
	const layout = getSpanCrops([
		monitor("DP-1", -1920, 0, 1920, 1080),
		monitor("HDMI-A-1", 0, 0, 2560, 1440),
	]);

	assert.equal(layout.width, 4480);
	assert.equal(layout.height, 1440);
	assert.deepEqual(layout.crops, [
		{ monitor: "DP-1", width: 1920, height: 1080, x: 0, y: 0 },
		{ monitor: "HDMI-A-1", width: 2560, height: 1440, x: 1920, y: 0 },
	]);
});

test("getSpanCrops requires more than one monitor", () => {
	assert.throws(() => getSpanCrops([monitor("DP-1", 0, 0, 1920, 1080)]));
});

test("getSpanCrops accounts for scaled and rotated monitor dimensions", () => {
	const layout = getSpanCrops([
		monitor("HDMI-A-2", 0, 0, 2560, 1440, 1, 3),
		monitor("DP-2", 1440, 500, 3840, 2160, 2),
	]);

	assert.equal(layout.width, 6720);
	assert.equal(layout.height, 5120);
	assert.deepEqual(layout.crops, [
		{ monitor: "HDMI-A-2", width: 2880, height: 5120, x: 0, y: 0 },
		{ monitor: "DP-2", width: 3840, height: 2160, x: 2880, y: 1000 },
	]);
});

test("getSpanCrops preserves offset placement for a rotated portrait monitor", () => {
	const layout = getSpanCrops([
		monitor("HDMI-A-2", 0, 0, 2560, 1440, 1, 3),
		monitor("DP-2", 1440, 500, 3440, 1440),
	]);

	assert.equal(layout.width, 4880);
	assert.equal(layout.height, 2560);
	assert.deepEqual(layout.crops, [
		{ monitor: "HDMI-A-2", width: 1440, height: 2560, x: 0, y: 0 },
		{ monitor: "DP-2", width: 3440, height: 1440, x: 1440, y: 500 },
	]);
});
