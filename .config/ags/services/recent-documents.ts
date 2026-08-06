import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import type { IconRef } from "./app-icons";

export interface RecentDocument {
	uri: string;
	name: string;
	detail?: string;
	icon: IconRef | null;
	modifiedAt: number;
}

const recentDocumentsPath = `${GLib.get_user_data_dir()}/recently-used.xbel`;

function bookmarkModifiedAt(bookmarks: GLib.BookmarkFile, uri: string): number {
	for (const getDateTime of [
		() => bookmarks.get_modified_date_time(uri),
		() => bookmarks.get_visited_date_time(uri),
		() => bookmarks.get_added_date_time(uri),
	]) {
		try {
			return getDateTime().to_unix();
		} catch {
			// Try the next available bookmark timestamp.
		}
	}
	return 0;
}

function bookmarkName(bookmarks: GLib.BookmarkFile, uri: string): string {
	try {
		const title = bookmarks.get_title(uri)?.trim();
		if (title) return title;
	} catch {
		// Fall back to the URI basename when no title is recorded.
	}

	return Gio.File.new_for_uri(uri).get_basename()?.trim() || uri;
}

function bookmarkDetail(uri: string): string | undefined {
	const parent = Gio.File.new_for_uri(uri).get_parent();
	return parent?.get_path() ?? undefined;
}

function bookmarkIcon(
	bookmarks: GLib.BookmarkFile,
	uri: string,
): IconRef | null {
	try {
		const iconName = Gio.content_type_get_generic_icon_name(
			bookmarks.get_mime_type(uri),
		);
		return iconName ? { kind: "theme", name: iconName } : null;
	} catch {
		return null;
	}
}

export function getRecentDocuments(
	path = recentDocumentsPath,
	limit = 12,
): RecentDocument[] {
	const boundedLimit = Number.isFinite(limit)
		? Math.min(12, Math.max(0, Math.trunc(limit)))
		: 12;
	if (boundedLimit === 0 || !GLib.file_test(path, GLib.FileTest.IS_REGULAR)) {
		return [];
	}

	const bookmarks = new GLib.BookmarkFile();
	try {
		if (!bookmarks.load_from_file(path)) return [];

		const documents = new Map<string, RecentDocument>();
		for (const uri of bookmarks.get_uris()) {
			if (!uri || documents.has(uri)) continue;
			try {
				documents.set(uri, {
					uri,
					name: bookmarkName(bookmarks, uri),
					detail: bookmarkDetail(uri),
					icon: bookmarkIcon(bookmarks, uri),
					modifiedAt: bookmarkModifiedAt(bookmarks, uri),
				});
			} catch {
				// One invalid bookmark should not hide the remaining history.
			}
		}

		return Array.from(documents.values())
			.sort((left, right) => right.modifiedAt - left.modifiedAt)
			.slice(0, boundedLimit);
	} catch (error) {
		console.error("Failed to read recent documents:", error);
		return [];
	}
}

export function openRecentDocument(uri: string): boolean {
	if (!GLib.uri_parse_scheme(uri)) return false;

	try {
		Gio.AppInfo.launch_default_for_uri_async(
			uri,
			null,
			null,
			(_source, result) => {
				try {
					Gio.AppInfo.launch_default_for_uri_finish(result);
				} catch (error) {
					console.error(`Failed to open recent document ${uri}:`, error);
				}
			},
		);
		return true;
	} catch (error) {
		console.error(`Failed to open recent document ${uri}:`, error);
		return false;
	}
}

export function clearRecentDocuments(path = recentDocumentsPath): boolean {
	try {
		return new GLib.BookmarkFile().to_file(path);
	} catch (error) {
		console.error("Failed to clear recent documents:", error);
		return false;
	}
}
