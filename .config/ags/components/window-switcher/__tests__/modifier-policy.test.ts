import { describe, expect, test } from "bun:test";
import {
	isTriggerModifierKey,
	normalizeModifier,
} from "../modifier-policy";

describe("normalizeModifier", () => {
	test.each([
		["super", "SUPER"],
		["shift", "SHIFT"],
		["ctrl", "CTRL"],
		["control", "CTRL"],
		["alt", "ALT"],
		["unknown", "ALT"],
	])("normalizes %s", (input, expected) => {
		expect(normalizeModifier(input)).toBe(expected);
	});
});

describe("isTriggerModifierKey", () => {
	test.each([
		["SUPER", 65515],
		["SUPER", 65516],
		["ALT", 65513],
		["ALT", 65514],
		["CTRL", 65507],
		["CONTROL", 65508],
		["SHIFT", 65505],
		["SHIFT", 65506],
	])("accepts %s key %i", (modifier, keyval) => {
		expect(isTriggerModifierKey(modifier, keyval)).toBe(true);
	});

	test("rejects an unrelated key", () => {
		expect(isTriggerModifierKey("ALT", 1)).toBe(false);
	});
});
