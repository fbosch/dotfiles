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
 */
export async function updateHyprpaperConfig(
	configPath: string,
	wallpaperPath: string,
): Promise<void> {
	try {
		const config = await readHyprpaperConfig(configPath);
		const lines = config.split("\n");

		// Find and update the preload and wallpaper lines
		const updatedLines = lines.map((line) => {
			const trimmed = line.trim();

			// Update preload line
			if (trimmed.startsWith("preload =")) {
				return `preload = ${wallpaperPath}`;
			}

			// Update wallpaper line (maintain monitor specification)
			if (trimmed.startsWith("wallpaper =")) {
				const parts = trimmed.split(",");
				if (parts.length >= 2) {
					// Keep the monitor part, update the path
					return `wallpaper = ${parts[0].split("=")[1].trim()},${wallpaperPath}`;
				}
				// If no monitor specified, set for all monitors
				return `wallpaper = ,${wallpaperPath}`;
			}

			return line;
		});

		// If no preload or wallpaper lines exist, add them
		if (!updatedLines.some((l) => l.trim().startsWith("preload ="))) {
			updatedLines.push(`preload = ${wallpaperPath}`);
		}
		if (!updatedLines.some((l) => l.trim().startsWith("wallpaper ="))) {
			updatedLines.push(`wallpaper = ,${wallpaperPath}`);
		}

		const newConfig = updatedLines.join("\n");
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
 */
export async function setWallpaper(
	wallpaperPath: string,
	configPath: string,
): Promise<void> {
	const toast = await showToast({
		style: Toast.Style.Animated,
		title: "Setting wallpaper...",
		message: wallpaperPath,
	});

	try {
		// Update config
		await updateHyprpaperConfig(configPath, wallpaperPath);

		// Reload hyprpaper
		await reloadHyprpaper();

		toast.style = Toast.Style.Success;
		toast.title = "Wallpaper applied!";
		toast.message = `Set to ${wallpaperPath}`;
		await toast.show();
	} catch (error) {
		toast.style = Toast.Style.Failure;
		toast.title = "Failed to set wallpaper";
		toast.message = error instanceof Error ? error.message : "Unknown error";
		await toast.show();
		throw error;
	}
}
