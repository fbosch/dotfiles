import { describe, expect, test } from "bun:test";
import {
	applicationTopologyMatches,
	formatForceQuitMetrics,
	type ForceQuitApplication,
	isProtectedWindow,
	parseForceQuitWindow,
	revalidatedWindows,
} from "../model";

function application(
	id: string,
	windows: Array<{ address: string; pid: number }>,
): ForceQuitApplication {
	return {
		id,
		name: id,
		icon: null,
		fallbackLetter: id[0]?.toUpperCase() ?? "?",
		pids: [...new Set(windows.map((window) => window.pid))].sort(),
		windows: windows.map((window) => ({ ...window, class: id })),
	};
}

describe("Force Quit model", () => {
	test("accepts only mapped clients with valid addresses and PIDs", () => {
		expect(
			parseForceQuitWindow({
				mapped: true,
				address: "0xabc123",
				pid: 42,
				class: "Example",
			}),
		).toMatchObject({ address: "0xabc123", pid: 42, class: "Example" });
		expect(parseForceQuitWindow({ mapped: false })).toBeNull();
		expect(
			parseForceQuitWindow({
				mapped: true,
				address: "not-an-address",
				pid: 42,
				class: "Example",
			}),
		).toBeNull();
	});

	test("protects shell, compositor, and portal processes", () => {
		const ordinary = {
			address: "0x1",
			pid: 42,
			class: "Example",
		};
		expect(isProtectedWindow({ ...ordinary, class: "Hyprland" }, [])).toBe(true);
		expect(isProtectedWindow(ordinary, ["/usr/bin/ags"])).toBe(true);
		expect(
			isProtectedWindow(ordinary, ["/usr/lib/xdg-desktop-portal-hyprland"]),
		).toBe(true);
		expect(isProtectedWindow(ordinary, ["/usr/bin/example"])).toBe(false);
	});

	test("revalidates both address and PID before termination", () => {
		const selected = application("example", [
			{ address: "0x1", pid: 10 },
			{ address: "0x2", pid: 20 },
		]);
		const current = application("example", [
			{ address: "0x1", pid: 99 },
			{ address: "0x2", pid: 20 },
		]);
		expect(revalidatedWindows(selected, [current])).toEqual([
			expect.objectContaining({ address: "0x2", pid: 20 }),
		]);
		expect(revalidatedWindows(selected, [])).toEqual([]);
	});

	test("detects PID and window topology changes", () => {
		const left = [application("example", [{ address: "0x1", pid: 10 }])];
		expect(applicationTopologyMatches(left, left)).toBe(true);
		expect(
			applicationTopologyMatches(left, [
				application("example", [{ address: "0x1", pid: 11 }]),
			]),
		).toBe(false);
		expect(applicationTopologyMatches(left, null)).toBe(false);
	});

	test("formats unavailable and sampled metrics", () => {
		expect(formatForceQuitMetrics(undefined)).toBe("-- · --");
		expect(
			formatForceQuitMetrics({ cpuPercent: 12.34, residentMemoryBytes: 512 * 1024 ** 2 }),
		).toBe("12.3% · 512 MB");
	});
});
