import { describe, expect, test } from "bun:test";
import {
	clickFallbackGeometry,
	clickTargetGeometry,
	grimGeometry,
	maximumSelectionPixels,
	promptPosition,
	selectionFromPoints,
} from "../selection";

describe("selectionFromPoints", () => {
	test("derives a region from signed global points", () => {
		expect(selectionFromPoints({ x: -1920, y: 610 }, { x: -1120, y: 10 })).toEqual({
			x: -1920,
			y: 10,
			width: 800,
			height: 600,
		});
	});

	test("rejects clicks and oversized selections", () => {
		expect(selectionFromPoints({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeNull();
		expect(selectionFromPoints({ x: 0, y: 0 }, { x: maximumSelectionPixels + 1, y: 1 })).toBeNull();
	});

	test("formats validated geometry for grim", () => {
		expect(grimGeometry({ x: -10, y: 20, width: 30, height: 40 })).toBe(
			"-10,20 30x40",
		);
	});
});

describe("promptPosition", () => {
	const monitor = { x: 0, y: 0, width: 1920, height: 1080 };
	const prompt = { width: 460, height: 64 };

	test("centers above the selection when that space is available", () => {
		expect(promptPosition({ x: 800, y: 300, width: 320, height: 240 }, monitor, prompt)).toEqual({
			x: 730,
			y: 212,
		});
	});

	test("uses the space below a selection near the monitor top", () => {
		expect(promptPosition({ x: 100, y: 20, width: 200, height: 100 }, monitor, prompt)).toEqual({
			x: 16,
			y: 144,
		});
	});

	test("uses an available side when the selection fills the monitor height", () => {
		expect(promptPosition({ x: 400, y: 0, width: 500, height: 1080 }, monitor, prompt)).toEqual({
			x: 924,
			y: 508,
		});
	});

	test("preserves signed monitor coordinates", () => {
		const leftMonitor = { x: -1920, y: 0, width: 1920, height: 1080 };
		expect(
			promptPosition({ x: -1500, y: 300, width: 200, height: 100 }, leftMonitor, prompt),
		).toEqual({ x: -1630, y: 212 });
	});
});

describe("click capture geometry", () => {
	const monitor = { x: -1920, y: 0, width: 1920, height: 1080 };

	test("centers a 256 pixel fallback and clamps it to monitor edges", () => {
		expect(clickFallbackGeometry({ x: -1000, y: 500 }, monitor)).toEqual({
			x: -1128,
			y: 372,
			width: 256,
			height: 256,
		});
		expect(clickFallbackGeometry({ x: -1910, y: 10 }, monitor)).toEqual({
			x: -1920,
			y: 0,
			width: 256,
			height: 256,
		});
	});

	test("pads small targets and caps large targets around the click", () => {
		expect(
			clickTargetGeometry(
				{ x: -1000, y: 500 },
				{ x: -1020, y: 490, width: 40, height: 20 },
				monitor,
			),
		).toEqual({ x: -1044, y: 466, width: 88, height: 68 });
		expect(
			clickTargetGeometry(
				{ x: -1000, y: 500 },
				monitor,
				monitor,
			),
		).toEqual({ x: -1192, y: 308, width: 384, height: 384 });
	});
});
