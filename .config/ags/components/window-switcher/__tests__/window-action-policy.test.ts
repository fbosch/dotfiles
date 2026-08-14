import { describe, expect, test } from "bun:test";
import {
	focusAndWarpCommand,
	restoreMinimizedCommand,
} from "../window-action-policy";

describe("window action commands", () => {
	test("uses home-relative scripts when HOME is available", () => {
		expect(focusAndWarpCommand("0xabc", "/home/test")).toBe(
			"luajit /home/test/.config/hypr/runtime/windows/warp-cursor-to-active-window.lua --window '0xabc'",
		);
		expect(restoreMinimizedCommand("0xabc", "/home/test")).toBe(
			"/home/test/.config/hypr/runtime/windows/toggle-minimized-workspace.sh '0xabc'",
		);
	});

	test("uses shell-relative fallbacks without HOME", () => {
		expect(focusAndWarpCommand("0xabc", null)).toContain("luajit ~/.config");
		expect(restoreMinimizedCommand("0xabc", null)).toContain("~/.config");
	});

	test("quotes addresses safely", () => {
		expect(focusAndWarpCommand("a'b", "/home/test")).toEndWith(
			"--window 'a'\\''b'",
		);
	});
});
