import { describe, expect, test } from "bun:test";
import {
	chooseAccessibleSnap,
	parseAccessibilityHelperOutput,
} from "../accessibility-policy";

const selection = { x: 100, y: 100, width: 200, height: 100 };
const client = { x: 0, y: 0, width: 1_000, height: 800 };

describe("accessible selection snapping", () => {
	test("snaps to one confident candidate with bounded padding", () => {
		const result = chooseAccessibleSnap(selection, [
				{
					geometry: { x: 120, y: 110, width: 160, height: 80 },
					name: "Submit",
					role: "push button",
				},
			], client);

		expect(result?.geometry).toEqual({ x: 108, y: 98, width: 184, height: 104 });
		expect(result?.metadata.name).toBe("Submit");
		expect(result?.metadata.role).toBe("push button");
		expect(result?.metadata.confidence).toBeCloseTo(0.856);
	});

	test("preserves stroke geometry when distinct candidates are ambiguous", () => {
		expect(
			chooseAccessibleSnap(selection, [
				{ geometry: { x: 120, y: 110, width: 160, height: 80 }, role: "push button" },
				{ geometry: { x: 118, y: 108, width: 164, height: 84 }, role: "link" },
			], client),
		).toBeNull();
	});

	test("rejects sensitive, top-level, and generic container roles", () => {
		for (const role of ["password text", "application", "frame", "window", "panel", "section"])
			expect(
				chooseAccessibleSnap(selection, [
					{ geometry: { x: 120, y: 110, width: 160, height: 80 }, role },
				], client),
			).toBeNull();
	});

	test("rejects a small incidental descendant", () => {
		expect(
			chooseAccessibleSnap(selection, [
				{
					geometry: { x: 190, y: 140, width: 20, height: 10 },
					role: "text",
				},
			], client),
		).toBeNull();
	});

	test("rejects snap padding that exceeds capture limits", () => {
		expect(
			chooseAccessibleSnap(
				{ x: 0, y: 0, width: 8_000, height: 4_000 },
				[
					{
						geometry: { x: 0, y: 0, width: 8_000, height: 4_000 },
						role: "image",
					},
				],
				{ x: 0, y: 0, width: 8_000, height: 4_000 },
			),
		).toBeNull();
	});

	test("rejects candidate padding outside a negative-origin client", () => {
		expect(
			chooseAccessibleSnap(
				{ x: -1_000, y: 100, width: 200, height: 100 },
				[
					{
						geometry: { x: -1_000, y: 110, width: 180, height: 80 },
						role: "push button",
					},
				],
				{ x: -1_000, y: 0, width: 1_000, height: 800 },
			),
		).toBeNull();
	});
});

describe("accessibility helper protocol", () => {
	test("accepts only the exact window-coordinate protocol", () => {
		const candidate = {
			geometry: { x: 10, y: 20, width: 100, height: 40 },
			name: "Submit",
			role: "push button",
		};
		expect(
			parseAccessibilityHelperOutput(
				JSON.stringify({ protocolVersion: 1, coordinateSpace: "window", candidates: [candidate] }),
			),
		).toEqual([candidate]);
		for (const response of [
			{ protocolVersion: 2, coordinateSpace: "window", candidates: [] },
			{ protocolVersion: 1, coordinateSpace: "screen", candidates: [] },
			{ coordinateSpace: "window", candidates: [] },
		])
			expect(parseAccessibilityHelperOutput(JSON.stringify(response))).toBeNull();
	});

	test("drops metadata containing control characters", () => {
		expect(
			parseAccessibilityHelperOutput(
				JSON.stringify({
					protocolVersion: 1,
					coordinateSpace: "window",
					candidates: [
						{
							geometry: { x: 10, y: 20, width: 100, height: 40 },
							name: "secret\nvalue",
							role: "text",
						},
					],
				}),
			),
		).toEqual([]);
	});
});
