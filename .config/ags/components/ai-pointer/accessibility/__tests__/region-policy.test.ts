import { describe, expect, test } from "bun:test";
import { chooseAccessibleSnap } from "../policy";
import { strokeSelectionRegion } from "../../stroke";

const client = { x: 0, y: 0, width: 1_000, height: 800 };

describe("accessible stroke region selection", () => {
	test("selects distinct accessible targets enclosed by an unfinished loop", () => {
		const points = [
			{ x: 100, y: 200 },
			{ x: 110, y: 130 },
			{ x: 180, y: 100 },
			{ x: 260, y: 110 },
			{ x: 300, y: 180 },
			{ x: 280, y: 250 },
			{ x: 210, y: 280 },
			{ x: 130, y: 260 },
			{ x: 105, y: 215 },
		];
		const result = chooseAccessibleSnap(
			{ x: 68, y: 68, width: 264, height: 244 },
			[
				{
					geometry: { x: 150, y: 140, width: 80, height: 60 },
					name: "Product image",
					role: "image",
				},
				{
					geometry: { x: 180, y: 220, width: 80, height: 30 },
					name: "Product title",
					role: "heading",
				},
				{
					geometry: { x: 350, y: 140, width: 80, height: 40 },
					name: "Save",
					role: "push button",
				},
			],
			{ x: 0, y: 0, width: 500, height: 400 },
			strokeSelectionRegion(points),
		);

		expect(result?.metadata.role).toBe("collection");
		expect(result?.metadata.targets?.map(({ name }) => name).sort()).toEqual([
			"Product image",
			"Product title",
		]);
		expect(result?.geometry).toEqual({ x: 138, y: 128, width: 134, height: 134 });
	});

	test("selects only targets touched by an open U-shaped corridor", () => {
		const points = [
			{ x: 100, y: 100 },
			{ x: 100, y: 280 },
			{ x: 200, y: 330 },
			{ x: 300, y: 280 },
			{ x: 300, y: 100 },
		];
		const result = chooseAccessibleSnap(
			{ x: 68, y: 68, width: 264, height: 294 },
			[
				{
					geometry: { x: 90, y: 170, width: 30, height: 30 },
					name: "Touched control",
					role: "push button",
				},
				{
					geometry: { x: 180, y: 160, width: 40, height: 40 },
					name: "Inside the U",
					role: "push button",
				},
			],
			{ x: 0, y: 0, width: 500, height: 400 },
			strokeSelectionRegion(points),
		);

		expect(result?.metadata.name).toBe("Touched control");
		expect(result?.geometry).toEqual({ x: 78, y: 158, width: 54, height: 54 });
	});

	test("bundles distinct targets crossed by a line instead of their enclosing ancestor", () => {
		const points = [
			{ x: 100, y: 150 },
			{ x: 400, y: 150 },
		];
		const result = chooseAccessibleSnap(
			{ x: 68, y: 118, width: 364, height: 64 },
			[
				{
					geometry: { x: 110, y: 130, width: 100, height: 40 },
					hitCount: 3,
					name: "Previous",
					role: "push button",
				},
				{
					geometry: { x: 290, y: 130, width: 100, height: 40 },
					hitCount: 3,
					name: "Next",
					role: "push button",
				},
				{
					geometry: { x: 80, y: 100, width: 360, height: 100 },
					hitCount: 9,
					name: "Pagination",
					role: "section",
				},
			],
			client,
			strokeSelectionRegion(points),
		);

		expect(result?.metadata.role).toBe("collection");
		expect(result?.metadata.targets?.map(({ name }) => name).sort()).toEqual([
			"Next",
			"Previous",
		]);
	});

	test("rejects a single-hit oversized ancestor inside a small loop", () => {
		const points = [
			{ x: 400, y: 300 },
			{ x: 600, y: 300 },
			{ x: 600, y: 500 },
			{ x: 400, y: 500 },
			{ x: 400, y: 305 },
		];
		expect(
			chooseAccessibleSnap(
				{ x: 368, y: 268, width: 264, height: 264 },
				[
					{
						geometry: { x: 12, y: 12, width: 976, height: 776 },
						hitCount: 1,
						name: "Root section",
						role: "section",
					},
				],
				client,
				strokeSelectionRegion(points),
			),
		).toBeNull();
	});

	test("prefers an enclosing list item over its nested link in a closed region", () => {
		const points = [
			{ x: 90, y: 90 },
			{ x: 410, y: 90 },
			{ x: 410, y: 210 },
			{ x: 90, y: 210 },
			{ x: 92, y: 94 },
		];
		const result = chooseAccessibleSnap(
			{ x: 58, y: 58, width: 384, height: 184 },
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
			strokeSelectionRegion(points),
		);

		expect(result?.metadata.role).toBe("list item");
		expect(result?.metadata.name).toBe("Project row");
	});

	test("collects multiple distinct common ancestors", () => {
		const points = [
			{ x: 90, y: 90 },
			{ x: 510, y: 90 },
			{ x: 510, y: 240 },
			{ x: 90, y: 240 },
			{ x: 92, y: 94 },
		];
		const result = chooseAccessibleSnap(
			{ x: 58, y: 58, width: 484, height: 214 },
			[
				{
					geometry: { x: 100, y: 110, width: 180, height: 100 },
					hitCount: 7,
					name: "First row",
					role: "list item",
				},
				{
					geometry: { x: 310, y: 110, width: 180, height: 100 },
					hitCount: 7,
					name: "Second row",
					role: "list item",
				},
			],
			client,
			strokeSelectionRegion(points),
		);

		expect(result?.metadata.role).toBe("collection");
		expect(result?.metadata.targets).toHaveLength(2);
	});

	test("rejects a sparse region collection", () => {
		const points = [
			{ x: 100, y: 100 },
			{ x: 800, y: 100 },
			{ x: 800, y: 600 },
			{ x: 100, y: 600 },
			{ x: 102, y: 104 },
		];
		expect(
			chooseAccessibleSnap(
				{ x: 68, y: 68, width: 764, height: 564 },
				[
					{ geometry: { x: 120, y: 120, width: 20, height: 20 }, role: "push button" },
					{ geometry: { x: 760, y: 560, width: 20, height: 20 }, role: "push button" },
				],
				client,
				strokeSelectionRegion(points),
			),
		).toBeNull();
	});

	test("deduplicates identical bounds in favor of an actionable role", () => {
		const points = [
			{ x: 100, y: 100 },
			{ x: 300, y: 100 },
			{ x: 300, y: 300 },
			{ x: 100, y: 300 },
			{ x: 100, y: 105 },
		];
		const geometry = { x: 150, y: 150, width: 100, height: 100 };
		const result = chooseAccessibleSnap(
			{ x: 68, y: 68, width: 264, height: 264 },
			[
				{ geometry, hitCount: 24, name: "Label", role: "text" },
				{ geometry, hitCount: 1, name: "Submit", role: "push button" },
			],
			client,
			strokeSelectionRegion(points),
		);

		expect(result?.metadata.role).toBe("push button");
		expect(result?.metadata.name).toBe("Submit");
		expect(result?.metadata.hitCount).toBe(1);
	});

	test("does not transfer center evidence across same-geometry roles", () => {
		const points = [
			{ x: 400, y: 300 },
			{ x: 600, y: 300 },
			{ x: 600, y: 500 },
			{ x: 400, y: 500 },
			{ x: 400, y: 305 },
		];
		const geometry = { x: 12, y: 12, width: 976, height: 776 };
		expect(
			chooseAccessibleSnap(
				{ x: 368, y: 268, width: 264, height: 264 },
				[
					{ centerHit: true, geometry, hitCount: 9, name: "Center text", role: "text" },
					{ centerHit: false, geometry, hitCount: 1, name: "Page link", role: "link" },
				],
				client,
				strokeSelectionRegion(points),
			),
		).toBeNull();
	});

	test("preserves stroke geometry for similarly confident overlapping peers", () => {
		const points = [
			{ x: 100, y: 100 },
			{ x: 400, y: 100 },
			{ x: 400, y: 300 },
			{ x: 100, y: 300 },
			{ x: 102, y: 104 },
		];
		expect(
			chooseAccessibleSnap(
				{ x: 68, y: 68, width: 364, height: 264 },
				[
					{ geometry: { x: 160, y: 140, width: 180, height: 100 }, role: "push button" },
					{ geometry: { x: 158, y: 138, width: 184, height: 104 }, role: "link" },
				],
				client,
				strokeSelectionRegion(points),
			),
		).toBeNull();
	});

	test("rejects a region containing more than eight distinct targets", () => {
		const points = [
			{ x: 100, y: 100 },
			{ x: 500, y: 100 },
			{ x: 500, y: 400 },
			{ x: 100, y: 400 },
			{ x: 102, y: 104 },
		];
		const candidates = Array.from({ length: 9 }, (_, index) => ({
			geometry: {
				x: 130 + (index % 3) * 110,
				y: 130 + Math.floor(index / 3) * 80,
				width: 60,
				height: 40,
			},
			role: "push button",
		}));

		expect(
			chooseAccessibleSnap(
				{ x: 68, y: 68, width: 464, height: 364 },
				candidates,
				client,
				strokeSelectionRegion(points),
			),
		).toBeNull();
	});
});
