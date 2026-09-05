import Gdk from "gi://Gdk?version=4.0";
import GdkPixbuf from "gi://GdkPixbuf?version=2.0";
import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { perf } from "@/services/performance-monitor";
import type { WindowInfo } from "./machine";
import {
	fallbackPreviewDimensions,
	scaledPreviewDimensions,
} from "./preview-policy";

export type PreviewInfo = {
	mtime: number;
	width: number;
	height: number;
	texture?: Gdk.Texture;
};

export class PreviewCache {
	#entries = new Map<string, PreviewInfo>();
	#monitor: Gio.FileMonitor | null = null;
	readonly #previewDirectory: string | null;
	#reportedErrors = new Set<string>();

	constructor(private readonly onPreviewChanged: () => void) {
		// Keep each cache bound to the Hyprland instance that created it.
		this.#previewDirectory = previewDirectoryFromEnvironment();
	}

	startMonitoring(): void {
		const previewDirectory = this.#previewDirectory;
		if (this.#monitor || !previewDirectory) return;

		// Captures can arrive after activation, so watch a directory we create first.
		if (GLib.mkdir_with_parents(previewDirectory, 0o700) !== 0) {
			this.#reportError("create", previewDirectory, new Error("Could not create preview directory"));
			return;
		}

		try {
			this.#monitor = Gio.File.new_for_path(
				previewDirectory,
			).monitor_directory(Gio.FileMonitorFlags.NONE, null);
			this.#monitor.connect("changed", (_monitor, file, otherFile) => {
				const paths = [file.get_path(), otherFile?.get_path()];
				const changedPreview = paths.some(
					(path) => path && isPreviewPath(path, previewDirectory),
				);
				if (changedPreview === false) return;

				for (const path of paths) if (path) this.#entries.delete(path);
				this.onPreviewChanged();
			});
		} catch (error) {
			this.#monitor?.cancel();
			this.#monitor = null;
			this.#reportError("monitor", previewDirectory, error);
		}
	}

	dispose(): void {
		this.#monitor?.cancel();
		this.#monitor = null;
	}

	getPath(window: WindowInfo): string | null {
		const previewDirectory = this.#previewDirectory;
		if (!previewDirectory) return null;

		const ids = [window.stableId, window.address.replace(/^0x/, "")].filter(
			(id): id is string => Boolean(id),
		);
		for (const id of ids) {
			const path = GLib.build_filenamev([previewDirectory, `${id}.jpg`]);
			try {
				if (Gio.File.new_for_path(path).query_exists(null)) return path;
			} catch (error) {
				this.#reportError("find", path, error);
			}
		}
		return null;
	}

	getInfo(path: string | null, size?: WindowInfo["size"]): PreviewInfo {
		const mark = perf.start("window-switcher", "getPreviewInfo");
		if (!path || !this.#isPreviewPath(path))
			return finishPreviewInfo(mark, {
				mtime: 0,
				...fallbackPreviewDimensions(size),
			});

		try {
			const file = Gio.File.new_for_path(path);
			const mtime = previewMtime(
				file.query_info(
					"time::modified,time::modified-usec",
					Gio.FileQueryInfoFlags.NONE,
					null,
				),
			);
			const cached = this.#entries.get(path);
			if (cached?.mtime === mtime) return finishPreviewInfo(mark, cached);

			const [success, contents] = file.load_contents(null);
			if (!success || !contents) {
				this.#reportError("read", path, new Error("Preview contents were empty"));
				return finishPreviewInfo(mark, {
					mtime,
					...fallbackPreviewDimensions(size),
				});
			}

			const stream = Gio.MemoryInputStream.new_from_bytes(
				new GLib.Bytes(contents),
			);
			const pixbuf = GdkPixbuf.Pixbuf.new_from_stream(stream, null);
			if (!pixbuf) {
				this.#reportError("decode", path, new Error("Preview image was invalid"));
				return finishPreviewInfo(mark, {
					mtime,
					...fallbackPreviewDimensions(size),
				});
			}

			const dimensions = scaledPreviewDimensions(
				pixbuf.get_width(),
				pixbuf.get_height(),
			);
			const scaled = pixbuf.scale_simple(
				dimensions.width,
				dimensions.height,
				GdkPixbuf.InterpType.BILINEAR,
			);
			const entry = {
				mtime,
				...dimensions,
				texture: scaled ? Gdk.Texture.new_for_pixbuf(scaled) : undefined,
			};
			this.#entries.set(path, entry);
			if (this.#entries.size > 100) this.#entries.clear();
			return finishPreviewInfo(mark, entry);
		} catch (error) {
			this.#reportError("read", path, error);
			mark.end(false, String(error));
			return { mtime: 0, ...fallbackPreviewDimensions(size) };
		}
	}

	getMtime(path: string | null): number | null {
		if (!path || !this.#isPreviewPath(path)) return null;
		try {
			return previewMtime(
				Gio.File.new_for_path(path).query_info(
					"time::modified,time::modified-usec",
					Gio.FileQueryInfoFlags.NONE,
					null,
				),
			);
		} catch (error) {
			this.#reportError("mtime", path, error);
			return null;
		}
	}

	#isPreviewPath(path: string): boolean {
		return (
			this.#previewDirectory !== null &&
			isPreviewPath(path, this.#previewDirectory)
		);
	}

	#reportError(operation: string, path: string, error: unknown): void {
		if (this.#reportedErrors.has(operation)) return;
		this.#reportedErrors.add(operation);
		console.error(`Failed to ${operation} window preview ${path}:`, error);
	}
}

function previewDirectoryFromEnvironment(): string | null {
	const runtimeDirectory = GLib.getenv("XDG_RUNTIME_DIR");
	const instanceSignature = GLib.getenv("HYPRLAND_INSTANCE_SIGNATURE");
	if (!runtimeDirectory || !instanceSignature) return null;
	return GLib.build_filenamev([
		runtimeDirectory,
		"hypr",
		instanceSignature,
		"window-captures",
	]);
}

function isPreviewPath(path: string, previewDirectory: string): boolean {
	return GLib.path_get_dirname(path) === previewDirectory && path.endsWith(".jpg");
}

function finishPreviewInfo(
	mark: ReturnType<typeof perf.start>,
	info: PreviewInfo,
): PreviewInfo {
	mark.end(true);
	return info;
}

function previewMtime(info: Gio.FileInfo): number {
	const modified = info.get_modification_time();
	return modified.tv_sec * 1_000_000 + modified.tv_usec;
}
