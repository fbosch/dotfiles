import GLib from "gi://GLib?version=2.0";

const runtimeDir = GLib.getenv("XDG_RUNTIME_DIR") || GLib.get_tmp_dir();

export const monitorDebugPath = `${runtimeDir}/monitor-debug.log`;
export const windowSwitcherDebugPath = `${runtimeDir}/ags-window-switcher-debug.log`;
const bindDiagnosticPath = `${runtimeDir}/ags-window-switcher-bind.debug`;

const debugEnabled = GLib.getenv("AGS_WINDOW_SWITCHER_DEBUG") === "1";

export function debugLog(message: string): void {
	if (debugEnabled) console.log(message);
}

export function debugWriteFile(path: string, contents: string): void {
	if (debugEnabled === false) return;

	try {
		GLib.file_set_contents(path, contents);
	} catch (error) {
		console.error(`Failed to write debug file ${path}:`, error);
	}
}

export function writeBindDiagnostic(message: string): void {
	GLib.file_set_contents(bindDiagnosticPath, `[WS-AGS-7f42] ${message}\n`);
}
