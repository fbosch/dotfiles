import type { LocalWallpaper, SortOption } from "../types";

type WallpaperCacheRecord = {
	wallpaper: LocalWallpaper;
	mtimeMs: number;
	size: number;
	directory: string;
};

type DirectoryScanState = {
	mtimeMs: number;
	filePaths: Set<string>;
};

type WallpaperScanCache = {
	records: Map<string, WallpaperCacheRecord>;
	directoryState: Map<string, DirectoryScanState>;
};

const wallpaperScanCache = new Map<string, WallpaperScanCache>();

function normalizeExtensions(extensions: string[]): string[] {
	return extensions
		.map((extension) => extension.trim().toLowerCase())
		.filter((extension) => extension.length > 0);
}

function createScanCacheKey(directory: string, extensions: string[]): string {
	const normalizedExtensions = [...extensions].sort().join(",");
	return `${directory}::${normalizedExtensions}`;
}

/**
 * Expands ~ to home directory in a path
 */
export function expandPath(path: string): string {
	return path.replace(/^~/, process.env.HOME || process.env.USERPROFILE || "");
}

/**
 * Scans the wallpapers directory and returns a list of wallpaper files
 */
export async function scanWallpapers(
	directory: string,
	extensions: string[],
	sortBy: SortOption = "name",
	options?: { forceRescan?: boolean },
): Promise<LocalWallpaper[]> {
	const fs = await import("node:fs/promises");
	const path = await import("node:path");

	const expandedDir = expandPath(directory);
	const normalizedExtensions = normalizeExtensions(extensions);
	const extensionSet = new Set(normalizedExtensions);
	const cacheKey = createScanCacheKey(expandedDir, normalizedExtensions);
	const previousCache =
		options?.forceRescan === true ? undefined : wallpaperScanCache.get(cacheKey);

	try {
		await fs.access(expandedDir);
	} catch {
		throw new Error(`Directory does not exist: ${expandedDir}`);
	}

	const wallpapers: LocalWallpaper[] = [];
	const directories = [expandedDir];
	const nextRecords = new Map<string, WallpaperCacheRecord>();
	const nextDirectoryState = new Map<string, DirectoryScanState>();

	while (directories.length > 0) {
		const currentDirectory = directories.pop();
		if (currentDirectory === undefined) {
			continue;
		}

		const entries = await fs.readdir(currentDirectory, { withFileTypes: true });
		const directoryStat = await fs.stat(currentDirectory);
		const previousDirectoryState = previousCache?.directoryState.get(currentDirectory);
		const directoryUnchanged =
			previousDirectoryState?.mtimeMs === directoryStat.mtimeMs;
		const directoryFilePaths = new Set<string>();

		for (const entry of entries) {
			const absolutePath = path.join(currentDirectory, entry.name);

			if (entry.isDirectory()) {
				directories.push(absolutePath);
				continue;
			}

			if (entry.isFile() === false) {
				continue;
			}

			const extension = path.extname(entry.name).toLowerCase().slice(1);
			if (extensionSet.has(extension) === false) {
				continue;
			}

			directoryFilePaths.add(absolutePath);
			const previousRecord = previousCache?.records.get(absolutePath);

			if (
				directoryUnchanged &&
				previousRecord !== undefined &&
				previousRecord.directory === currentDirectory
			) {
				wallpapers.push(previousRecord.wallpaper);
				nextRecords.set(absolutePath, previousRecord);
				continue;
			}

			const stats = await fs.stat(absolutePath);
			if (
				previousRecord !== undefined &&
				previousRecord.mtimeMs === stats.mtimeMs &&
				previousRecord.size === stats.size
			) {
				wallpapers.push(previousRecord.wallpaper);
				nextRecords.set(absolutePath, previousRecord);
				continue;
			}

			const relativePath = path.relative(expandedDir, absolutePath);
			const wallpaper: LocalWallpaper = {
				id: relativePath,
				name: path.basename(entry.name, path.extname(entry.name)),
				path: relativePath,
				absolutePath,
				size: stats.size,
				modified: stats.mtime,
				extension,
			};

			wallpapers.push(wallpaper);
			nextRecords.set(absolutePath, {
				wallpaper,
				mtimeMs: stats.mtimeMs,
				size: stats.size,
				directory: currentDirectory,
			});
		}

		nextDirectoryState.set(currentDirectory, {
			mtimeMs: directoryStat.mtimeMs,
			filePaths: directoryFilePaths,
		});
	}

	wallpaperScanCache.set(cacheKey, {
		records: nextRecords,
		directoryState: nextDirectoryState,
	});

	return sortWallpapers(wallpapers, sortBy);
}

