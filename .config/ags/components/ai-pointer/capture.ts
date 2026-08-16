import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { grimGeometry, type SelectionGeometry } from "./selection";

Gio._promisify(Gio.Subprocess.prototype, "wait_async", "wait_finish");

const captureDirectoryName = "ai-pointer";
const capturePrefix = "capture-";
const maximumCaptureBytes = 20 * 1024 * 1024;
const captureTimeoutMs = 10_000;
const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface Capture {
	path: string;
	geometry: SelectionGeometry;
}

export type CaptureResult =
	| { kind: "captured"; capture: Capture }
	| { kind: "cancelled" }
	| { kind: "failed"; message: string };

type ProcessObserver = (process: Gio.Subprocess | null) => void;

export function prepareCaptureDirectory(): string | null {
	const runtimeDirectory = GLib.getenv("XDG_RUNTIME_DIR");
	if (!runtimeDirectory) return null;

	const directory = GLib.build_filenamev([runtimeDirectory, captureDirectoryName]);
	try {
		if (GLib.mkdir_with_parents(directory, 0o700) !== 0) return null;
		GLib.chmod(directory, 0o700);
		removeStaleCaptures(directory);
		return directory;
	} catch {
		return null;
	}
}

export function deleteCapture(path: string): void {
	if (isFeatureCapture(path) === false) return;
	try {
		Gio.File.new_for_path(path).delete(null);
	} catch {
		// Controlled cleanup is best effort after a failed or cancelled capture.
	}
}

export async function captureRegion(
	directory: string,
	geometry: SelectionGeometry,
	cancellable: Gio.Cancellable,
	onProcess: ProcessObserver,
): Promise<CaptureResult> {
	const grim = GLib.find_program_in_path("grim");
	if (!grim) return { kind: "failed", message: "grim is unavailable." };

	const path = GLib.build_filenamev([
		directory,
		`${capturePrefix}${GLib.uuid_string_random()}.png`,
	]);
	const capture = await runCommand(
		[grim, "-g", grimGeometry(geometry), path],
		cancellable,
		captureTimeoutMs,
		onProcess,
	);
	if (cancellable.is_cancelled()) {
		deleteCapture(path);
		return { kind: "cancelled" };
	}
	if (!capture) {
		deleteCapture(path);
		return { kind: "failed", message: "The screenshot process did not complete." };
	}
	if (capture.success === false) {
		deleteCapture(path);
		return {
			kind: "failed",
			message: `The screenshot process exited unsuccessfully: ${capture.error ?? "unknown error"}`,
		};
	}
	if (isValidCapture(path) === false) {
		deleteCapture(path);
		return { kind: "failed", message: "The screenshot failed PNG validation." };
	}

	return { kind: "captured", capture: { path, geometry } };
}

async function runCommand(
	argv: string[],
	cancellable: Gio.Cancellable,
	timeoutMs: number,
	onProcess: ProcessObserver,
): Promise<{ success: boolean; error?: string } | null> {
	let process: Gio.Subprocess;
	try {
		process = Gio.Subprocess.new(
			argv,
			Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_PIPE,
		);
	} catch {
		return null;
	}

	onProcess(process);
	const cancellationId = cancellable.connect(() => process.force_exit());
	let timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeoutMs, () => {
		timeoutId = 0;
		cancellable.cancel();
		process.force_exit();
		return GLib.SOURCE_REMOVE;
	});
	try {
		await process.wait_async(cancellable);
		const errorBytes = process.get_stderr_pipe()?.read_bytes(4_096, null);
		const error = errorBytes ? new TextDecoder().decode(errorBytes.get_data()).trim() : "";
		return { success: process.get_successful(), error: error || undefined };
	} catch (error) {
		return { success: false, error: String(error) };
	} finally {
		try {
			if (timeoutId !== 0) GLib.source_remove(timeoutId);
		} catch {
			// The source may already have removed itself after a timeout.
		}
		try {
			cancellable.disconnect(cancellationId);
		} catch {
			// Cancellation may disconnect its handlers while unwinding.
		}
		onProcess(null);
	}
}

function isValidCapture(path: string): boolean {
	try {
		const file = Gio.File.new_for_path(path);
		const info = file.query_info(
			"standard::type,standard::size",
			Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
			null,
		);
		if (
			info.get_file_type() !== Gio.FileType.REGULAR ||
			info.get_size() <= 0 ||
			info.get_size() > maximumCaptureBytes
		)
			return false;
		const [loaded, bytes] = file.load_contents(null);
		return loaded && bytes ? pngSignature.every((byte, index) => bytes[index] === byte) : false;
	} catch {
		return false;
	}
}

function removeStaleCaptures(directoryPath: string): void {
	const directory = Gio.File.new_for_path(directoryPath);
	let enumerator: Gio.FileEnumerator | null = null;
	try {
		enumerator = directory.enumerate_children(
			"standard::name,standard::type",
			Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
			null,
		);
		while (true) {
			const info = enumerator.next_file(null);
			if (!info) break;
			const name = info.get_name();
			if (!name || isFeatureCaptureName(name) === false) continue;
			directory.get_child(name).delete(null);
		}
	} catch {
		// A stale capture must never prevent a fresh user-selected capture.
	} finally {
		enumerator?.close(null);
	}
}

function isFeatureCapture(path: string): boolean {
	const runtimeDirectory = GLib.getenv("XDG_RUNTIME_DIR");
	if (!runtimeDirectory) return false;
	const expectedDirectory = GLib.build_filenamev([runtimeDirectory, captureDirectoryName]);
	return (
		GLib.path_get_dirname(path) === expectedDirectory &&
		isFeatureCaptureName(GLib.path_get_basename(path))
	);
}

function isFeatureCaptureName(name: string): boolean {
	return new RegExp(`^${capturePrefix}[0-9a-f-]+\\.png$`, "i").test(name);
}
