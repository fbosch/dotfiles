import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";

export function showWaybar(): void {
	const control = `${GLib.get_home_dir()}/.config/hypr/runtime/desktop/waybar-control.sh`;

	try {
		const process = Gio.Subprocess.new(
			[control, "show"],
			Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE,
		);
		process.wait_check_async(null, (_source, result) => {
			try {
				process.wait_check_finish(result);
			} catch (cause) {
				console.error("Waybar control request failed:", cause);
			}
		});
	} catch (cause) {
		console.error("Waybar control request failed:", cause);
	}
}
