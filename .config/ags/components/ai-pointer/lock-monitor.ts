import GLib from "gi://GLib?version=2.0";
import { queryHyprlandText } from "@/services/hyprland-ipc";

const lockCheckIntervalMs = 500;

export function querySessionLocked(): boolean | null {
	const state = queryHyprlandText("locked", {
		component: "ai-pointer",
		metric: "lockState",
	})?.trim();
	return state === "true" ? true : state === "false" ? false : null;
}

export class SessionLockMonitor {
	readonly #queryLocked: () => boolean | null;
	readonly #onLocked: () => void;
	#sourceId = 0;

	constructor(queryLocked: () => boolean | null, onLocked: () => void) {
		this.#queryLocked = queryLocked;
		this.#onLocked = onLocked;
	}

	get blocksWorkflow(): boolean {
		try {
			return this.#queryLocked() !== false;
		} catch {
			return true;
		}
	}

	start(): void {
		this.stop();
		this.#sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, lockCheckIntervalMs, () => {
			if (this.blocksWorkflow === false) return GLib.SOURCE_CONTINUE;
			this.#sourceId = 0;
			this.#onLocked();
			return GLib.SOURCE_REMOVE;
		});
	}

	stop(): void {
		if (this.#sourceId !== 0) GLib.source_remove(this.#sourceId);
		this.#sourceId = 0;
	}
}
