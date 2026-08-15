import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { dispatchHyprland } from "../../services/hyprland-ipc";
import {
	getForceQuitApplications,
	readProcessStartTime,
} from "./application-repository";
import {
	type ForceQuitApplication,
	type ForceQuitWindow,
	revalidatedWindows,
} from "./model";

export type ForceQuitResult = "resolved" | "terminated" | "unavailable";

export interface ForceQuitOperation {
	cancel(): void;
}

export interface ForceQuitTerminationDependencies {
	getApplications(): ForceQuitApplication[] | null;
	dispatch(expression: string): void;
	signal(windows: ForceQuitWindow[]): void;
	schedule(delayMs: number, callback: () => void): number;
	cancelSource(source: number): void;
}

const gracefulCloseMs = 1_500;
const forcedTerminationSettleMs = 250;

export function forceQuitApplication(
	application: ForceQuitApplication,
	onComplete: (result: ForceQuitResult) => void,
	dependencies: ForceQuitTerminationDependencies = defaultDependencies,
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
			if (source !== 0) dependencies.cancelSource(source);
			source = 0;
		},
	};

	const currentApplications = dependencies.getApplications();
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
		dependencies.dispatch(
			`hl.dsp.window.close({ window = "address:${window.address}" })`,
		);

	source = dependencies.schedule(gracefulCloseMs, () => {
		source = 0;
		if (completed) return;
		const applications = dependencies.getApplications();
		if (!applications) {
			finish("unavailable");
			return;
		}
		const survivors = revalidatedWindows(application, applications);
		if (survivors.length === 0) {
			finish("resolved");
			return;
		}
		dependencies.signal(survivors);
		source = dependencies.schedule(forcedTerminationSettleMs, () =>
			finish("terminated"),
		);
	});
	return operation;
}

const defaultDependencies: ForceQuitTerminationDependencies = {
	getApplications: () => getForceQuitApplications(),
	dispatch: (expression) =>
		dispatchHyprland(expression, {
			component: "force-quit",
			metric: "gracefulClose",
		}),
	signal: (windows) => {
		const byPid = new Map(windows.map((window) => [window.pid, window]));
		for (const [pid, window] of byPid) {
			if (
			typeof window.processStartTime !== "number" ||
			readProcessStartTime(pid) !== window.processStartTime
			)
			continue;
			try {
				Gio.Subprocess.new(["kill", "-KILL", pid.toString()], Gio.SubprocessFlags.NONE);
			} catch (error) {
				console.error(`Failed to terminate process ${pid}:`, error);
			}
		}
	},
	schedule: (delayMs, callback) =>
		GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
			callback();
			return GLib.SOURCE_REMOVE;
		}),
	cancelSource: (source) => GLib.source_remove(source),
};
