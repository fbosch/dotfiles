import { describe, expect, test } from "bun:test";
import { grimGeometry, maximumSelectionPixels, selectionFromPoints } from "../selection";

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
