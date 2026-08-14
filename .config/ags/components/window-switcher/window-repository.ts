import GLib from "gi://GLib?version=2.0";
import { execAsync } from "ags/process";
import { queryHyprlandJson } from "../../services/hyprland-ipc";
import { debugLog } from "./diagnostics";
import type { WindowInfo } from "./machine";

export enum SortMode {
	ALPHABETICAL = "ALPHABETICAL",
	RECENCY = "RECENCY",
}

type HyprlandClient = {
	address: string;
	stableId?: string;
	class: string;
	initialClass?: string;
	title: string;
	initialTitle?: string;
	focused?: boolean;
	workspace: { id: number; name: string };
	at?: [number, number];
	size?: [number, number];
};
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
			const windows = clients
				.filter((client) => {
					const workspaceName = client.workspace.name || "";
					return (
						workspaceName === "special:minimized" ||
						workspaceName.startsWith("special:") === false
					);
				})
				.map(toWindowInfo);
			windows.sort(
				sortMode === SortMode.RECENCY
					? this.#compareByRecency.bind(this)
					: compareAlphabetically,
			);
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
		const index = this.#focusHistory.indexOf(address);
		if (index !== -1) this.#focusHistory.splice(index, 1);
		this.#focusHistory.unshift(address);
		if (this.#focusHistory.length > 50)
			this.#focusHistory = this.#focusHistory.slice(0, 50);
		this.#focusVersion += 1;
		debugLog(
			`Focus history updated: [${this.#focusHistory.slice(0, 5).join(", ")}...]`,
		);
	}

	#compareByRecency(a: WindowInfo, b: WindowInfo): number {
		const aIndex = this.#focusHistory.indexOf(a.address);
		const bIndex = this.#focusHistory.indexOf(b.address);
		if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
		if (aIndex !== -1) return -1;
		if (bIndex !== -1) return 1;
		return compareAlphabetically(a, b);
	}
}

function toWindowInfo(client: HyprlandClient): WindowInfo {
	return {
		address: client.address,
		stableId: client.stableId,
		class: client.class || "",
		initialClass: client.initialClass || undefined,
		title: client.title || "",
		initialTitle: client.initialTitle || undefined,
		workspace: client.workspace.name || client.workspace.id.toString(),
		size: client.size
			? { width: client.size[0], height: client.size[1] }
			: undefined,
		position: client.at ? { x: client.at[0], y: client.at[1] } : undefined,
	};
}

function compareAlphabetically(a: WindowInfo, b: WindowInfo): number {
	return a.class !== b.class
		? a.class.localeCompare(b.class)
		: a.title !== b.title
			? a.title.localeCompare(b.title)
			: a.address.localeCompare(b.address);
}
