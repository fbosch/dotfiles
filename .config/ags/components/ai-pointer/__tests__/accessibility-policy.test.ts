import { describe, expect, test } from "bun:test";
import {
	chooseAccessibleSnap,
	evaluateAccessibleSnap,
	parseAccessibilityHelperOutput,
} from "../accessibility-policy";
import { evaluateAccessibleClick } from "../click-policy";

const selection = { x: 100, y: 100, width: 200, height: 100 };
const client = { x: 0, y: 0, width: 1_000, height: 800 };
const helperTimings = {
	initialization: { startMs: 1, durationMs: 1 },
	applicationDiscovery: { startMs: 2, durationMs: 1 },
	windowMatching: { startMs: 3, durationMs: 1 },
	hitTesting: { startMs: 4, durationMs: 1 },
	ancestorTraversal: { startMs: 5, durationMs: 1 },
	candidateInspection: { startMs: 6, durationMs: 1 },
	serialization: { startMs: 7, durationMs: 1 },
};

function helperOutput(candidates: unknown[]) {
	return {
		protocolVersion: 6,
		coordinateSpace: "window",
		candidates,
		complete: true,
		timings: helperTimings,
	};
}

describe("accessible click targeting", () => {
	test("prefers the smallest actionable element at the exact point", () => {
		const evaluation = evaluateAccessibleClick({ x: 200, y: 150 }, [
			{
				centerHit: true,
				geometry: { x: 190, y: 145, width: 20, height: 10 },
				name: "Button label",
				role: "text",
			},
			{
				centerHit: true,
				geometry: { x: 150, y: 120, width: 100, height: 60 },
				name: "Submit",
				role: "push button",
			},
		], client, client);

		expect(evaluation.resolution?.geometry).toEqual({ x: 126, y: 96, width: 148, height: 108 });
		expect(evaluation.resolution?.metadata.name).toBe("Submit");
		expect(evaluation.diagnostics[0]).toMatchObject({ name: "Submit", selected: true });
	});

	test("rejects nearby candidates that do not contain the click", () => {
		const evaluation = evaluateAccessibleClick({ x: 200, y: 150 }, [
			{
				centerHit: false,
				geometry: { x: 205, y: 145, width: 20, height: 20 },
				role: "push button",
			},
		], client, client);

		expect(evaluation.resolution).toBeNull();
		expect(evaluation.diagnostics[0].reason).toBe("not at click");
	});

	test("bounds diagnostics for the maximum click candidate set", () => {
		const candidates = Array.from({ length: 24 }, (_, index) => ({
			centerHit: true,
			geometry: {
				height: 20 + index * 2,
				width: 40 + index * 4,
				x: 200 - Math.floor((40 + index * 4) / 2),
				y: 150 - Math.floor((20 + index * 2) / 2),
			},
			role: index === 0 ? "push button" : index % 2 === 0 ? "link" : "text",
		}));
		const evaluation = evaluateAccessibleClick(
			{ x: 200, y: 150 },
			candidates,
			client,
			client,
		);

		expect(evaluation.resolution?.metadata.role).toBe("push button");
		expect(evaluation.diagnostics).toHaveLength(12);
		expect(evaluation.diagnostics[0].selected).toBe(true);
	});
});

