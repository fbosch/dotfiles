import { describe, expect, test } from "bun:test";
import { isMatching } from "ts-pattern";
import { aiPointerRequestPattern } from "../request";

describe("aiPointerRequestPattern", () => {
	test("accepts only a closed start request", () => {
		expect(isMatching(aiPointerRequestPattern, { action: "start" })).toBe(true);
		expect(isMatching(aiPointerRequestPattern, { action: "start", extra: true })).toBe(false);
		expect(isMatching(aiPointerRequestPattern, { action: "hide" })).toBe(false);
	});
});
