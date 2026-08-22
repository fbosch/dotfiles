import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";

const shutdownGraceMs = 7_500;

export function settleProcessesForShutdown(
	processes: Iterable<Gio.Subprocess>,
	graceMs = shutdownGraceMs,
): void {
	const owned = [...new Set(processes)];
	if (owned.length === 0) return;

	const loop = new GLib.MainLoop(null, false);
	let remaining = owned.length;
	let timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, graceMs, () => {
		timeoutId = 0;
		for (const process of owned) process.force_exit();
		loop.quit();
		return GLib.SOURCE_REMOVE;
	});
	const completed = () => {
		remaining -= 1;
		if (remaining !== 0) return;
		if (timeoutId !== 0) GLib.source_remove(timeoutId);
		timeoutId = 0;
		loop.quit();
	};
	for (const process of owned) {
		try {
			process.wait_async(null, completed);
		} catch {
			completed();
		}
	}
	if (remaining > 0) loop.run();
	if (timeoutId === 0 && remaining > 0)
		for (const process of owned) process.wait(null);
}
