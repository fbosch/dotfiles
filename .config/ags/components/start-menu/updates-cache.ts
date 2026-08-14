import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { isMatching, P } from "ts-pattern";

const updateCacheMaxAgeMs = 24 * 60 * 60 * 1000;
const cacheRefreshIntervalMs = 5 * 60 * 1000;

const flakeUpdatePattern = {
	name: P.string,
	currentRev: P.string,
	currentShort: P.string,
	newRev: P.string,
	newShort: P.string,
};
const flatpakUpdatePattern = {
	app: P.string,
	currentVersion: P.string,
	newVersion: P.string,
	branch: P.string,
};

export type FlakeUpdate = P.infer<typeof flakeUpdatePattern>;
export type FlatpakUpdate = P.infer<typeof flatpakUpdatePattern>;

const isFlakeUpdate = (value: unknown): value is FlakeUpdate =>
	isMatching(flakeUpdatePattern, value);
const isFlatpakUpdate = (value: unknown): value is FlatpakUpdate =>
	isMatching(flatpakUpdatePattern, value);

export interface UpdatesData<T> {
	count: number;
	updates: T[];
	timestamp: string;
}

export interface UpdatesSnapshot {
	flake: UpdatesData<FlakeUpdate> | null;
	flatpak: UpdatesData<FlatpakUpdate> | null;
}

export class UpdatesCache {
	#monitor: Gio.FileMonitor | null = null;
	#refreshTimer: number | null = null;

	load(): UpdatesSnapshot {
		return {
			flake: this.#read("flake-updates.json", "flake updates", isFlakeUpdate),
			flatpak: this.#read(
				"flatpak-updates.json",
				"Flatpak updates",
				isFlatpakUpdate,
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
		isUpdate: (value: unknown) => value is T,
	): UpdatesData<T> | null {
		try {
			const path = `${GLib.get_user_cache_dir()}/${filename}`;
			if (!GLib.file_test(path, GLib.FileTest.EXISTS)) return null;
			const [success, contents] = GLib.file_get_contents(path);
			if (!success || !contents) return null;
			const value: unknown = JSON.parse(new TextDecoder("utf-8").decode(contents));
			const pattern = {
				count: P.number.int().gte(0),
				updates: P.array(P.unknown),
				timestamp: P.string,
			};
			if (!isMatching(pattern, value)) return null;
			const updates = value.updates;
			if (!updates.every(isUpdate)) return null;
			if (!isFreshCacheTimestamp(value.timestamp)) return null;
			return { count: value.count, updates, timestamp: value.timestamp };
		} catch (error) {
			console.error(`Error reading ${label} cache:`, error);
			return null;
		}
	}
}

export function formatTimeSince(timestamp: string): string {
	const checkedAt = Date.parse(timestamp);
	if (!Number.isFinite(checkedAt)) return "";
	const minutes = Math.floor((Date.now() - checkedAt) / 60_000);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	if (days > 0) {
		const remainingHours = hours % 24;
		return remainingHours > 0
			? `${days} day${days === 1 ? "" : "s"} and ${remainingHours} hour${remainingHours === 1 ? "" : "s"} ago`
			: `${days} day${days === 1 ? "" : "s"} ago`;
	}
	if (hours > 0) {
		const remainingMinutes = minutes % 60;
		return remainingMinutes > 0
			? `${hours} hour${hours === 1 ? "" : "s"} and ${remainingMinutes} minute${remainingMinutes === 1 ? "" : "s"} ago`
			: `${hours} hour${hours === 1 ? "" : "s"} ago`;
	}
	if (minutes > 0) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
	return "just now";
}

function isFreshCacheTimestamp(timestamp: string): boolean {
	const checkedAt = Date.parse(timestamp);
	if (!Number.isFinite(checkedAt)) return false;
	const age = Date.now() - checkedAt;
	return age >= 0 && age <= updateCacheMaxAgeMs;
}
