import { exec } from "node:child_process";
import { promisify } from "node:util";
import { showToast, Toast } from "@vicinae/api";
import { expandPath } from "./filesystem";
import type { FillMode } from "../types";

const execAsync = promisify(exec);

/**
 * Detects the hyprpaper version
 * @returns Version string (e.g., "0.7.6") or null if unable to detect
 */
export async function getHyprpaperVersion(): Promise<string | null> {
	try {
		const { stdout } = await execAsync("hyprpaper --version 2>&1");
		// Parse version from output like "Hyprpaper, version v0.7.6"
		const match = stdout.match(/v?(\d+\.\d+(?:\.\d+)?)/);
		return match ? match[1] : null;
	} catch (error) {
		console.warn("Could not detect hyprpaper version:", error);
		return null;
	}
}

/**
 * Checks if hyprpaper version supports new block syntax with fit_mode
 * @returns true if version >= 0.8.0, false otherwise
 */
export async function supportsBlockSyntax(): Promise<boolean> {
	const version = await getHyprpaperVersion();
	if (!version) return false; // Assume older version if can't detect
	
	const [major, minor] = version.split('.').map(Number);
	return major > 0 || (major === 0 && minor >= 8);
}

/**
 * Reads the current hyprpaper.conf file
 */
export async function readHyprpaperConfig(configPath: string): Promise<string> {
	try {
		const fs = await import("node:fs/promises");
		const expandedPath = expandPath(configPath);
		
		// Check if file exists, if not create a minimal config
		try {
			await fs.access(expandedPath);
		} catch {
			// File doesn't exist, create minimal config
			const minimalConfig = `# Hyprpaper wallpaper configuration
# Auto-managed by Vicinae wallpaper extensions

preload = 
wallpaper = ,

splash = false
`;
			await fs.writeFile(expandedPath, minimalConfig, "utf-8");
			return minimalConfig;
		}
		
		return await fs.readFile(expandedPath, "utf-8");
	} catch (error) {
		console.error("Error reading hyprpaper config:", error);
		throw new Error("Failed to read hyprpaper config");
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
		console.error("Error writing hyprpaper config:", error);
		throw new Error("Failed to write hyprpaper config");
	}
}

/**
 * Updates the hyprpaper.conf with a new wallpaper
 * @param configPath Path to hyprpaper.conf
 * @param wallpaperPath Path to the wallpaper image
 * @param monitor Optional monitor name. If undefined, applies to all monitors
 * @param fillMode Optional fill mode for wallpaper display (default: "cover")
 */
export async function updateHyprpaperConfig(
	configPath: string,
	wallpaperPath: string,
	monitor?: string,
	fillMode: FillMode = "cover",
): Promise<void> {
	try {
		const config = await readHyprpaperConfig(configPath);
		const lines = config.split("\n");

		// Check if we should use new block syntax
		const useBlockSyntax = await supportsBlockSyntax();

		// Parse existing config - support both old and new formats
		const preloadPaths = new Set<string>();
		
		// Store wallpaper configurations: monitor -> {path, fillMode}
		type WallpaperConfig = { path: string; fillMode: FillMode };
		const monitorWallpapers = new Map<string, WallpaperConfig>();

		// Track if we're inside a wallpaper block
		let inWallpaperBlock = false;
		let currentBlock: { monitor?: string; path?: string; fillMode?: FillMode } = {};

		for (const line of lines) {
			const trimmed = line.trim();
			
			// Parse preload statements
			if (trimmed.startsWith("preload =")) {
				const path = trimmed.substring("preload =".length).trim();
				preloadPaths.add(path);
			} 
			// Parse old-style wallpaper statements (for backward compatibility)
			else if (trimmed.startsWith("wallpaper =")) {
				const value = trimmed.substring("wallpaper =".length).trim();
				const parts = value.split(",");
				if (parts.length >= 2) {
					const monitorName = parts[0].trim();
					const path = parts.slice(1).join(",").trim();
					const key = monitorName || "__all__";
					// Preserve existing or use default
					monitorWallpapers.set(key, { 
						path, 
						fillMode: monitorWallpapers.get(key)?.fillMode || "cover" 
					});
				}
			}
			// Parse new wallpaper block syntax
			else if (trimmed === "wallpaper {") {
				inWallpaperBlock = true;
				currentBlock = {};
			} 
			else if (trimmed === "}") {
				if (inWallpaperBlock && currentBlock.path) {
					const key = currentBlock.monitor || "__all__";
					monitorWallpapers.set(key, {
						path: currentBlock.path,
						fillMode: currentBlock.fillMode || "cover",
					});
				}
				inWallpaperBlock = false;
				currentBlock = {};
			}
			else if (inWallpaperBlock) {
				if (trimmed.startsWith("monitor =")) {
					const monitorValue = trimmed.substring("monitor =".length).trim();
					// Empty monitor value means apply to all monitors
					currentBlock.monitor = monitorValue || undefined;
				} else if (trimmed.startsWith("path =")) {
					currentBlock.path = trimmed.substring("path =".length).trim();
				} else if (trimmed.startsWith("fit_mode =")) {
					const mode = trimmed.substring("fit_mode =".length).trim() as FillMode;
					currentBlock.fillMode = mode;
				}
			}
		}

	// Add new wallpaper to preload set
	preloadPaths.add(wallpaperPath);

	// Update or add wallpaper for specified monitor
	if (monitor) {
		// Set for specific monitor - remove "all monitors" entry if it exists
		monitorWallpapers.delete("__all__");
		monitorWallpapers.set(monitor, { path: wallpaperPath, fillMode });
	} else {
		// Set for all monitors - clear individual monitor entries
		monitorWallpapers.clear();
		monitorWallpapers.set("__all__", { path: wallpaperPath, fillMode });
	}

		// Build new config using appropriate syntax based on hyprpaper version
		const updatedLines: string[] = [];

		// Keep non-wallpaper config lines
		let skipUntilEnd = false;
		for (const line of lines) {
			const trimmed = line.trim();

			// Skip old format wallpaper lines and blocks
			if (trimmed.startsWith("preload =") || trimmed.startsWith("wallpaper =")) {
				continue;
			}
			if (trimmed === "wallpaper {") {
				skipUntilEnd = true;
				continue;
			}
			if (skipUntilEnd) {
				if (trimmed === "}") {
					skipUntilEnd = false;
				}
				continue;
			}

			// Skip old comment headers we'll regenerate
			if (trimmed === "# Preloaded wallpapers" || trimmed === "# Monitor wallpaper assignments" || trimmed.startsWith("# NOTE:")) {
				continue;
			}

			// Keep other config lines
			updatedLines.push(line);
		}

		// Add all preload statements
		updatedLines.push("");
		updatedLines.push("# Preloaded wallpapers");
		for (const path of preloadPaths) {
			updatedLines.push(`preload = ${path}`);
		}

		// Add wallpaper assignments using version-appropriate syntax
		updatedLines.push("");
		updatedLines.push("# Monitor wallpaper assignments");
		
		if (useBlockSyntax) {
			// Use new block syntax (v0.8+) with fit_mode support
			for (const [mon, config] of monitorWallpapers.entries()) {
				updatedLines.push("wallpaper {");
				if (mon !== "__all__") {
					updatedLines.push(`    monitor = ${mon}`);
				}
				updatedLines.push(`    path = ${config.path}`);
				updatedLines.push(`    fit_mode = ${config.fillMode}`);
				updatedLines.push("}");
			}
		} else {
			// Use old syntax (v0.7.x) - no per-monitor fit modes
			updatedLines.push("# NOTE: Per-monitor fit modes require hyprpaper v0.8+");
			for (const [mon, config] of monitorWallpapers.entries()) {
				const monitorValue = mon === "__all__" ? "" : mon;
				updatedLines.push(`wallpaper = ${monitorValue},${config.path}`);
			}
		}

		// Ensure file ends with newline
		const newConfig = `${updatedLines.join("\n")}\n`;
		await writeHyprpaperConfig(configPath, newConfig);
	} catch (error) {
		console.error("Error updating hyprpaper config:", error);
		throw error;
	}
}

