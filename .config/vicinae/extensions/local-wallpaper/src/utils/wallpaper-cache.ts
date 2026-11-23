import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import type { WallpaperConfig } from "./hyprpaper-config";

export async function cacheWallpaperAssignments(
	assignments: Map<string, WallpaperConfig>,
	cacheDirectory = join(homedir(), ".cache", "vicinae", "local-wallpaper", "images"),
): Promise<Map<string, WallpaperConfig>> {
	await mkdir(cacheDirectory, { recursive: true });
	const cached = new Map<string, WallpaperConfig>();
	const paths = new Map<string, string>();
	for (const [monitor, assignment] of assignments) {
		let path = paths.get(assignment.path);
		if (path === undefined) {
			const contents = await readFile(assignment.path);
			const hash = createHash("sha256").update(contents).digest("hex");
			path = join(cacheDirectory, `${hash}${extname(assignment.path).toLowerCase()}`);
			if (assignment.path !== path) {
				const temporaryPath = join(cacheDirectory, `.${randomUUID()}.tmp`);
				try {
					await writeFile(temporaryPath, contents, { flag: "wx" });
					// Publish only complete images; existing assignments may still be in use.
					await rename(temporaryPath, path);
				} finally {
					await rm(temporaryPath, { force: true });
				}
			}
			paths.set(assignment.path, path);
		}
		cached.set(monitor, { ...assignment, path });
	}
	return cached;
}
