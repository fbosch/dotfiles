import { describe, expect, test } from "bun:test";
import {
	appendStrokePoint,
	createPointerStroke,
	maximumStrokePoints,
	selectionFromStroke,
	strokeCapturePadding,
} from "../stroke";

describe("pointer stroke", () => {
	test("derives padded bounds from a closed stroke instead of its endpoints", () => {
		let stroke = createPointerStroke({ x: 100, y: 100 });
		for (const point of [
			{ x: 200, y: 100 },
			{ x: 200, y: 180 },
			{ x: 100, y: 180 },
			{ x: 101, y: 101 },
		])
			stroke = appendStrokePoint(stroke, point, true);

		expect(selectionFromStroke(stroke)).toEqual({
			x: 100 - strokeCapturePadding,
			y: 100 - strokeCapturePadding,
			width: 100 + strokeCapturePadding * 2,
			height: 80 + strokeCapturePadding * 2,
		});
	});

	test("preserves signed global extrema and sparse samples", () => {
		let stroke = createPointerStroke({ x: -1900, y: 20 });
		stroke = appendStrokePoint(stroke, { x: -1200, y: 620 });
		expect(selectionFromStroke(stroke)).toEqual({
			x: -1924,
			y: -4,
			width: 748,
			height: 648,
		});
	});

	test("bounds retained history without losing capture extrema", () => {
		let stroke = createPointerStroke({ x: 0, y: 0 });
		for (let index = 1; index < maximumStrokePoints * 3; index += 1)
			stroke = appendStrokePoint(stroke, { x: index * 4, y: index * 4 });

		expect(stroke.points.length).toBeLessThanOrEqual(maximumStrokePoints);
		expect(stroke.maxX).toBe((maximumStrokePoints * 3 - 1) * 4);
		expect(stroke.maxY).toBe((maximumStrokePoints * 3 - 1) * 4);
	});

	test("retains extrema from distance-filtered points", () => {
		let stroke = createPointerStroke({ x: 0, y: 0 });
		stroke = appendStrokePoint(stroke, { x: 1, y: 1 });
		expect(stroke.points).toHaveLength(1);
		expect(stroke.maxX).toBe(1);
		expect(stroke.maxY).toBe(1);
	});

	test("creates a minimum-width capture around straight strokes", () => {
		let horizontal = createPointerStroke({ x: 10, y: 20 });
		horizontal = appendStrokePoint(horizontal, { x: 110, y: 20 }, true);
		expect(selectionFromStroke(horizontal)).toEqual({
			x: -14,
			y: -8,
			width: 148,
			height: 56,
		});

		let vertical = createPointerStroke({ x: 10, y: 20 });
		vertical = appendStrokePoint(vertical, { x: 10, y: 120 }, true);
		expect(selectionFromStroke(vertical)).toEqual({
			x: -18,
			y: -4,
			width: 56,
			height: 148,
		});
	});

	test("rejects tiny and oversized strokes", () => {
		let tiny = createPointerStroke({ x: 0, y: 0 });
		tiny = appendStrokePoint(tiny, { x: 7, y: 7 }, true);
		expect(selectionFromStroke(tiny)).toBeNull();

		let oversized = createPointerStroke({ x: 0, y: 0 });
		oversized = appendStrokePoint(oversized, { x: 32_000_000, y: 10 }, true);
		expect(selectionFromStroke(oversized)).toBeNull();
	});
});
