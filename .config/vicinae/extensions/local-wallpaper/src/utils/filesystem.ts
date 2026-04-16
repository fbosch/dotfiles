import type { LocalWallpaper, SortOption } from "../types";

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
): Promise<LocalWallpaper[]> {
	try {
		const fs = await import("node:fs/promises");
		const path = await import("node:path");

		const expandedDir = expandPath(directory);

		// Check if directory exists
		try {
			await fs.access(expandedDir);
		} catch {
			throw new Error(`Directory does not exist: ${expandedDir}`);
		}

		// Read directory
		const wallpapers: LocalWallpaper[] = [];
		const directories = [expandedDir];

		while (directories.length > 0) {
			const currentDirectory = directories.pop();
			if (currentDirectory === undefined) {
				continue;
			}

			const entries = await fs.readdir(currentDirectory, { withFileTypes: true });

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
				if (extensions.includes(extension) === false) {
					continue;
				}

				const stats = await fs.stat(absolutePath);
				const relativePath = path.relative(expandedDir, absolutePath);

				wallpapers.push({
					id: relativePath,
					name: path.basename(entry.name, path.extname(entry.name)),
					path: relativePath,
					absolutePath,
					size: stats.size,
					modified: stats.mtime,
					extension,
				});
			}
		}

		// Sort wallpapers
		return sortWallpapers(wallpapers, sortBy);
	} catch (error) {
		throw error;
	}
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
		// This requires image-size package or similar
		// For now, we'll return null and handle it gracefully
		// You could add image-size as a dependency if needed
		return null;
	} catch (error) {
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
