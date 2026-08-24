import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";

const captureDirectoryName = "ai-pointer";
const capturePrefix = "capture-";

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

export function isFeatureCapture(path: string): boolean {
	const runtimeDirectory = GLib.getenv("XDG_RUNTIME_DIR");
	if (!runtimeDirectory) return false;
	const expectedDirectory = GLib.build_filenamev([runtimeDirectory, captureDirectoryName]);
	return (
		GLib.path_get_dirname(path) === expectedDirectory &&
		isFeatureCaptureName(GLib.path_get_basename(path))
	);
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

function isFeatureCaptureName(name: string): boolean {
	return new RegExp(`^${capturePrefix}[0-9a-f-]+\\.png$`, "i").test(name);
}
