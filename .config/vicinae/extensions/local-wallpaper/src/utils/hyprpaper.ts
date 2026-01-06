import { exec } from "node:child_process";
import { promisify } from "node:util";
import { showToast, Toast } from "@vicinae/api";
import { expandPath } from "./filesystem";
import type { FillMode } from "../types";

const execAsync = promisify(exec);

/**
 * Detects the hyprpaper version
 * @returns Version string (e.g., "0.8.1") or null if unable to detect
 */
export async function getHyprpaperVersion(): Promise<string | null> {
	try {
		const { stdout } = await execAsync("hyprpaper --version");
		// Parse version from output like "Hyprpaper v0.8.1"
		const match = stdout.match(/v?(\d+\.\d+\.\d+)/);
		return match ? match[1] : "0.8.1";
	} catch {
		// Assume v0.8.1+ if version detection fails
		return "0.8.1";
	}
}

/**
 * Checks if hyprpaper version supports new block syntax with fit_mode
 * @returns true - hyprpaper v0.8.1+ uses block syntax
 */
export async function supportsBlockSyntax(): Promise<boolean> {
	// hyprpaper v0.8.1+ supports block syntax with monitor, path, and fit_mode
	return true;
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
			// File doesn't exist, create minimal config with v0.8.1+ block syntax
			const minimalConfig = `# Hyprpaper wallpaper configuration
# Auto-managed by Vicinae wallpaper extensions

splash = false
ipc = true
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
		
		// Store wallpaper configurations: monitor -> {path, fillMode}
		type WallpaperConfig = { path: string; fillMode: FillMode };
		const monitorWallpapers = new Map<string, WallpaperConfig>();

		// Track if we're inside a wallpaper block
		let inWallpaperBlock = false;
		let currentBlock: { monitor?: string; path?: string; fillMode?: FillMode } = {};

		for (const line of lines) {
			const trimmed = line.trim();
			
			// Parse old-style wallpaper statements (for backward compatibility)
			if (trimmed.startsWith("wallpaper =")) {
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

	// Update or add wallpaper for specified monitor
	if (monitor) {
		// Set for specific monitor - keep other monitors' wallpapers
		// Only remove "all monitors" entry if it exists
		if (monitorWallpapers.has("__all__")) {
			const allMonitorsWallpaper = monitorWallpapers.get("__all__")!;
			monitorWallpapers.delete("__all__");
			// Get all connected monitors and set them to the "all monitors" wallpaper
			// so we don't lose wallpapers on other monitors
			try {
				const { getConnectedMonitors } = await import("./monitors");
				const monitors = await getConnectedMonitors();
				for (const m of monitors) {
					if (m.name !== monitor && !monitorWallpapers.has(m.name)) {
						monitorWallpapers.set(m.name, allMonitorsWallpaper);
					}
				}
			} catch (error) {
				console.warn("Could not get connected monitors:", error);
			}
		}
		monitorWallpapers.set(monitor, { path: wallpaperPath, fillMode });
	} else {
		// Set for all monitors - clear individual monitor entries
		monitorWallpapers.clear();
		monitorWallpapers.set("__all__", { path: wallpaperPath, fillMode });
	}

	// Build new config using v0.8.1+ block syntax
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

		// Keep other config lines (skip empty lines to prevent accumulation)
		if (trimmed) {
			updatedLines.push(line);
		}
	}

	// Ensure ipc is enabled for dynamic wallpaper changes
	if (!updatedLines.some(l => l.trim().startsWith("ipc ="))) {
		updatedLines.push("ipc = true");
	}

	// Add wallpaper assignments using new block syntax (v0.8.1+)
	updatedLines.push("");
	updatedLines.push("# Monitor wallpaper assignments");
	for (const [mon, config] of monitorWallpapers.entries()) {
		updatedLines.push("");
		updatedLines.push("wallpaper {");
		// monitor MUST be the first key in the block (hyprpaper requirement)
		// For all monitors, use empty monitor value
		const monitorValue = mon === "__all__" ? "" : mon;
		updatedLines.push(`  monitor = ${monitorValue}`);
		updatedLines.push(`  path = ${config.path}`);
		updatedLines.push(`  fit_mode = ${config.fillMode}`);
		updatedLines.push("}");
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
			await new Promise((resolve) => setTimeout(resolve, 500));
			// Try killing again
			await execAsync("pkill -9 hyprpaper");
			await new Promise((resolve) => setTimeout(resolve, 300));
		} catch (_error) {
			// Process is gone, which is what we want
		}

		// Start hyprpaper in background using nohup for better daemonization
		execAsync("nohup hyprpaper > /dev/null 2>&1 &").catch(() => {
			// Ignore errors from background process
		});
		
		// Give hyprpaper more time to start and load the config
		await new Promise((resolve) => setTimeout(resolve, 1000));
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
	
	const toast = await showToast({
		style: Toast.Style.Animated,
		title: "Setting wallpaper...",
		message: `${wallpaperPath}${monitorDisplay}`,
	});

	try {
		// Update config
		await updateHyprpaperConfig(configPath, wallpaperPath, monitor, fillMode);

		// Reload hyprpaper
		await reloadHyprpaper();

		toast.style = Toast.Style.Success;
		toast.title = "Wallpaper applied!";
		toast.message = `Set ${monitor || "all monitors"} to ${wallpaperPath}`;
		await toast.show();
	} catch (error) {
		toast.style = Toast.Style.Failure;
		toast.title = "Failed to set wallpaper";
		toast.message = error instanceof Error ? error.message : "Unknown error";
		await toast.show();
		throw error;
	}
}
