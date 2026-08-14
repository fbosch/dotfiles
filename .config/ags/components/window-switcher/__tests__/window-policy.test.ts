import { describe, expect, test } from "bun:test";
import {
	buildWindowList,
	type HyprlandClient,
	updateFocusHistory,
} from "../window-policy";

const clients: HyprlandClient[] = [
	{
		address: "0x3",
		stableId: "stable",
		class: "Beta",
		initialClass: "Initial Beta",
		title: "Second",
		initialTitle: "Initial Second",
		workspace: { id: 2, name: "" },
		at: [10, 20],
		size: [800, 600],
	},
	{
		address: "0x1",
		class: "Alpha",
		title: "Same",
		workspace: { id: -1, name: "special:minimized" },
	},
	{
		address: "0x2",
		class: "Alpha",
		title: "Same",
		workspace: { id: 1, name: "1" },
	},
	{
		address: "0x4",
		class: "Ignored",
		title: "Scratch",
		workspace: { id: -1, name: "special:scratch" },
	},
];

describe("buildWindowList", () => {
	test("normalizes, filters, and alphabetically sorts clients", () => {
		const windows = buildWindowList(clients, "ALPHABETICAL", []);
		expect(windows.map(({ address }) => address)).toEqual(["0x1", "0x2", "0x3"]);
		expect(windows[2]).toMatchObject({
			stableId: "stable",
			initialClass: "Initial Beta",
			initialTitle: "Initial Second",
			workspace: "2",
			position: { x: 10, y: 20 },
			size: { width: 800, height: 600 },
		});
	});

	test("sorts known windows by recency and unknown windows alphabetically", () => {
		expect(
			buildWindowList(clients, "RECENCY", ["0x3", "0x2"]).map(
				({ address }) => address,
			),
		).toEqual(["0x3", "0x2", "0x1"]);
	});

	test("sorts entirely unknown recency windows alphabetically", () => {
		expect(
			buildWindowList(clients, "RECENCY", []).map(({ address }) => address),
		).toEqual(["0x1", "0x2", "0x3"]);
	});

	test("uses title and address to break alphabetical ties", () => {
		const tied = clients.slice(1, 3).map((client, index) => ({
			...client,
			title: index === 0 ? "Zulu" : "Alpha",
		}));
		expect(
			buildWindowList(tied, "ALPHABETICAL", []).map(({ address }) => address),
		).toEqual(["0x2", "0x1"]);
	});
});

describe("updateFocusHistory", () => {
	test("moves an existing address to the front", () => {
		expect(updateFocusHistory(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
	});

	test("adds and bounds new addresses", () => {
		expect(updateFocusHistory(["a", "b"], "c", 2)).toEqual(["c", "a"]);
	});

	test("ignores an empty address", () => {
		const history = ["a"];
		expect(updateFocusHistory(history, "")).toBe(history);
	});
});
