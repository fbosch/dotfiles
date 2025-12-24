import { exec } from "node:child_process";
import { promisify } from "node:util";
import { showToast, Toast } from "@vicinae/api";
import { expandPath } from "./filesystem";

const execAsync = promisify(exec);

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
 */
export async function updateHyprpaperConfig(
	configPath: string,
	wallpaperPath: string,
	monitor?: string,
): Promise<void> {
	try {
		const config = await readHyprpaperConfig(configPath);
		const lines = config.split("\n");

		// Parse existing config
		const preloadPaths = new Set<string>();
		const monitorWallpapers = new Map<string, string>();

		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed.startsWith("preload =")) {
				const path = trimmed.substring("preload =".length).trim();
				preloadPaths.add(path);
			} else if (trimmed.startsWith("wallpaper =")) {
				const value = trimmed.substring("wallpaper =".length).trim();
				const parts = value.split(",");
				if (parts.length >= 2) {
					const monitorName = parts[0].trim();
					const path = parts.slice(1).join(",").trim();
					monitorWallpapers.set(monitorName || "__all__", path);
				}
			}
		}

		// Add new wallpaper to preload set
		preloadPaths.add(wallpaperPath);

		// Update or add wallpaper for specified monitor
		if (monitor) {
			// Set for specific monitor
			monitorWallpapers.set(monitor, wallpaperPath);
		} else {
			// Set for all monitors
			monitorWallpapers.set("__all__", wallpaperPath);
		}

		// Build new config
		const updatedLines: string[] = [];

		for (const line of lines) {
			const trimmed = line.trim();

			// Skip old preload and wallpaper lines - we'll add them at the end
			if (trimmed.startsWith("preload =") || trimmed.startsWith("wallpaper =")) {
				continue;
			}

			// Keep non-wallpaper config lines
			updatedLines.push(line);
		}

		// Add all preload statements
		updatedLines.push("");
		updatedLines.push("# Preloaded wallpapers");
		for (const path of preloadPaths) {
			updatedLines.push(`preload = ${path}`);
		}

		// Add all wallpaper statements
		updatedLines.push("");
		updatedLines.push("# Monitor wallpaper assignments");
		for (const [mon, path] of monitorWallpapers.entries()) {
			const monitorSpec = mon === "__all__" ? "" : mon;
			updatedLines.push(`wallpaper = ${monitorSpec},${path}`);
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
			await execAsync("pkill hyprpaper");
			// Wait a bit for the process to terminate
			await new Promise((resolve) => setTimeout(resolve, 200));
		} catch (_error) {
			// Process might not be running, which is fine
			console.log("hyprpaper not running or already killed");
		}

		// Start hyprpaper in background (don't wait for it)
		execAsync("hyprpaper > /dev/null 2>&1 &").catch(() => {
			// Ignore errors from background process
		});
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
 */
export async function setWallpaper(
	wallpaperPath: string,
	configPath: string,
	monitor?: string,
): Promise<void> {
	const monitorDisplay = monitor ? ` on ${monitor}` : " on all monitors";
	const toast = await showToast({
		style: Toast.Style.Animated,
		title: "Setting wallpaper...",
		message: `${wallpaperPath}${monitorDisplay}`,
	});

	try {
		// Update config
		await updateHyprpaperConfig(configPath, wallpaperPath, monitor);

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
