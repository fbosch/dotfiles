import { describe, expect, test } from "bun:test";
import { parseAccessibilityHelperInput } from "../accessibility-helper-input";

function input() {
	return {
		protocolVersion: 6,
		coordinateSpace: "window",
		pid: 123,
		windowWidth: 1_000,
		windowHeight: 800,
		windowTitle: "Browser",
		selection: { x: 100, y: 100, width: 200, height: 100 },
		stroke: {
			points: [{ x: 100, y: 100 }, { x: 300, y: 200 }],
			radius: 32,
		},
	};
}

describe("accessibility helper input", () => {
	test("accepts the current bounded window-coordinate protocol", () => {
		const value = input();
		expect(parseAccessibilityHelperInput([JSON.stringify(value)])).toEqual(value);
	});

	test("rejects stale protocol versions", () => {
		expect(
			parseAccessibilityHelperInput([JSON.stringify({ ...input(), protocolVersion: 5 })]),
		).toBeNull();
	});

	test("rejects malformed invocation and excessive brush radius", () => {
		expect(parseAccessibilityHelperInput([])).toBeNull();
		expect(
			parseAccessibilityHelperInput([
				JSON.stringify({ ...input(), stroke: { ...input().stroke, radius: 129 } }),
			]),
		).toBeNull();
	});
});
