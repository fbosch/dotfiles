import { describe, expect, test } from "bun:test";
import { accessibilityDebugLabel } from "../debug-state";

describe("accessibility debug state", () => {
	test("distinguishes pending, unavailable, and empty results", () => {
		expect(accessibilityDebugLabel({ kind: "pending", regionKind: "corridor" })).toBe(
			"a11y: corridor pending",
		);
		expect(
			accessibilityDebugLabel({
				kind: "unavailable",
				regionKind: "closed",
				reason: "helper incomplete",
			}),
		).toBe("a11y: closed unavailable: helper incomplete");
		expect(accessibilityDebugLabel({ kind: "empty", regionKind: "click" })).toBe(
			"a11y: click no candidates",
		);
	});

	test("reports complete and partial candidate counts", () => {
		expect(
			accessibilityDebugLabel({
				kind: "evaluated",
				regionKind: "closed",
				candidateCount: 3,
				diagnostics: [],
				partial: false,
			}),
		).toBe("a11y: closed 3 candidates");
		expect(
			accessibilityDebugLabel({
				kind: "evaluated",
				regionKind: "closed",
				candidateCount: 24,
				diagnostics: [],
				partial: true,
			}),
		).toBe("a11y: closed 24 candidates (partial)");
	});
});
