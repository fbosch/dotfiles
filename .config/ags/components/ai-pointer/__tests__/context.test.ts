import { describe, expect, test } from "bun:test";
import { formatSelectionContext, selectionContextFromSnapshots } from "../context";

const selection = { x: -100, y: 20, width: 100, height: 80 };
const snapshotAt = "2026-08-22T12:00:00.000Z";

function context(overrides: Parameters<typeof selectionContextFromSnapshots>[1] = {
	clients: [], layers: {}, monitors: [], activeWindow: null, locked: false, snapshotAt,
}) {
	return selectionContextFromSnapshots(selection, overrides);
}

describe("selection context", () => {
	test("resolves one fresh exact client while omitting private fields", () => {
		const result = context({
			clients: [{ x: -100, y: 20, width: 100, height: 80, address: "0x123", class: "org.browser", title: "Private title", pid: 42, command: "secret", cwd: "/private", workspace: { name: "work" }, monitor: 7, floating: true }],
			layers: {}, monitors: [{ id: 7, x: -1920, y: 0, width: 1920, height: 1080, name: "left", activeWorkspace: { name: "work" } }], activeWindow: { address: "0x123" }, locked: false, snapshotAt,
		});
		expect(result.exactWindow).toEqual({ class: "org.browser", title: "Private title", workspace: "work", monitor: "left", floating: true, fullscreen: false, active: true, relationship: "exact-geometry" });
		expect(JSON.stringify(result)).not.toContain("0x123");
		expect(JSON.stringify(result)).not.toContain("secret");
	});

	test("does not claim an exact window from stale or duplicate geometry", () => {
		expect(context({ clients: [{ x: -99, y: 20, width: 100, height: 80, class: "stale" }], layers: {}, monitors: [], activeWindow: null, locked: false, snapshotAt }).exactWindow).toBeNull();
		expect(context({ clients: [{ x: -100, y: 20, width: 100, height: 80, class: "one" }, { x: -100, y: 20, width: 100, height: 80, class: "two" }], layers: {}, monitors: [], activeWindow: null, locked: false, snapshotAt }).exactWindow).toBeNull();
	});

	test("ranks positive-area client and layer intersections deterministically", () => {
		const result = context({
			clients: [
				{ x: -100, y: 20, width: 50, height: 80, class: "Beta" },
				{ x: -100, y: 20, width: 50, height: 80, class: "Alpha" },
				{ x: 0, y: 20, width: 20, height: 80, class: "edge" },
			],
			layers: { left: [{ x: -75, y: 20, width: 75, height: 80, namespace: "waybar" }, { x: 0, y: 0, width: 10, height: 10, namespace: "outside" }] },
			monitors: [{ x: -1920, y: 0, width: 1920, height: 1080, name: "left", activeWorkspace: { name: "work" } }], activeWindow: null, locked: false, snapshotAt,
		});
		expect(result.geometricInference.clients.map((candidate) => candidate.label)).toEqual(["Alpha", "Beta"]);
		expect(result.geometricInference.layers).toHaveLength(1);
		expect(result.geometricInference.layers[0]).toMatchObject({ label: "waybar", selectionCoverage: 0.75, candidateCoverage: 1 });
		expect(result.monitor).toEqual({ name: "left", workspace: "work" });
	});

	test("excludes pointer and selector layers and handles no candidates", () => {
		const result = context({ clients: [], layers: { left: [{ x: -100, y: 20, width: 100, height: 80, namespace: "ags-ai-pointer" }, { x: -100, y: 20, width: 100, height: 80, namespace: "selection-overlay" }] }, monitors: [], activeWindow: null, locked: null, snapshotAt });
		expect(result.geometricInference.layers).toEqual([]);
		expect(formatSelectionContext(result)).toContain("Client geometric candidates: none.");
		expect(formatSelectionContext(result)).toContain("not compositor hit-test");
	});

	test("does not mark a client active when active-window identity differs", () => {
		const result = context({ clients: [{ x: -100, y: 20, width: 60, height: 80, address: "0xone", class: "one" }], layers: {}, monitors: [], activeWindow: { address: "0xtwo" }, locked: false, snapshotAt });
		expect(result.geometricInference.clients[0].active).toBeFalse();
	});
});
