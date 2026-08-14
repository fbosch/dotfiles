import { describe, expect, test } from "bun:test";
import type { WindowInfo } from "../machine";
import { splitWindowRows, truncateWindowTitle } from "../view-policy";

const windows: WindowInfo[] = ["1", "2", "3"].map((address) => ({
	address,
	class: `Class ${address}`,
	title: `Window ${address}`,
	workspace: "1",
}));

describe("truncateWindowTitle", () => {
	test("returns an ellipsis when no characters fit", () => {
		expect(truncateWindowTitle("Title", 12)).toBe("…");
	});

	test("keeps titles that fit", () => {
		expect(truncateWindowTitle("Title", 60)).toBe("Title");
	});

	test("truncates long titles", () => {
		expect(truncateWindowTitle("Long window title", 42)).toBe("Long …");
	});
});

describe("splitWindowRows", () => {
	test("keeps fitting windows in one row", () => {
		expect(splitWindowRows(windows, [40, 40, 40], 140)).toEqual([windows]);
	});

	test("wraps windows without creating empty rows", () => {
		expect(splitWindowRows(windows, [60, 60, 60], 100)).toEqual([
			[windows[0]],
			[windows[1]],
			[windows[2]],
		]);
	});

	test("places an oversized first window in its own row", () => {
		expect(splitWindowRows(windows.slice(0, 2), [120, 20], 100)).toEqual([
			[windows[0]],
			[windows[1]],
		]);
	});

	test("returns no rows for no windows", () => {
		expect(splitWindowRows([], [], 100)).toEqual([]);
	});
});
