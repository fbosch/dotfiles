import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { showToast, Toast } from "@vicinae/api";
import type { FillMode } from "../types";
import { expandPath } from "./filesystem";
import {
	buildHyprpaperConfig,
	parseWallpaperAssignments,
	type WallpaperConfig,
} from "./hyprpaper-config";

const execFileAsync = promisify(execFile);

type HyprpaperSyntax = "block" | "legacy";

function parseVersion(version: string): [number, number, number] | null {
	const match = version.match(/(\d+)\.(\d+)\.(\d+)/);
	if (match === null) {
		return null;
	}

	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isAtLeastVersion(
	version: [number, number, number],
	minimum: [number, number, number],
): boolean {
	for (let index = 0; index < 3; index += 1) {
		if (version[index] > minimum[index]) {
			return true;
		}

		if (version[index] < minimum[index]) {
			return false;
		}
	}

	return true;
}

async function detectHyprpaperSyntax(): Promise<HyprpaperSyntax> {
	try {
		const { stdout } = await execFileAsync("hyprpaper", ["--version"]);
		const parsedVersion = parseVersion(stdout);
		if (parsedVersion === null) {
			return "legacy";
		}

		return isAtLeastVersion(parsedVersion, [0, 8, 0]) ? "block" : "legacy";
	} catch {
		return "legacy";
	}
}

async function tryApplyWallpaperViaIpc(
	wallpaperPath: string,
	monitor?: string,
): Promise<boolean> {
	try {
		await execFileAsync("hyprctl", ["hyprpaper", "listloaded"]);
		await execFileAsync("hyprctl", ["hyprpaper", "preload", wallpaperPath]);
		const monitorValue = monitor ?? "";
		await execFileAsync("hyprctl", [
			"hyprpaper",
			"wallpaper",
			`${monitorValue},${wallpaperPath}`,
		]);
		return true;
	} catch {
		return false;
	}
}

/**
 * Reads the current hyprpaper.conf file
 */
export async function readHyprpaperConfig(configPath: string): Promise<string> {
	try {
		const fs = await import("node:fs/promises");
		const expandedPath = expandPath(configPath);

		try {
			await fs.access(expandedPath);
		} catch {
			const minimalConfig = `# Hyprpaper wallpaper configuration
# Auto-managed by Vicinae wallpaper extension

splash = false
ipc = true
`;
			await fs.writeFile(expandedPath, minimalConfig, "utf-8");
			return minimalConfig;
		}

		return await fs.readFile(expandedPath, "utf-8");
	} catch (error) {
		throw new Error("Failed to read hyprpaper config", { cause: error });
	}
}

/**
 * Writes the hyprpaper.conf file
 */
export async function writeHyprpaperConfig(
	configPath: string,
	content: string,
): Promise<void> {
	try {
		const fs = await import("node:fs/promises");
		const expandedPath = expandPath(configPath);
		await fs.writeFile(expandedPath, content, "utf-8");
	} catch (error) {
		throw new Error("Failed to write hyprpaper config", { cause: error });
	}
}

export async function getCurrentWallpaperAssignments(
	configPath: string,
): Promise<Map<string, WallpaperConfig>> {
	const config = await readHyprpaperConfig(configPath);
	return parseWallpaperAssignments(config);
}

async function writeWallpaperAssignments(
	configPath: string,
	monitorWallpapers: Map<string, WallpaperConfig>,
): Promise<void> {
	const config = await readHyprpaperConfig(configPath);
	const syntax = await detectHyprpaperSyntax();
	const nextConfig = buildHyprpaperConfig(config, monitorWallpapers, syntax);
	await writeHyprpaperConfig(configPath, nextConfig);
}

/**
 * Updates the hyprpaper.conf with a new wallpaper
 */
export async function updateHyprpaperConfig(
	configPath: string,
	wallpaperPath: string,
	monitor?: string,
	fillMode: FillMode = "cover",
): Promise<void> {
	try {
		const monitorWallpapers = await getCurrentWallpaperAssignments(configPath);

		if (monitor !== undefined) {
			if (monitorWallpapers.has("__all__")) {
				const allMonitorsWallpaper = monitorWallpapers.get("__all__");
				monitorWallpapers.delete("__all__");

				if (allMonitorsWallpaper !== undefined) {
					try {
						const { getConnectedMonitors } = await import("./monitors");
						const connectedMonitors = await getConnectedMonitors();
						for (const connectedMonitor of connectedMonitors) {
							if (
								connectedMonitor.name !== monitor &&
								monitorWallpapers.has(connectedMonitor.name) === false
							) {
								monitorWallpapers.set(
									connectedMonitor.name,
									allMonitorsWallpaper,
								);
							}
						}
					} catch {
						// Keep current monitor map when monitor detection fails.
					}
				}
			}

			monitorWallpapers.set(monitor, {
				path: wallpaperPath,
				fillMode,
			});
		} else {
			monitorWallpapers.clear();
			monitorWallpapers.set("__all__", {
				path: wallpaperPath,
				fillMode,
			});
		}

		await writeWallpaperAssignments(configPath, monitorWallpapers);
	} catch (error) {
		throw new Error("Failed to update hyprpaper config", { cause: error });
	}
}

export async function applyWallpaperCollection(
	configPath: string,
	collectionEntries: Array<{ monitor: string; path: string; fillMode: FillMode }>,
): Promise<void> {
	const monitorWallpapers = new Map<string, WallpaperConfig>();
	for (const entry of collectionEntries) {
		monitorWallpapers.set(entry.monitor, {
			path: entry.path,
			fillMode: entry.fillMode,
		});
	}

	if (monitorWallpapers.size === 0) {
		throw new Error("Collection has no wallpaper entries");
	}

	await writeWallpaperAssignments(configPath, monitorWallpapers);
	await reloadHyprpaper();
}

/**
 * Reloads hyprpaper to apply updated config
 */
export async function reloadHyprpaper(): Promise<void> {
	try {
		try {
			await execFileAsync("pkill", ["-9", "hyprpaper"]);
		} catch {
			// hyprpaper may not be running.
		}

		await new Promise((resolve) => setTimeout(resolve, 500));

		try {
			await execFileAsync("pgrep", ["hyprpaper"]);
			await execFileAsync("pkill", ["-9", "hyprpaper"]);
			await new Promise((resolve) => setTimeout(resolve, 300));
		} catch {
			// Process is not running.
		}

		const child = spawn("hyprpaper", [], {
			detached: true,
			stdio: "ignore",
		});
		child.unref();

		await new Promise((resolve) => setTimeout(resolve, 1000));
	} catch (error) {
		throw new Error("Failed to reload hyprpaper", { cause: error });
	}
}

/**
 * Sets a wallpaper as the current desktop background
 */
export async function setWallpaper(
	wallpaperPath: string,
	configPath: string,
	monitor?: string,
	fillMode: FillMode = "cover",
): Promise<void> {
	const monitorDisplay = monitor !== undefined ? ` on ${monitor}` : " on all monitors";

	const toast = await showToast({
		style: Toast.Style.Animated,
		title: "Setting wallpaper...",
		message: `${wallpaperPath}${monitorDisplay}`,
	});

	try {
		await updateHyprpaperConfig(configPath, wallpaperPath, monitor, fillMode);

		const didApplyViaIpc = await tryApplyWallpaperViaIpc(wallpaperPath, monitor);
		if (didApplyViaIpc === false) {
			await reloadHyprpaper();
		}

		toast.style = Toast.Style.Success;
		toast.title = "Wallpaper applied";
		toast.message = `Set ${monitor ?? "all monitors"} to ${wallpaperPath}`;
		await toast.show();
	} catch (error) {
		toast.style = Toast.Style.Failure;
		toast.title = "Failed to set wallpaper";
		toast.message = error instanceof Error ? error.message : "Unknown error";
		await toast.show();
		throw error;
	}
}