export async function watchWallpapersDirectory(
	directory: string,
	onChange: () => void,
): Promise<() => void> {
	const fs = await import("node:fs");
	const fsPromises = await import("node:fs/promises");
	const path = await import("node:path");

	const expandedDir = expandPath(directory);
	let closed = false;
	let syncTimer: ReturnType<typeof setTimeout> | undefined;
	let changeTimer: ReturnType<typeof setTimeout> | undefined;
	const watchers = new Map<string, import("node:fs").FSWatcher>();

	const triggerChange = () => {
		if (changeTimer !== undefined) {
			clearTimeout(changeTimer);
		}

		changeTimer = setTimeout(() => {
			if (closed) {
				return;
			}

			onChange();
		}, 150);
	};

	const scheduleSync = () => {
		if (syncTimer !== undefined) {
			clearTimeout(syncTimer);
		}

		syncTimer = setTimeout(() => {
			void syncWatchers();
		}, 300);
	};

	const listDirectories = async (): Promise<Set<string>> => {
		const result = new Set<string>();
		const queue = [expandedDir];

		while (queue.length > 0) {
			const currentDirectory = queue.pop();
			if (currentDirectory === undefined) {
				continue;
			}

			result.add(currentDirectory);

			let entries: import("node:fs").Dirent[];
			try {
				entries = await fsPromises.readdir(currentDirectory, {
					withFileTypes: true,
				});
			} catch {
				continue;
			}

			for (const entry of entries) {
				if (entry.isDirectory() === false) {
					continue;
				}

				queue.push(path.join(currentDirectory, entry.name));
			}
		}

		return result;
	};

	const attachWatcher = (directoryPath: string) => {
		if (watchers.has(directoryPath)) {
			return;
		}

		try {
			const watcher = fs.watch(directoryPath, () => {
				triggerChange();
				scheduleSync();
			});

			watcher.on("error", () => {
				scheduleSync();
			});

			watchers.set(directoryPath, watcher);
		} catch {
			// Ignore directories that cannot be watched.
		}
	};

	const syncWatchers = async () => {
		if (closed) {
			return;
		}

		const directoriesToWatch = await listDirectories();

		for (const directoryPath of directoriesToWatch) {
			attachWatcher(directoryPath);
		}

		for (const [directoryPath, watcher] of watchers.entries()) {
			if (directoriesToWatch.has(directoryPath)) {
				continue;
			}

			watcher.close();
			watchers.delete(directoryPath);
		}
	};

	await syncWatchers();

	return () => {
		closed = true;

		if (syncTimer !== undefined) {
			clearTimeout(syncTimer);
		}

		if (changeTimer !== undefined) {
			clearTimeout(changeTimer);
		}

		for (const watcher of watchers.values()) {
			watcher.close();
		}

		watchers.clear();
	};
}

export async function moveFileToTrash(filePath: string): Promise<void> {
	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const execFileAsync = promisify(execFile);

	const commands: Array<{ command: string; args: string[] }> = [
		{ command: "gio", args: ["trash", filePath] },
		{ command: "kioclient5", args: ["move", filePath, "trash:/"] },
		{ command: "trash-put", args: [filePath] },
		{ command: "gvfs-trash", args: [filePath] },
	];

	for (const { command, args } of commands) {
		try {
			await execFileAsync(command, args);
			return;
		} catch {
			continue;
		}
	}

	throw new Error(
		"No supported trash command found (tried gio, kioclient5, trash-put, gvfs-trash)",
	);
}

/**
 * Sorts wallpapers based on the given sort option
 */
export function sortWallpapers(
	wallpapers: LocalWallpaper[],
	sortBy: SortOption,
): LocalWallpaper[] {
	const sorted = [...wallpapers];

	switch (sortBy) {
		case "name":
			return sorted.sort((a, b) => a.name.localeCompare(b.name));

		case "modified-desc":
			return sorted.sort((a, b) => b.modified.getTime() - a.modified.getTime());

		case "modified-asc":
			return sorted.sort((a, b) => a.modified.getTime() - b.modified.getTime());

		case "size-desc":
			return sorted.sort((a, b) => b.size - a.size);

		case "size-asc":
			return sorted.sort((a, b) => a.size - b.size);

		default:
			return sorted;
	}
}

/**
 * Gets image dimensions from a file
 */
export async function getImageDimensions(
	_filePath: string,
): Promise<{ width: number; height: number } | null> {
	try {
		return null;
	} catch {
		return null;
	}
}

/**
 * Formats file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${Math.round((bytes / k ** i) * 100) / 100} ${sizes[i]}`;
}

/**
 * Formats date in a human-readable format
 */
export function formatDate(date: Date): string {
	return date.toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}
