import { describe, expect, test } from "bun:test";
import { createPreparationIntentClaims } from "../preparation-intent";

type Source = "pointer" | "focus";

describe("preparation intent claims", () => {
	test("reports only zero-to-one and one-to-zero transitions", () => {
		const claims = createPreparationIntentClaims<Source>();

		expect(claims.claim("pointer")).toBe(true);
		expect(claims.claim("focus")).toBe(false);
		expect(claims.release("pointer")).toBe(false);
		expect(claims.release("focus")).toBe(true);
		expect(claims.hasClaims()).toBe(false);
	});

	test("treats duplicate and missing source events as idempotent", () => {
		const claims = createPreparationIntentClaims<Source>();

		expect(claims.claim("pointer")).toBe(true);
		expect(claims.claim("pointer")).toBe(false);
		expect(claims.release("focus")).toBe(false);
		expect(claims.release("pointer")).toBe(true);
		expect(claims.release("pointer")).toBe(false);
	});

	test("clears every claim when its owner disappears", () => {
		const claims = createPreparationIntentClaims<Source>();

		expect(claims.clear()).toBe(false);
		claims.claim("pointer");
		claims.claim("focus");
		expect(claims.clear()).toBe(true);
		expect(claims.hasClaims()).toBe(false);
		expect(claims.clear()).toBe(false);
	});
});
