import { describe, expect, test } from "bun:test";
import {
	appendStrokePoint,
	bsplineStrokeSegments,
	createPointerStroke,
	maximumStrokePoints,
	representativeStrokePoints,
	resampledStrokePoints,
	selectionFromStroke,
	strokeCapturePadding,
	subdivideStrokeSegments,
	temporalTrailFade,
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
			x: -1932,
			y: -12,
			width: 764,
			height: 664,
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

	test("spatially resamples uneven input while preserving endpoints", () => {
		expect(
			resampledStrokePoints([
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
				{ x: 10, y: 10 },
			], 4),
		).toEqual([
			{ x: 0, y: 0 },
			{ x: 4, y: 0 },
			{ x: 8, y: 0 },
			{ x: 10, y: 2 },
			{ x: 10, y: 6 },
			{ x: 10, y: 10 },
		]);
	});

	test("selects representative accessibility samples by path distance", () => {
		expect(
			representativeStrokePoints([
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
				{ x: 10, y: 10 },
			], 3),
		).toEqual([
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 10 },
		]);
	});

	test("builds finite B-spline curves through the exact path endpoints", () => {
		const segments = bsplineStrokeSegments([
			{ x: 0, y: 0 },
			{ x: 4, y: 0 },
			{ x: 8, y: 4 },
			{ x: 12, y: 4 },
		]);

		expect(segments[0].start).toEqual({ x: 0, y: 0 });
		expect(segments.at(-1)?.end).toEqual({ x: 12, y: 4 });
		expect(
			segments.every((segment) =>
				Object.values(segment).every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
			),
		).toBeTrue();
	});

	test("keeps a straight B-spline path straight", () => {
		const segments = bsplineStrokeSegments([
			{ x: 0, y: 5 },
			{ x: 4, y: 5 },
			{ x: 8, y: 5 },
		]);

		expect(
			segments.every(({ control1, control2 }) => control1.y === 5 && control2.y === 5),
		).toBeTrue();
	});

	test("smooths noisy interior controls without moving endpoints", () => {
		const points = Array.from({ length: 12 }, (_, index) => ({
			x: index * 2,
			y: index % 2 === 0 ? -1 : 1,
		}));
		const segments = bsplineStrokeSegments(points);

		expect(segments[0].start).toEqual(points[0]);
		expect(segments.at(-1)?.end).toEqual(points.at(-1));
		expect(
			Math.max(...segments.slice(2, -2).map(({ end }) => Math.abs(end.y))),
		).toBeLessThan(1);
	});

	test("subdivides a curve without changing endpoints or continuity", () => {
		const segment = bsplineStrokeSegments([
			{ x: 0, y: 0 },
			{ x: 20, y: 20 },
		]).at(1)!;
		const subdivided = subdivideStrokeSegments([segment]);

		expect(subdivided).toHaveLength(4);
		expect(subdivided[0].start).toEqual(segment.start);
		expect(subdivided.at(-1)?.end).toEqual(segment.end);
		for (let index = 1; index < subdivided.length; index += 1)
			expect(subdivided[index].start).toEqual(subdivided[index - 1].end);
	});

	test("fades trail segments smoothly over their bounded lifetime", () => {
		expect(temporalTrailFade(0, 1_400)).toBe(1);
		expect(temporalTrailFade(700, 1_400)).toBe(0.5);
		expect(temporalTrailFade(1_400, 1_400)).toBe(0);
		expect(temporalTrailFade(100, 0)).toBe(0);
	});

	test("creates a minimum-width capture around straight strokes", () => {
		let horizontal = createPointerStroke({ x: 10, y: 20 });
		horizontal = appendStrokePoint(horizontal, { x: 110, y: 20 }, true);
		expect(selectionFromStroke(horizontal)).toEqual({
			x: -22,
			y: -16,
			width: 164,
			height: 72,
		});

		let vertical = createPointerStroke({ x: 10, y: 20 });
		vertical = appendStrokePoint(vertical, { x: 10, y: 120 }, true);
		expect(selectionFromStroke(vertical)).toEqual({
			x: -26,
			y: -12,
			width: 72,
			height: 164,
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
