import { describe, expect, test } from "bun:test";
import { parseStartMenuRequest } from "../request";

describe("parseStartMenuRequest", () => {
	test.each(["show", "hide", "toggle", "is-visible", "refresh"])(
		"accepts %s",
		(action) => {
			expect(parseStartMenuRequest({ action })).toEqual({ action });
		},
	);

	test.each([
		null,
		{},
		{ action: "missing" },
		{ action: 1 },
		["show"],
	])("rejects unsupported payloads", (value) => {
		expect(parseStartMenuRequest(value)).toBeNull();
	});
});
