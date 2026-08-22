import { describe, expect, test } from "bun:test";
import { pointInStrokeRegion } from "../../stroke";
import { accessibilitySelectionRegion } from "../box-region";

describe("accessibility selection region", () => {
	test("uses the final drag box instead of the drawn path", () => {
		const region = accessibilitySelectionRegion(
			{ x: 68, y: 68, width: 264, height: 294 },
			{
				points: [
					{ x: 100, y: 100 },
					{ x: 100, y: 330 },
					{ x: 300, y: 330 },
					{ x: 300, y: 100 },
				],
				radius: 32,
			},
		);

		expect(region.kind).toBe("closed");
		expect(pointInStrokeRegion(region, { x: 200, y: 180 })).toBe(true);
		expect(pointInStrokeRegion(region, { x: 350, y: 180 })).toBe(false);
	});

	test("keeps click lookup at the exact pointer point", () => {
		const point = { x: 200, y: 150 };
		const region = accessibilitySelectionRegion(
			{ ...point, width: 1, height: 1 },
			{ points: [point, point], radius: 32 },
		);

		expect(region.kind).toBe("corridor");
		expect(pointInStrokeRegion(region, point)).toBe(true);
	});
});
