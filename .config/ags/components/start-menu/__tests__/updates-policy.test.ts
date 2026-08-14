import { describe, expect, test } from "bun:test";
import {
	formatTimeSince,
	parseFlakeUpdates,
	parseFlatpakUpdates,
} from "../updates-policy";

const now = Date.parse("2026-08-14T12:00:00Z");

describe("update cache policy", () => {
	test("accepts current flake and Flatpak caches", () => {
		const timestamp = new Date(now - 60_000).toISOString();
		expect(
			parseFlakeUpdates(
				{
					count: 1,
					updates: [
						{
							name: "nixpkgs",
							currentRev: "old",
							currentShort: "abc",
							newRev: "new",
							newShort: "def",
						},
					],
					timestamp,
				},
				now,
			),
		).not.toBeNull();
		expect(
			parseFlatpakUpdates(
				{
					count: 1,
					updates: [
						{
							app: "Example",
							currentVersion: "1",
							newVersion: "2",
							branch: "stable",
						},
					],
					timestamp,
				},
				now,
			),
		).not.toBeNull();
	});

	test.each([
		null,
		{},
		{ count: -1, updates: [], timestamp: new Date(now).toISOString() },
		{ count: 0, updates: {}, timestamp: new Date(now).toISOString() },
		{ count: 0, updates: [], timestamp: "invalid" },
		{
			count: 1,
			updates: [{}],
			timestamp: new Date(now).toISOString(),
		},
	])("rejects malformed caches", (value) => {
		expect(parseFlakeUpdates(value, now)).toBeNull();
	});

	test("rejects stale and future cache timestamps", () => {
		const cache = { count: 0, updates: [] };
		expect(
			parseFlakeUpdates(
				{ ...cache, timestamp: new Date(now - 86_400_001).toISOString() },
				now,
			),
		).toBeNull();
		expect(
			parseFlakeUpdates(
				{ ...cache, timestamp: new Date(now + 1).toISOString() },
				now,
			),
		).toBeNull();
	});
});

describe("formatTimeSince", () => {
	test.each([
		[0, "just now"],
		[60_000, "1 minute ago"],
		[2 * 60_000, "2 minutes ago"],
		[60 * 60_000, "1 hour ago"],
		[61 * 60_000, "1 hour and 1 minute ago"],
		[2 * 60 * 60_000, "2 hours ago"],
		[24 * 60 * 60_000, "1 day ago"],
		[25 * 60 * 60_000, "1 day and 1 hour ago"],
		[50 * 60 * 60_000, "2 days and 2 hours ago"],
	])("formats elapsed time", (age, expected) => {
		expect(formatTimeSince(new Date(now - age).toISOString(), now)).toBe(
			expected,
		);
	});

	test("rejects invalid timestamps", () => {
		expect(formatTimeSince("invalid", now)).toBe("");
	});
});
