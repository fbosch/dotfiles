import { describe, expect, test } from "bun:test";
import { isMatching } from "ts-pattern";
import { aiPointerRequestPattern } from "../request";

describe("aiPointerRequestPattern", () => {
	test("accepts only a closed start request", () => {
		expect(isMatching(aiPointerRequestPattern, { action: "start", x: 1, y: -2 })).toBe(true);
		expect(isMatching(aiPointerRequestPattern, { action: "finish", x: 3, y: 4 })).toBe(true);
		expect(isMatching(aiPointerRequestPattern, { action: "cancel" })).toBe(true);
		expect(isMatching(aiPointerRequestPattern, { action: "start", x: 1, y: 2, extra: true })).toBe(false);
		expect(isMatching(aiPointerRequestPattern, { action: "cancel", x: 1 })).toBe(false);
		expect(isMatching(aiPointerRequestPattern, { action: "start", x: 1.5, y: 2 })).toBe(false);
		expect(isMatching(aiPointerRequestPattern, { action: "hide" })).toBe(false);
	});
});
