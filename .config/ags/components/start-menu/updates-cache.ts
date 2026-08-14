import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import {
	parseFlakeUpdates,
	parseFlatpakUpdates,
	type UpdatesSnapshot,
} from "./updates-policy";

const cacheRefreshIntervalMs = 5 * 60 * 1000;

export type { UpdatesSnapshot } from "./updates-policy";

export class UpdatesCache {
	#monitor: Gio.FileMonitor | null = null;
	#refreshTimer: number | null = null;

	load(): UpdatesSnapshot {
		return {
			flake: this.#read("flake-updates.json", "flake updates", parseFlakeUpdates),
			flatpak: this.#read(
				"flatpak-updates.json",
				"Flatpak updates",
				parseFlatpakUpdates,
			),
		};
	}

	start(onChanged: () => void): void {
		if (this.#monitor || this.#refreshTimer !== null) return;
		try {
			const directory = Gio.File.new_for_path(GLib.get_user_cache_dir());
			this.#monitor = directory.monitor_directory(
				Gio.FileMonitorFlags.NONE,
				null,
			);
			this.#monitor.connect("changed", (_monitor, file) => {
				const name = file.get_basename();
				if (name === "flake-updates.json" || name === "flatpak-updates.json")
					onChanged();
			});
		} catch (error) {
			console.error(
				"Failed to monitor cache directory, falling back to polling:",
				error,
			);
			this.#refreshTimer = GLib.timeout_add(
				GLib.PRIORITY_DEFAULT,
				cacheRefreshIntervalMs,
				() => {
					onChanged();
					return GLib.SOURCE_CONTINUE;
				},
			);
		}
	}

	dispose(): void {
		this.#monitor?.cancel();
		this.#monitor = null;
		if (this.#refreshTimer === null) return;
		GLib.source_remove(this.#refreshTimer);
		this.#refreshTimer = null;
	}

	#read<T>(
		filename: string,
		label: string,
		parse: (value: unknown) => T | null,
	): T | null {
		try {
			const path = `${GLib.get_user_cache_dir()}/${filename}`;
			if (!GLib.file_test(path, GLib.FileTest.EXISTS)) return null;
			const [success, contents] = GLib.file_get_contents(path);
			if (!success || !contents) return null;
			const value: unknown = JSON.parse(new TextDecoder("utf-8").decode(contents));
			return parse(value);
		} catch (error) {
			console.error(`Error reading ${label} cache:`, error);
			return null;
		}
	}
}
