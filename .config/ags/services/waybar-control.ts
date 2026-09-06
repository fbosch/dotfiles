import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";

const waybarMonitor = `${GLib.get_home_dir()}/.config/hypr/runtime/desktop/waybar-monitor.sh`;

export function showWaybar(): void {
	const process = Gio.Subprocess.new(
		[waybarMonitor, "show"],
		Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE,
	);
	process.wait_check_async(null, (_source, result) => {
		try {
			process.wait_check_finish(result);
		} catch (cause) {
			console.error(
				"Waybar is unavailable; its monitor did not accept the show request:",
				cause,
			);
		}
	});
}
