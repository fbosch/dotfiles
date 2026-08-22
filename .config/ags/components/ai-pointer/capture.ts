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
	sha256: string;
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
		return { kind: "failed", message: "The screenshot process exited unsuccessfully." };
	}
	const validated = validateCapture(path, geometry);
	if (!validated) {
		deleteCapture(path);
		return { kind: "failed", message: "The screenshot failed PNG validation." };
	}

	return { kind: "captured", capture: { path, geometry, sha256: validated.sha256 } };
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

export function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
	if (bytes.length < 24 || pngSignature.some((byte, index) => bytes[index] !== byte)) return null;
	const ihdrLength = readUint32(bytes, 8);
	if (ihdrLength !== 13 || bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52)
		return null;
	const width = readUint32(bytes, 16);
	const height = readUint32(bytes, 20);
	return width > 0 && height > 0 ? { width, height } : null;
}

export function sha256(bytes: Uint8Array): string {
	const checksum = new GLib.Checksum(GLib.ChecksumType.SHA256);
	checksum.update(bytes);
	return checksum.get_string();
}

function readUint32(bytes: Uint8Array, offset: number): number {
	return (((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]);
}

function validateCapture(path: string, geometry: SelectionGeometry): { sha256: string } | null {
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
			return null;
		const [loaded, bytes] = file.load_contents(null);
		if (!loaded || !bytes) return null;
		const dimensions = pngDimensions(bytes);
		if (!dimensions || dimensions.width !== geometry.width || dimensions.height !== geometry.height) return null;
		return { sha256: sha256(bytes) };
	} catch {
		return null;
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
