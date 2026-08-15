import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { dispatchHyprland } from "../../services/hyprland-ipc";
import { getForceQuitApplications } from "./application-repository";
import {
	type ForceQuitApplication,
	revalidatedWindows,
} from "./model";

export type ForceQuitResult = "resolved" | "terminated" | "unavailable";

export interface ForceQuitOperation {
	cancel(): void;
}

const gracefulCloseMs = 1_500;
const forcedTerminationSettleMs = 250;

export function forceQuitApplication(
	application: ForceQuitApplication,
	onComplete: (result: ForceQuitResult) => void,
): ForceQuitOperation {
	let source = 0;
	let completed = false;
	const finish = (result: ForceQuitResult) => {
		if (completed) return;
		completed = true;
		source = 0;
		onComplete(result);
	};
	const operation = {
		cancel() {
			if (completed) return;
			completed = true;
			if (source !== 0) GLib.source_remove(source);
			source = 0;
		},
	};

	const currentApplications = getForceQuitApplications();
	if (!currentApplications) {
		finish("unavailable");
		return operation;
	}
	const currentWindows = revalidatedWindows(application, currentApplications);
	if (currentWindows.length === 0) {
		finish("resolved");
		return operation;
	}
	for (const window of currentWindows)
		dispatchHyprland(
			`hl.dsp.window.close({ window = "address:${window.address}" })`,
			{ component: "force-quit", metric: "gracefulClose" },
		);

	source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, gracefulCloseMs, () => {
		source = 0;
		if (completed) return GLib.SOURCE_REMOVE;
		const applications = getForceQuitApplications();
		if (!applications) {
			finish("unavailable");
			return GLib.SOURCE_REMOVE;
		}
		const survivors = revalidatedWindows(application, applications);
		if (survivors.length === 0) {
			finish("resolved");
			return GLib.SOURCE_REMOVE;
		}
		for (const pid of new Set(survivors.map((window) => window.pid))) {
			try {
				Gio.Subprocess.new(["kill", "-KILL", pid.toString()], Gio.SubprocessFlags.NONE);
			} catch (error) {
				console.error(`Failed to terminate process ${pid}:`, error);
			}
		}
		source = GLib.timeout_add(
			GLib.PRIORITY_DEFAULT,
			forcedTerminationSettleMs,
			() => {
				finish("terminated");
				return GLib.SOURCE_REMOVE;
			},
		);
		return GLib.SOURCE_REMOVE;
	});
	return operation;
}
