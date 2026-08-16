import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";

export function playConfirmWarningSound(): Gio.Subprocess | null {
	const player = GLib.find_program_in_path("pw-play");
	if (!player) return null;
	try {
		return Gio.Subprocess.new(
			[player, `${GLib.get_home_dir()}/.config/hypr/assets/warn.ogg`],
			Gio.SubprocessFlags.NONE,
		);
	} catch {
		return null;
	}
}
