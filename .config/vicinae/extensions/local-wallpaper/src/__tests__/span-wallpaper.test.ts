import assert from "node:assert/strict";
import test from "node:test";
import type { Monitor } from "../types.ts";
import {
	getSpanCrops,
	getSpanCacheKey,
	getSpanWallpaperCommand,
} from "../utils/span-wallpaper.ts";

const monitor = (
	name: string,
	x: number,
	y: number,
	width: number,
	height: number,
	scale = 1,
	transform = 0,
	physicalWidth = width,
	physicalHeight = height,
): Monitor => ({
	id: 0,
	name,
	x,
	y,
	width,
	height,
	physicalWidth,
	physicalHeight,
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

test("getSpanCrops falls back to resolution geometry without physical dimensions", () => {
	const layout = getSpanCrops([
		monitor("DP-1", 0, 0, 3840, 2160, 2, 0, 0, 0),
		monitor("HDMI-A-1", 1920, 0, 1920, 1080, 1, 0, 0, 0),
	]);

	assert.equal(layout.width, 7680);
	assert.equal(layout.height, 2160);
	assert.deepEqual(layout.crops, [
		{ monitor: "DP-1", width: 3840, height: 2160, x: 0, y: 0 },
		{ monitor: "HDMI-A-1", width: 3840, height: 2160, x: 3840, y: 0 },
	]);
});

test("getSpanCrops accounts for scaled and rotated monitor dimensions", () => {
	const layout = getSpanCrops([
		monitor("HDMI-A-2", 0, 0, 2560, 1440, 1, 3),
		monitor("DP-2", 1440, 500, 3840, 2160, 2),
	]);

	assert.equal(layout.width, 5280);
	assert.equal(layout.height, 2660);
	assert.deepEqual(layout.crops, [
		{ monitor: "HDMI-A-2", width: 1440, height: 2560, x: 0, y: 0 },
		{ monitor: "DP-2", width: 3840, height: 2160, x: 1440, y: 500 },
	]);
});

test("getSpanCrops preserves offset placement for a rotated portrait monitor", () => {
	const layout = getSpanCrops([
		monitor("HDMI-A-2", 0, 0, 2560, 1440, 1, 3, 530, 300),
		monitor("DP-2", 1440, 500, 3440, 1440, 1, 0, 800, 340),
	]);

	assert.equal(layout.width, 5313);
	assert.equal(layout.height, 2560);
	assert.deepEqual(layout.crops, [
		{ monitor: "HDMI-A-2", width: 1449, height: 2560, x: 0, y: 0 },
		{ monitor: "DP-2", width: 3864, height: 1642, x: 1449, y: 500 },
	]);
});

test("getSpanWallpaperCommand fits once and crops clones from the virtual top-left", () => {
	assert.deepEqual(
		getSpanWallpaperCommand(
			"/wallpaper.png",
			{
				width: 5313,
				height: 2560,
				crops: [
					{ monitor: "HDMI-A-2", width: 1449, height: 2560, x: 0, y: 0 },
					{ monitor: "DP-2", width: 3864, height: 1642, x: 1449, y: 500 },
				],
			},
			new Map([
				["HDMI-A-2", "/cache/HDMI-A-2.tmp"],
				["DP-2", "/cache/DP-2.tmp"],
			]),
		),
		[
			"/wallpaper.png",
			"-resize",
			"5313x2560^",
			"-gravity",
			"center",
			"-extent",
			"5313x2560",
			"-define",
			"png:compression-level=1",
			"(",
			"+clone",
			"-gravity",
			"northwest",
			"-crop",
			"1449x2560+0+0",
			"+repage",
			"-write",
			"PNG:/cache/HDMI-A-2.tmp",
			"+delete",
			")",
			"(",
			"+clone",
			"-gravity",
			"northwest",
			"-crop",
			"3864x1642+1449+500",
			"+repage",
			"-write",
			"PNG:/cache/DP-2.tmp",
			"+delete",
			")",
			"null:",
		],
	);
});

test("getSpanCacheKey changes with source content and span layout", () => {
	const layout = {
		width: 100,
		height: 100,
		crops: [{ monitor: "DP-1", width: 100, height: 100, x: 0, y: 0 }],
	};

	assert.notEqual(getSpanCacheKey("source-a", layout), getSpanCacheKey("source-b", layout));
	assert.notEqual(
		getSpanCacheKey("source-a", layout),
		getSpanCacheKey("source-a", { ...layout, width: 101 }),
	);
});
