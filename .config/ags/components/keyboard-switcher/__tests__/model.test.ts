import { describe, expect, test } from "bun:test";
import {
	calculatedSizes,
	haveSameLayouts,
	isValidLayoutSwitchConfig,
	layoutGeometry,
} from "../model";

describe("keyboard switcher model", () => {
	test("calculates the existing small layout geometry", () => {
		expect(calculatedSizes.sm).toEqual({
			fullBadgeWidth: 74,
			fullBadgeHeight: 28,
			pillOffset: 78,
			innerWidth: 148,
			containerWidth: 156,
			gap: 4,
		});
	});

	test("compares layout order as part of widget identity", () => {
		expect(haveSameLayouts(["EN", "DA"], ["EN", "DA"])).toBe(true);
		expect(haveSameLayouts(["EN", "DA"], ["DA", "EN"])).toBe(false);
		expect(haveSameLayouts(["EN"], ["EN", "DA"])).toBe(false);
	});

	test("supports geometry for every configured layout", () => {
		expect(layoutGeometry("sm", 3)).toEqual({
			innerWidth: 222,
			containerWidth: 230,
			offsets: [0, 78, 156],
		});
	});

	test("requires unique layouts containing the active layout", () => {
		expect(
			isValidLayoutSwitchConfig({
				layouts: ["EN", "DA", "DE"],
				activeLayout: "DE",
			}),
		).toBe(true);
		expect(
			isValidLayoutSwitchConfig({ layouts: [], activeLayout: "EN" }),
		).toBe(false);
		expect(
			isValidLayoutSwitchConfig({
				layouts: ["EN", "EN"],
				activeLayout: "EN",
			}),
		).toBe(false);
		expect(
			isValidLayoutSwitchConfig({ layouts: ["EN"], activeLayout: "DA" }),
		).toBe(false);
		expect(
			isValidLayoutSwitchConfig({
				layouts: Array.from({ length: 9 }, (_, index) => String(index)),
				activeLayout: "0",
			}),
		).toBe(false);
		expect(
			isValidLayoutSwitchConfig({
				layouts: ["WIDE"],
				activeLayout: "WIDE",
			}),
		).toBe(false);
	});
});
