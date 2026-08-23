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
const previewCacheDirectory = GLib.file_test("/dev/shm", GLib.FileTest.IS_DIR)
	? "/dev/shm/hypr-window-captures"
	: `${GLib.get_tmp_dir()}/hypr-window-captures`;

export type PreviewInfo = {
	mtime: number;
	width: number;
	height: number;
	texture?: Gdk.Texture;
};

export class PreviewCache {
	#entries = new Map<string, PreviewInfo>();
	#monitor: Gio.FileMonitor | null = null;

	constructor(private readonly onPreviewChanged: () => void) {}

	startMonitoring(): void {
		if (
			this.#monitor ||
			GLib.file_test(previewCacheDirectory, GLib.FileTest.IS_DIR) === false
		)
			return;

		this.#monitor = Gio.File.new_for_path(
			previewCacheDirectory,
		).monitor_directory(Gio.FileMonitorFlags.NONE, null);
		this.#monitor.connect("changed", (_monitor, file, otherFile) => {
			const paths = [file.get_path(), otherFile?.get_path()];
			const changedPreview = paths.some(
				(path) =>
					path?.startsWith(`${previewCacheDirectory}/`) &&
					path.endsWith(".jpg"),
			);
			if (changedPreview === false) return;

			for (const path of paths) if (path) this.#entries.delete(path);
			this.onPreviewChanged();
		});
	}

	dispose(): void {
		this.#monitor?.cancel();
		this.#monitor = null;
	}

	getPath(window: WindowInfo): string | null {
		const ids = [window.stableId, window.address.replace(/^0x/, "")].filter(
			(id): id is string => Boolean(id),
		);
		for (const id of ids) {
			const path = `${previewCacheDirectory}/${id}.jpg`;
			try {
				if (Gio.File.new_for_path(path).query_exists(null)) return path;
			} catch (error) {
				console.error(`Failed to find preview for ${id}:`, error);
			}
		}
		return null;
	}

	getInfo(path: string | null, size?: WindowInfo["size"]): PreviewInfo {
    const mark = perf.start("window-switcher", "getPreviewInfo");
		if (!path)
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
			if (!success || !contents)
        return finishPreviewInfo(mark, {
					mtime,
					...fallbackPreviewDimensions(size),
				});

			const stream = Gio.MemoryInputStream.new_from_bytes(
				new GLib.Bytes(contents),
			);
			const pixbuf = GdkPixbuf.Pixbuf.new_from_stream(stream, null);
			if (!pixbuf)
        return finishPreviewInfo(mark, {
					mtime,
					...fallbackPreviewDimensions(size),
				});

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
			console.error("Failed to get preview info:", error);
			mark.end(false, String(error));
			return { mtime: 0, ...fallbackPreviewDimensions(size) };
		}
	}

	getMtime(path: string | null): number | null {
		if (!path) return null;
		try {
			return previewMtime(
				Gio.File.new_for_path(path).query_info(
					"time::modified,time::modified-usec",
					Gio.FileQueryInfoFlags.NONE,
					null,
				),
			);
		} catch (error) {
			console.error("Failed to read preview mtime:", error);
			return null;
		}
	}

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
