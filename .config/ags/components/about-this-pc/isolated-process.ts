import app from "ags/gtk4/app";
import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import type { IsolatedUtilityProcess } from "./isolated-component";
import {
	aboutThisPCIsolatedExecutable,
	aboutThisPCIsolatedInstance,
} from "./isolated-contract";

Gio._promisify(Gio.Subprocess.prototype, "wait_async", "wait_finish");
Gio._promisify(Gio.Subprocess.prototype, "wait_check_async", "wait_check_finish");

const READY_TIMEOUT_MS = 5_000;
const READY_RETRY_MS = 50;
const STOP_GRACE_MS = 1_000;

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => {
		GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
			resolve();
			return GLib.SOURCE_REMOVE;
		});
	});
}

async function runAgs(argv: string[]): Promise<void> {
	const executable = GLib.find_program_in_path("ags");
	if (!executable) throw new Error("ags executable is unavailable");
	const process = Gio.Subprocess.new(
		[executable, ...argv],
		Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE,
	);
	await process.wait_check_async(null);
}

async function waitUntilReady(isCompleted: () => boolean): Promise<void> {
	const deadline = GLib.get_monotonic_time() + READY_TIMEOUT_MS * 1_000;
	while (GLib.get_monotonic_time() < deadline) {
		if (isCompleted()) throw new Error("utility exited during startup");
		try {
			await runAgs(["request", "-i", aboutThisPCIsolatedInstance, ""]);
			return;
		} catch {
			await delay(READY_RETRY_MS);
		}
	}
	throw new Error("timed out waiting for isolated About This PC");
}

export function launchIsolatedAboutThisPC(): IsolatedUtilityProcess {
	const home = GLib.get_home_dir();
	const runtimeDirectory = GLib.get_user_runtime_dir();
	const process = Gio.Subprocess.new(
		[
			`${home}/.config/ags/scripts/run-isolated-utility.sh`,
			aboutThisPCIsolatedInstance,
			`${runtimeDirectory}/${aboutThisPCIsolatedExecutable}`,
			`${home}/.config/ags/config-about-this-pc.tsx`,
		],
		Gio.SubprocessFlags.NONE,
	);
	let completed = false;
	let stopping: Promise<void> | null = null;
	const completion = process.wait_async(null).then(() => {
		completed = true;
	});
	const ready = waitUntilReady(() => completed);

	return {
		ready,
		completion,
		stop() {
			stopping ??= (async () => {
				if (completed) return;
				try {
					await runAgs(["quit", "-i", aboutThisPCIsolatedInstance]);
				} catch {
					process.send_signal(15);
				}
				await Promise.race([completion, delay(STOP_GRACE_MS)]);
				if (completed === false) process.force_exit();
				await completion;
			})();
			return stopping;
		},
	};
}

export function connectIsolatedAboutThisPCShutdown(callback: () => void): void {
	app.connect("shutdown", callback);
}