/**
 * Reloads hyprpaper to apply the new wallpaper
 */
export async function reloadHyprpaper(): Promise<void> {
	try {
		// Kill existing hyprpaper process
		try {
			await execAsync("pkill -9 hyprpaper");
			// Wait longer for the process to fully terminate
			await new Promise((resolve) => setTimeout(resolve, 500));
		} catch (_error) {
			// Process might not be running, which is fine
			console.log("hyprpaper not running or already killed");
		}

		// Ensure the process is actually gone
		try {
			await execAsync("pgrep hyprpaper");
			// If we get here, hyprpaper is still running, wait a bit more
			await new Promise((resolve) => setTimeout(resolve, 300));
		} catch (_error) {
			// Process is gone, which is what we want
		}

		// Start hyprpaper in background (don't wait for it)
		execAsync("hyprpaper > /dev/null 2>&1 &").catch(() => {
			// Ignore errors from background process
		});
		
		// Give hyprpaper time to start and load the config
		await new Promise((resolve) => setTimeout(resolve, 100));
	} catch (error) {
		console.error("Error reloading hyprpaper:", error);
		throw new Error("Failed to reload hyprpaper");
	}
}

/**
 * Sets a wallpaper as the current desktop background
 * @param wallpaperPath Path to the wallpaper image
 * @param configPath Path to hyprpaper.conf
 * @param monitor Optional monitor name. If undefined, applies to all monitors
 * @param fillMode Optional fill mode for wallpaper display (default: "cover")
 */
export async function setWallpaper(
	wallpaperPath: string,
	configPath: string,
	monitor?: string,
	fillMode: FillMode = "cover",
): Promise<void> {
	const monitorDisplay = monitor ? ` on ${monitor}` : " on all monitors";
	
	// Check version support for better messaging
	const hasBlockSupport = await supportsBlockSyntax();
	let fitModeNote = "";
	
	if (!monitor || hasBlockSupport) {
		// All monitors or version supports per-monitor fit modes
		fitModeNote = ` (${fillMode})`;
	} else {
		// Per-monitor with old version - fit mode not supported
		fitModeNote = " (fit mode requires hyprpaper v0.8+)";
	}
	
	const toast = await showToast({
		style: Toast.Style.Animated,
		title: "Setting wallpaper...",
		message: `${wallpaperPath}${monitorDisplay}${fitModeNote}`,
	});

	try {
		// Update config
		await updateHyprpaperConfig(configPath, wallpaperPath, monitor, fillMode);

		// Reload hyprpaper
		await reloadHyprpaper();

		toast.style = Toast.Style.Success;
		toast.title = "Wallpaper applied!";
		toast.message = `Set ${monitor || "all monitors"} to ${wallpaperPath}${fitModeNote}`;
		await toast.show();
	} catch (error) {
		toast.style = Toast.Style.Failure;
		toast.title = "Failed to set wallpaper";
		toast.message = error instanceof Error ? error.message : "Unknown error";
		await toast.show();
		throw error;
	}
}
