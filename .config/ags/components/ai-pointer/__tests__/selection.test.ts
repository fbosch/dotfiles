import { describe, expect, test } from "bun:test";
import { grimGeometry, maximumSelectionPixels, parseSelectionGeometry } from "../selection";

describe("parseSelectionGeometry", () => {
	test("accepts signed global origins", () => {
		expect(parseSelectionGeometry("-1920,10 800x600\n")).toEqual({
			x: -1920,
			y: 10,
			width: 800,
			height: 600,
		});
	});

	test("rejects malformed and oversized selections", () => {
		expect(parseSelectionGeometry("0,0 0x10\n")).toBeNull();
		expect(parseSelectionGeometry("0,0 10x10 extra\n")).toBeNull();
		expect(parseSelectionGeometry(`0,0 ${maximumSelectionPixels + 1}x1\n`)).toBeNull();
	});

	test("formats validated geometry for grim", () => {
		expect(grimGeometry({ x: -10, y: 20, width: 30, height: 40 })).toBe(
			"-10,20 30x40",
		);
	});
});
