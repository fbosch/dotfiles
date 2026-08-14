import { describe, expect, test } from "bun:test";
import { parseXdgUserDir, systemSettingsCommand } from "../command-policy";

describe("systemSettingsCommand", () => {
	test.each([
		["foot", 'foot sh -c "cd /nixos && nvim"'],
		["kitty", 'kitty sh -c "cd /nixos && nvim"'],
		["alacritty", 'alacritty -e sh -c "cd /nixos && nvim"'],
		["wezterm", "wezterm start --cwd /nixos -- nvim"],
		["gnome-terminal", "gnome-terminal --working-directory=/nixos -- nvim"],
		["xterm", 'xterm -e sh -c "cd /nixos && nvim"'],
	])("builds the %s invocation", (terminal, expected) => {
		expect(systemSettingsCommand(terminal, "/nixos")).toBe(expected);
	});
});

describe("parseXdgUserDir", () => {
	test("expands HOME and accepts quoted values", () => {
		expect(
			parseXdgUserDir(
				'XDG_DOCUMENTS_DIR="$HOME/My Documents"',
				"XDG_DOCUMENTS_DIR",
				"/home/test",
			),
		).toBe("/home/test/My Documents");
	});

	test("returns null when the key is absent", () => {
		expect(parseXdgUserDir("XDG_DOWNLOAD_DIR=/tmp", "XDG_DOCUMENTS_DIR", "/home/test")).toBeNull();
	});
});
