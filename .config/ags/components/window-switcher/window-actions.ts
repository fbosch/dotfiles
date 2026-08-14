import GLib from "gi://GLib?version=2.0";
import type { WindowInfo } from "./machine";
import {
	focusAndWarpCommand,
	restoreMinimizedCommand,
} from "./window-action-policy";

function focusAndWarpWindow(address: string): void {
	GLib.spawn_command_line_async(focusAndWarpCommand(address, GLib.getenv("HOME")));
}

export function focusWindow(window: WindowInfo): void {
	focusAndWarpWindow(window.address);
}

export function restoreMinimizedAndFocus(address: string): void {
	const home = GLib.getenv("HOME");
	GLib.spawn_command_line_sync(restoreMinimizedCommand(address, home));
	focusAndWarpWindow(address);
}
