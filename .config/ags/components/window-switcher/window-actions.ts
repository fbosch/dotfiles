import GLib from "gi://GLib?version=2.0";
import type { WindowInfo } from "./machine";

const minimizedScript =
	"~/.config/hypr/runtime/windows/toggle-minimized-workspace.sh";
const warpScript =
	"luajit ~/.config/hypr/runtime/windows/warp-cursor-to-active-window.lua";

function focusAndWarpWindow(address: string): void {
	const home = GLib.getenv("HOME");
	const script = home
		? `luajit ${home}/.config/hypr/runtime/windows/warp-cursor-to-active-window.lua`
		: warpScript;
	GLib.spawn_command_line_async(
		`${script} --window ${GLib.shell_quote(address)}`,
	);
}

export function focusWindow(window: WindowInfo): void {
	focusAndWarpWindow(window.address);
}

export function restoreMinimizedAndFocus(address: string): void {
	const home = GLib.getenv("HOME");
	const script = home
		? `${home}/.config/hypr/runtime/windows/toggle-minimized-workspace.sh`
		: minimizedScript;
	GLib.spawn_command_line_sync(`${script} ${GLib.shell_quote(address)}`);
	focusAndWarpWindow(address);
}
