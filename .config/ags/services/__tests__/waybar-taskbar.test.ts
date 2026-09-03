import { describe, expect, test } from "bun:test";
import {
	applyWaybarTitleRewrites,
	parseWaybarTitleRewrites,
} from "@/services/waybar-taskbar";

describe("Waybar taskbar title rewrites", () => {
	test("applies rules to the Pango-escaped title and returns plain text", () => {
		const rewrites = parseWaybarTitleRewrites(
			'"^.*Baldur&apos;s Gate 3.*$": "Baldur&apos;s Gate 3"',
		);

		expect(
			applyWaybarTitleRewrites(
				"Baldur's Gate 3 (3440x1440) - (Vulkan) - (6 + 6 WT)",
				rewrites,
			),
		).toBe("Baldur's Gate 3");
	});

	test("preserves an unmatched title", () => {
		const rewrites = parseWaybarTitleRewrites('"Firefox": "Firefox"');

		expect(applyWaybarTitleRewrites("Steam", rewrites)).toBe("Steam");
	});

	test("decodes JSON regular-expression escapes", () => {
		const rewrites = parseWaybarTitleRewrites(
			'"^(\\\\s*)Baldur&apos;s Gate 3.*$": "$1Baldur&apos;s Gate 3"',
		);

		expect(
			applyWaybarTitleRewrites("Baldur's Gate 3 (Vulkan)", rewrites),
		).toBe("Baldur's Gate 3");
	});
});
