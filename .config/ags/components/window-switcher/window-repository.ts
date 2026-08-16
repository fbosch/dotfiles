import GLib from "gi://GLib?version=2.0";
import { execAsync } from "ags/process";
import { queryHyprlandJson } from "@/services/hyprland-ipc";
import { debugLog } from "./diagnostics";
import type { WindowInfo } from "./machine";
import {
	buildWindowList,
	type HyprlandClient,
	updateFocusHistory,
} from "./window-policy";

export enum SortMode {
	ALPHABETICAL = "ALPHABETICAL",
	RECENCY = "RECENCY",
}

type WindowCache = {
	timestampMs: number;
	windows: WindowInfo[];
	sortMode: SortMode;
	focusVersion: number;
};

export class WindowRepository {
	#focusHistory: string[] = [];
	#focusVersion = 0;
	#windowCache: WindowCache | null = null;
	#activeCache: { timestampMs: number; address: string | null } | null = null;

	async getWindows(sortMode: SortMode): Promise<WindowInfo[]> {
		const nowMs = GLib.get_monotonic_time() / 1000;
		const cache = this.#windowCache;
		if (
			cache &&
			nowMs - cache.timestampMs < 150 &&
			cache.sortMode === sortMode &&
			(sortMode !== SortMode.RECENCY ||
				cache.focusVersion === this.#focusVersion)
		)
			return cache.windows;
		try {
			const clients =
				queryHyprlandJson<HyprlandClient[]>("j/clients", {
					component: "window-switcher",
					metric: "hyprSocketClients",
				}) ??
				(JSON.parse(await execAsync("hyprctl clients -j")) as HyprlandClient[]);
			const focused = clients.find((client) => client.focused);
			if (focused?.address)
				this.#activeCache = { timestampMs: nowMs, address: focused.address };
			const windows = buildWindowList(clients, sortMode, this.#focusHistory);
			this.#windowCache = {
				timestampMs: nowMs,
				windows,
				sortMode,
				focusVersion: this.#focusVersion,
			};
			return windows;
		} catch (error) {
			console.error("Error getting windows from hyprctl:", error);
			return [];
		}
	}

	async getActiveAddress(): Promise<string | null> {
		const nowMs = GLib.get_monotonic_time() / 1000;
		if (this.#activeCache && nowMs - this.#activeCache.timestampMs < 100)
			return this.#activeCache.address;
		try {
			const active =
				queryHyprlandJson<{ address?: string }>("j/activewindow", {
					component: "window-switcher",
					metric: "hyprSocketActiveWindow",
				}) ?? JSON.parse(await execAsync("hyprctl activewindow -j"));
			const address = active.address || null;
			this.#activeCache = { timestampMs: nowMs, address };
			return address;
		} catch (error) {
			console.error("Error getting active window:", error);
			return null;
		}
	}

	updateFocusHistory(address: string): void {
		if (!address) return;
		this.#focusHistory = updateFocusHistory(this.#focusHistory, address);
		this.#focusVersion += 1;
		debugLog(
			`Focus history updated: [${this.#focusHistory.slice(0, 5).join(", ")}...]`,
		);
	}

}
