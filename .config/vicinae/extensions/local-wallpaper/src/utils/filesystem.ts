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
		const files = await fs.readdir(expandedDir, { withFileTypes: true });

		// Filter and map to LocalWallpaper objects
		const wallpapers: LocalWallpaper[] = [];

		for (const file of files) {
			if (!file.isFile()) continue;

			const ext = path.extname(file.name).toLowerCase().slice(1);
			if (!extensions.includes(ext)) continue;

			const filePath = path.join(expandedDir, file.name);
			const stats = await fs.stat(filePath);

			wallpapers.push({
				id: file.name,
				name: path.basename(file.name, path.extname(file.name)),
				path: file.name,
				absolutePath: filePath,
				size: stats.size,
				modified: stats.mtime,
				extension: ext,
			});
		}

		// Sort wallpapers
		return sortWallpapers(wallpapers, sortBy);
	} catch (error) {
		console.error("Error scanning wallpapers:", error);
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
		console.error("Error getting image dimensions:", error);
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
