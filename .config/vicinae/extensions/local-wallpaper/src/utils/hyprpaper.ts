import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { showToast, Toast } from "@vicinae/api";
import type { FillMode } from "../types";
import { expandPath } from "./filesystem";

const execFileAsync = promisify(execFile);

type HyprpaperSyntax = "block" | "legacy";

export type WallpaperConfig = {
	path: string;
	fillMode: FillMode;
};

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

function parseFillMode(value: string): FillMode {
	if (value === "cover") return "cover";
	if (value === "contain") return "contain";
	if (value === "tile") return "tile";
	if (value === "fill") return "fill";
	return "cover";
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

function parseWallpaperLine(line: string): [string, WallpaperConfig] | null {
	if (line.startsWith("wallpaper =") === false) {
		return null;
	}

	const value = line.substring("wallpaper =".length).trim();
	const parts = value.split(",");
	if (parts.length < 2) {
		return null;
	}

	const monitorName = parts[0].trim();
	const monitorKey = monitorName === "" ? "__all__" : monitorName;
	const path = parts.slice(1).join(",").trim();

	return [monitorKey, { path, fillMode: "cover" }];
}

export function parseWallpaperAssignments(
	configContent: string,
): Map<string, WallpaperConfig> {
	const lines = configContent.split("\n");
	const monitorWallpapers = new Map<string, WallpaperConfig>();
	let inWallpaperBlock = false;
	let currentBlock: { monitor?: string; path?: string; fillMode?: FillMode } = {};

	for (const line of lines) {
		const trimmed = line.trim();

		const parsedLine = parseWallpaperLine(trimmed);
		if (parsedLine !== null) {
			const [monitorKey, config] = parsedLine;
			const existing = monitorWallpapers.get(monitorKey);
			monitorWallpapers.set(monitorKey, {
				path: config.path,
				fillMode: existing?.fillMode ?? "cover",
			});
			continue;
		}

		if (trimmed === "wallpaper {") {
			inWallpaperBlock = true;
			currentBlock = {};
			continue;
		}

		if (trimmed === "}") {
			if (inWallpaperBlock && currentBlock.path !== undefined) {
				const monitorKey = currentBlock.monitor ?? "__all__";
				monitorWallpapers.set(monitorKey, {
					path: currentBlock.path,
					fillMode: currentBlock.fillMode ?? "cover",
				});
			}

			inWallpaperBlock = false;
			currentBlock = {};
			continue;
		}

		if (inWallpaperBlock === false) {
			continue;
		}

		if (trimmed.startsWith("monitor =")) {
			const monitorValue = trimmed.substring("monitor =".length).trim();
			currentBlock.monitor = monitorValue === "" ? undefined : monitorValue;
			continue;
		}

		if (trimmed.startsWith("path =")) {
			currentBlock.path = trimmed.substring("path =".length).trim();
			continue;
		}

		if (trimmed.startsWith("fit_mode =")) {
			const mode = trimmed.substring("fit_mode =".length).trim();
			currentBlock.fillMode = parseFillMode(mode);
		}
	}

	return monitorWallpapers;
}

function stripWallpaperSections(configContent: string): string[] {
	const lines = configContent.split("\n");
	const keptLines: string[] = [];
	let skipWallpaperBlock = false;

	for (const line of lines) {
		const trimmed = line.trim();

		if (trimmed.startsWith("preload =") || trimmed.startsWith("wallpaper =")) {
			continue;
		}

		if (trimmed === "wallpaper {") {
			skipWallpaperBlock = true;
			continue;
		}

		if (skipWallpaperBlock) {
			if (trimmed === "}") {
				skipWallpaperBlock = false;
			}
			continue;
		}

		if (
			trimmed === "# Preloaded wallpapers" ||
			trimmed === "# Monitor wallpaper assignments" ||
			trimmed.startsWith("# NOTE:")
		) {
			continue;
		}

		if (trimmed.length > 0) {
			keptLines.push(line);
		}
	}

	return keptLines;
}

export function buildHyprpaperConfig(
	baseConfig: string,
	monitorWallpapers: Map<string, WallpaperConfig>,
	syntax: HyprpaperSyntax,
): string {
	const updatedLines = stripWallpaperSections(baseConfig);

	if (updatedLines.some((line) => line.trim().startsWith("ipc =")) === false) {
		updatedLines.push("ipc = true");
	}

	const uniquePaths = new Set<string>();
	for (const wallpaperConfig of monitorWallpapers.values()) {
		uniquePaths.add(wallpaperConfig.path);
	}

	updatedLines.push("");
	updatedLines.push("# Preloaded wallpapers");
	for (const path of uniquePaths) {
		updatedLines.push(`preload = ${path}`);
	}

	updatedLines.push("");
	updatedLines.push("# Monitor wallpaper assignments");

	for (const [monitorName, wallpaperConfig] of monitorWallpapers.entries()) {
		if (syntax === "legacy") {
			const monitorValue = monitorName === "__all__" ? "" : monitorName;
			updatedLines.push(`wallpaper = ${monitorValue},${wallpaperConfig.path}`);
			continue;
		}

		updatedLines.push("");
		updatedLines.push("wallpaper {");
		if (monitorName !== "__all__") {
			updatedLines.push(`  monitor = ${monitorName}`);
		}
		updatedLines.push(`  path = ${wallpaperConfig.path}`);
		updatedLines.push(`  fit_mode = ${wallpaperConfig.fillMode}`);
		updatedLines.push("}");
	}

	return `${updatedLines.join("\n")}\n`;
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
