import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { grimGeometry, parseSelectionGeometry, type SelectionGeometry } from "./selection";

const captureDirectoryName = "ai-pointer";
const capturePrefix = "capture-";
const maximumCaptureBytes = 20 * 1024 * 1024;
const selectionTimeoutMs = 60_000;
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
		GLib.unlink(path);
	} catch {
		// Controlled cleanup is best effort after a failed or cancelled capture.
	}
}

export async function captureSelection(
	directory: string,
	cancellable: Gio.Cancellable,
	onProcess: ProcessObserver,
): Promise<CaptureResult> {
	const slurp = GLib.find_program_in_path("slurp");
	if (!slurp) return { kind: "failed", message: "slurp is unavailable." };
	const grim = GLib.find_program_in_path("grim");
	if (!grim) return { kind: "failed", message: "grim is unavailable." };

	const selection = await runCommand(
		[slurp, "-f", "%x,%y %wx%h"],
		cancellable,
		selectionTimeoutMs,
		onProcess,
	);
	if (cancellable.is_cancelled()) return { kind: "cancelled" };
	if (!selection || selection.success === false) return { kind: "cancelled" };

	const geometry = parseSelectionGeometry(selection.stdout);
	if (!geometry) return { kind: "failed", message: "The selected region is invalid." };

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
	if (!capture || capture.success === false || isValidCapture(path) === false) {
		deleteCapture(path);
		return { kind: "failed", message: "The selected region could not be captured." };
	}

	return { kind: "captured", capture: { path, geometry } };
}

async function runCommand(
	argv: string[],
	cancellable: Gio.Cancellable,
	timeoutMs: number,
	onProcess: ProcessObserver,
): Promise<{ success: boolean; stdout: string } | null> {
	let process: Gio.Subprocess;
	try {
		process = Gio.Subprocess.new(
			argv,
			Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
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
		const [stdout] = await process.communicate_utf8_async(null, cancellable);
		return { success: process.get_successful(), stdout: stdout ?? "" };
	} catch {
		return null;
	} finally {
		if (timeoutId !== 0) GLib.source_remove(timeoutId);
		cancellable.disconnect(cancellationId);
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
