import { describe, expect, test } from "bun:test";
import { accessibilityDebugLabel } from "../debug-state";

describe("accessibility debug state", () => {
	test("distinguishes pending, unavailable, and empty results", () => {
		expect(accessibilityDebugLabel({ kind: "pending", regionKind: "box" })).toBe(
			"a11y: box pending",
		);
		expect(
			accessibilityDebugLabel({
				kind: "unavailable",
				regionKind: "box",
				reason: "helper incomplete",
			}),
		).toBe("a11y: box unavailable: helper incomplete");
		expect(accessibilityDebugLabel({ kind: "empty", regionKind: "click" })).toBe(
			"a11y: click no candidates",
		);
	});

	test("reports complete and partial candidate counts", () => {
		expect(
			accessibilityDebugLabel({
				kind: "evaluated",
				regionKind: "box",
				candidateCount: 3,
				diagnostics: [],
				partial: false,
			}),
		).toBe("a11y: box 3 candidates");
		expect(
			accessibilityDebugLabel({
				kind: "evaluated",
				regionKind: "box",
				candidateCount: 24,
				diagnostics: [],
				partial: true,
			}),
		).toBe("a11y: box 24 candidates (partial)");
	});
});
