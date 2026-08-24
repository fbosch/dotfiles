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
const READY_PROBE_TIMEOUT_MS = 250;
const READY_RETRY_MS = 50;
const CONTROL_TIMEOUT_MS = 1_000;
const STOP_GRACE_MS = 1_000;

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => {
		GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
			resolve();
			return GLib.SOURCE_REMOVE;
		});
	});
}

function waitForCommand(process: Gio.Subprocess, timeoutMs: number): Promise<void> {
	return new Promise((resolve, reject) => {
		let settled = false;
		let timeoutId = GLib.timeout_add(
			GLib.PRIORITY_DEFAULT,
			timeoutMs,
			() => {
				timeoutId = 0;
				if (settled) return GLib.SOURCE_REMOVE;
				settled = true;
				try {
					process.force_exit();
				} catch {
					// The process can exit before its completion callback reaches this context.
				}
				reject(new Error("AGS control command timed out"));
				return GLib.SOURCE_REMOVE;
			},
		);
		void process.wait_check_async(null).then(
			() => {
				if (settled) return;
				settled = true;
				if (timeoutId !== 0) GLib.source_remove(timeoutId);
				timeoutId = 0;
				resolve();
			},
			(error) => {
				if (settled) return;
				settled = true;
				if (timeoutId !== 0) GLib.source_remove(timeoutId);
				timeoutId = 0;
				reject(error);
			},
		);
	});
}

async function runAgs(argv: string[], timeoutMs: number): Promise<void> {
	const executable = GLib.find_program_in_path("ags");
	if (!executable) throw new Error("ags executable is unavailable");
	const process = Gio.Subprocess.new(
		[executable, ...argv],
		Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE,
	);
	await waitForCommand(process, timeoutMs);
}

async function waitUntilReady(isCompleted: () => boolean): Promise<void> {
	const deadline = GLib.get_monotonic_time() + READY_TIMEOUT_MS * 1_000;
	while (GLib.get_monotonic_time() < deadline) {
		if (isCompleted()) throw new Error("utility exited during startup");
		try {
			await runAgs(
				["request", "-i", aboutThisPCIsolatedInstance, ""],
				READY_PROBE_TIMEOUT_MS,
			);
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
	const parentPid = Gio.Credentials.new().get_unix_pid();
	const process = Gio.Subprocess.new(
		[
			`${home}/.config/ags/scripts/run-isolated-utility.sh`,
			parentPid.toString(),
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
		request(action) {
			return runAgs(
				[
					"request",
					"-i",
					aboutThisPCIsolatedInstance,
					"about-this-pc",
					JSON.stringify({ action }),
				],
				CONTROL_TIMEOUT_MS,
			);
		},
		terminate() {
			if (completed === false) process.send_signal(15);
		},
		stop() {
			stopping ??= (async () => {
				if (completed) return;
				try {
					await runAgs(
						[
							"request",
							"-i",
							aboutThisPCIsolatedInstance,
							"about-this-pc",
							JSON.stringify({ action: "hide" }),
						],
						CONTROL_TIMEOUT_MS,
					);
				} catch {
					process.send_signal(15);
				}
				await Promise.race([completion, delay(STOP_GRACE_MS)]);
				if (completed === false) {
					process.send_signal(15);
					await Promise.race([completion, delay(STOP_GRACE_MS)]);
				}
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
