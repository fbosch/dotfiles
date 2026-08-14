import GLib from "gi://GLib?version=2.0";

export function playVolumeSound(): void {
	try {
		GLib.spawn_command_line_async(
			"sh -c 'sox -n -t wav - synth 0.03 sine 800 vol 0.2 2>/dev/null | pw-play - --volume=0.5 2>/dev/null &'",
		);
	} catch {
		// Sound feedback is optional when either audio utility is unavailable.
	}
}
