import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";

Gio._promisify(Gio.Subprocess.prototype, "wait_async", "wait_finish");

export type ProcessObserver = (process: Gio.Subprocess | null) => void;

interface OwnedProcessOptions {
	cancellationGraceMs?: number;
	onCancel?: () => void;
	onProcess: ProcessObserver;
	onTimeout?: () => void;
	parentCancellable: Gio.Cancellable;
	timeoutMs: number;
}

export interface OwnedProcess {
	readonly timedOut: boolean;
	dispose(): Promise<void>;
	terminate(): void;
	wait(): Promise<boolean>;
}

export function ownProcess(
	process: Gio.Subprocess,
	options: OwnedProcessOptions,
): OwnedProcess {
	let cancelled = false;
	let disposed: Promise<void> | null = null;
	let forceExitId = 0;
	let settled = false;
	let terminated = false;
	let timedOut = false;
	let timeoutId = 0;

	options.onProcess(process);
	const completion = process.wait_async(null).then(
		() => {
			settled = true;
			return true;
		},
		() => {
			settled = true;
			return false;
		},
	);

	const forceExit = () => {
		process.force_exit();
	};
	const terminate = () => {
		if (settled || terminated) return;
		terminated = true;
		if (options.cancellationGraceMs === undefined) {
			forceExit();
			return;
		}
		try {
			process.send_signal(2);
		} catch {
			forceExit();
			return;
		}
		forceExitId = GLib.timeout_add(
			GLib.PRIORITY_DEFAULT,
			options.cancellationGraceMs,
			() => {
				forceExitId = 0;
				forceExit();
				return GLib.SOURCE_REMOVE;
			},
		);
	};
	const cancel = () => {
		if (cancelled) return;
		cancelled = true;
		try {
			options.onCancel?.();
		} finally {
			terminate();
		}
	};
	const cancellationId = options.parentCancellable.connect(cancel);
	timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, options.timeoutMs, () => {
		timeoutId = 0;
		timedOut = true;
		try {
			options.onTimeout?.();
		} finally {
			terminate();
		}
		return GLib.SOURCE_REMOVE;
	});
	if (options.parentCancellable.is_cancelled()) cancel();

	return {
		get timedOut() {
			return timedOut;
		},
		dispose() {
			disposed ??= (async () => {
				if (timeoutId !== 0) GLib.source_remove(timeoutId);
				if (forceExitId !== 0) GLib.source_remove(forceExitId);
				try {
					options.parentCancellable.disconnect(cancellationId);
				} catch {
					// Cancellation may disconnect handlers while the operation unwinds.
				}
				await Promise.resolve();
				if (settled === false) forceExit();
				await completion;
				options.onProcess(null);
			})();
			return disposed;
		},
		terminate,
		wait() {
			return completion;
		},
	};
}