describe("accessible selection snapping", () => {
	test("bounds diagnostics for the maximum drag candidate set", () => {
		const candidates = Array.from({ length: 24 }, (_, index) => ({
			geometry: {
				height: 50,
				width: 80,
				x: 110 + (index % 6) * 30,
				y: 110 + Math.floor(index / 6) * 18,
			},
			role: "text",
		}));
		const evaluation = evaluateAccessibleSnap(selection, candidates, client);

		expect(evaluation.diagnostics).toHaveLength(12);
		expect(evaluation.diagnostics.every(({ reason }) => reason === "eligible")).toBe(true);
	});

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
		for (const role of ["password text", "application", "frame", "window", "panel", "landmark"])
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

	test("snaps a browser card when the gesture covers its visual thumbnail", () => {
		const result = chooseAccessibleSnap(
			{ x: 700, y: 970, width: 400, height: 260 },
			[
				{
					geometry: { x: 772, y: 966, width: 412, height: 311 },
					role: "section",
				},
			],
			{ x: 0, y: 0, width: 1_716, height: 1_428 },
		);

		expect(result?.geometry).toEqual({ x: 760, y: 954, width: 436, height: 335 });
	});

	test("expands a partial selection to one bounded target", () => {
		const result = chooseAccessibleSnap(
			{ x: 100, y: 100, width: 100, height: 50 },
			[
				{
					geometry: { x: 80, y: 90, width: 160, height: 80 },
					hitCount: 9,
					role: "article",
				},
			],
			{ x: 0, y: 0, width: 500, height: 400 },
		);

		expect(result?.geometry).toEqual({ x: 68, y: 78, width: 184, height: 104 });
	});

	test("prefers a repeatedly hit common ancestor over separate children", () => {
		const result = chooseAccessibleSnap(
			{ x: 100, y: 100, width: 300, height: 100 },
			[
				{
					geometry: { x: 110, y: 110, width: 120, height: 80 },
					hitCount: 3,
					role: "link",
				},
				{
					geometry: { x: 270, y: 110, width: 120, height: 80 },
					hitCount: 3,
					role: "link",
				},
				{
					geometry: { x: 50, y: 80, width: 450, height: 160 },
					hitCount: 9,
					role: "section",
				},
			],
			{ x: 0, y: 0, width: 600, height: 400 },
		);

		expect(result?.geometry).toEqual({ x: 38, y: 68, width: 474, height: 184 });
	});

	test("expands to a bounded collection of distinct targets", () => {
		const result = chooseAccessibleSnap(
			{ x: 100, y: 100, width: 300, height: 100 },
			[
				{
					geometry: { x: 110, y: 110, width: 120, height: 80 },
					hitCount: 3,
					name: "Previous",
					role: "push button",
				},
				{
					geometry: { x: 270, y: 110, width: 120, height: 80 },
					hitCount: 3,
					name: "Next",
					role: "push button",
				},
			],
			{ x: 0, y: 0, width: 600, height: 400 },
		);

		expect(result?.geometry).toEqual({ x: 98, y: 98, width: 304, height: 104 });
		expect(result?.metadata.role).toBe("collection");
		expect(result?.metadata.targets?.map(({ name }) => name).sort()).toEqual(["Next", "Previous"]);
	});

	test("expands to a named common ancestor larger than the partial gesture", () => {
		const result = chooseAccessibleSnap(
			{ x: 700, y: 400, width: 500, height: 350 },
			[
				{
					geometry: { x: 24, y: 76, width: 1_557, height: 876 },
					hitCount: 9,
					name: "YouTube Video Player",
					role: "section",
				},
			],
			{ x: 0, y: 0, width: 2_294, height: 1_428 },
		);

		expect(result?.geometry).toEqual({ x: 12, y: 64, width: 1_581, height: 900 });
	});

	test("selects an entire image when the gesture center is inside it", () => {
		const result = chooseAccessibleSnap(
			{ x: 400, y: 300, width: 80, height: 60 },
			[
				{
					centerHit: true,
					geometry: { x: 100, y: 100, width: 900, height: 600 },
					hitCount: 9,
					name: "Product photo",
					role: "image",
				},
			],
			{ x: 0, y: 0, width: 1_200, height: 900 },
		);

		expect(result?.geometry).toEqual({ x: 88, y: 88, width: 924, height: 624 });
	});

	test("uses capture padding when the gesture center is near a direct target", () => {
		const result = chooseAccessibleSnap(
			selection,
			[
				{
					centerHit: false,
					geometry: { x: 220, y: 120, width: 40, height: 60 },
					role: "link",
				},
			],
			client,
		);

		expect(result?.geometry).toEqual({ x: 208, y: 108, width: 64, height: 84 });
	});

	test("prefers actual center evidence over a nearby direct target", () => {
		const result = chooseAccessibleSnap(
			selection,
			[
				{
					centerHit: false,
					geometry: { x: 220, y: 120, width: 40, height: 60 },
					name: "Nearby link",
					role: "link",
				},
				{
					centerHit: true,
					geometry: { x: 120, y: 110, width: 160, height: 80 },
					name: "Submit",
					role: "push button",
				},
			],
			client,
		);

		expect(result?.metadata.role).toBe("push button");
		expect(result?.geometry).toEqual({ x: 108, y: 98, width: 184, height: 104 });
	});

	test("preserves stroke geometry when nearby direct targets are ambiguous", () => {
		expect(
			chooseAccessibleSnap(
				selection,
				[
					{
						centerHit: false,
						geometry: { x: 220, y: 120, width: 40, height: 60 },
						role: "link",
					},
					{
						centerHit: false,
						geometry: { x: 219, y: 119, width: 42, height: 62 },
						role: "link",
					},
				],
				client,
			),
		).toBeNull();
	});

	test("prefers an eligible control over a same-geometry label", () => {
		for (const candidates of [
			[
				{
					geometry: { x: 120, y: 110, width: 160, height: 80 },
					hitCount: 9,
					name: "Submit",
					role: "label",
				},
				{
					geometry: { x: 120, y: 110, width: 160, height: 80 },
					hitCount: 9,
					name: "Submit",
					role: "push button",
				},
			],
		].flatMap((candidates) => [candidates, [...candidates].reverse()])) {
			const result = chooseAccessibleSnap(selection, candidates, client);
			expect(result?.metadata.role).toBe("push button");
			expect(result?.geometry).toEqual({ x: 108, y: 98, width: 184, height: 104 });
		}
	});

	test("reports selected and rejected candidates for local diagnostics", () => {
		const evaluation = evaluateAccessibleSnap(selection, [
			{
				geometry: { x: 120, y: 110, width: 160, height: 80 },
				name: "Submit",
				role: "push button",
			},
			{
				geometry: { x: 180, y: 140, width: 40, height: 20 },
				name: "Label",
				role: "label",
			},
		], client);

		expect(evaluation.diagnostics[0]).toMatchObject({
			name: "Submit",
			reason: "eligible",
			selected: true,
		});
		expect(evaluation.diagnostics[1]).toMatchObject({
			name: "Label",
			reason: "ineligible role",
			selected: false,
		});
	});

	test("fuzzily ranks a regular target near the gesture center", () => {
		const result = chooseAccessibleSnap(
			selection,
			[
				{
					geometry: { x: 220, y: 120, width: 40, height: 60 },
					role: "push button",
				},
			],
			client,
		);

		expect(result?.geometry).toEqual({ x: 208, y: 108, width: 64, height: 84 });
	});

	test("rejects a direct target beyond the fuzzy capture boundary", () => {
		expect(
			chooseAccessibleSnap(
				selection,
				[
					{
						centerHit: false,
						geometry: { x: 325, y: 120, width: 40, height: 60 },
						role: "link",
					},
				],
				client,
			),
		).toBeNull();
	});

	test("prefers an enclosing link over its directly hit image", () => {
		const result = chooseAccessibleSnap(
			{ x: 400, y: 300, width: 80, height: 60 },
			[
				{
					centerHit: true,
					geometry: { x: 80, y: 80, width: 960, height: 660 },
					hitCount: 9,
					role: "link",
				},
				{
					centerHit: true,
					geometry: { x: 100, y: 100, width: 900, height: 600 },
					hitCount: 9,
					role: "image",
				},
			],
			{ x: 0, y: 0, width: 1_200, height: 900 },
		);

		expect(result?.metadata.role).toBe("link");
		expect(result?.geometry).toEqual({ x: 68, y: 68, width: 984, height: 684 });
	});

	test("prefers the center-hit link whose bounds match the drawn row", () => {
		const result = chooseAccessibleSnap(
			{ x: 100, y: 100, width: 300, height: 100 },
			[
				{
					centerHit: true,
					geometry: { x: 150, y: 120, width: 90, height: 24 },
					name: "Project name",
					role: "link",
				},
				{
					centerHit: true,
					geometry: { x: 100, y: 100, width: 300, height: 100 },
					name: "Project row",
					role: "link",
				},
			],
			client,
		);

		expect(result?.metadata.name).toBe("Project row");
		expect(result?.geometry).toEqual({ x: 88, y: 88, width: 324, height: 124 });
	});

	test("prefers a repeatedly hit list item over its nested title link", () => {
		const result = chooseAccessibleSnap(
			{ x: 100, y: 100, width: 300, height: 100 },
			[
				{
					centerHit: true,
					geometry: { x: 150, y: 120, width: 90, height: 24 },
					hitCount: 3,
					name: "Project name",
					role: "link",
				},
				{
					centerHit: true,
					geometry: { x: 100, y: 100, width: 300, height: 100 },
					hitCount: 7,
					name: "Project row",
					role: "list item",
				},
			],
			client,
		);

		expect(result?.metadata.role).toBe("list item");
		expect(result?.geometry).toEqual({ x: 88, y: 88, width: 324, height: 124 });
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
				JSON.stringify(helperOutput([candidate])),
			),
		).toEqual({ candidates: [candidate], complete: true, timings: helperTimings });
		for (const response of [
			{ ...helperOutput([]), protocolVersion: 4 },
			{ ...helperOutput([]), protocolVersion: 5 },
			{ ...helperOutput([]), coordinateSpace: "screen" },
			{ ...helperOutput([]), complete: "yes" },
			{ coordinateSpace: "window", candidates: [] },
		])
			expect(parseAccessibilityHelperOutput(JSON.stringify(response))).toBeNull();
		expect(
			parseAccessibilityHelperOutput(JSON.stringify({ ...helperOutput([]), complete: false })),
		).toEqual({ candidates: [], complete: false, timings: helperTimings });
	});

	test("rejects metadata containing control characters", () => {
		expect(
			parseAccessibilityHelperOutput(
				JSON.stringify(helperOutput([
					{
						geometry: { x: 10, y: 20, width: 100, height: 40 },
						name: "secret\nvalue",
						role: "text",
					},
				])),
			),
		).toBeNull();
	});

	test("accepts only bounded web URLs", () => {
		const candidate = {
			geometry: { x: 10, y: 20, width: 100, height: 40 },
			role: "link",
		};
		expect(
			parseAccessibilityHelperOutput(
				JSON.stringify(helperOutput([{ ...candidate, url: "https://example.com/item?id=1" }])),
			),
		).toEqual({
			candidates: [{
				...candidate,
				centerHit: undefined,
				hitCount: undefined,
				name: undefined,
				url: "https://example.com/item?id=1",
			}],
			complete: true,
			timings: helperTimings,
		});
		for (const url of ["javascript:alert(1)", "file:///etc/passwd", "https://example.com/unsafe value"])
			expect(
				parseAccessibilityHelperOutput(JSON.stringify(helperOutput([{ ...candidate, url }]))),
			).toBeNull();
	});

	test("rejects malformed or excessive helper timings", () => {
		for (const timing of [
			{ startMs: -1, durationMs: 1 },
			{ startMs: 1, durationMs: -1 },
			{ startMs: 1, durationMs: 901 },
			{ startMs: Number.NaN, durationMs: 1 },
		]) {
			const output = helperOutput([]);
			output.timings = { ...helperTimings, hitTesting: timing };
			expect(parseAccessibilityHelperOutput(JSON.stringify(output))).toBeNull();
		}
	});
});
