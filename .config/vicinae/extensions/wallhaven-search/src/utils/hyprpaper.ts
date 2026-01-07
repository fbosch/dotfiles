import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * Expands ~ to home directory in a path
 */
function expandPath(path: string): string {
	return path.replace(/^~/, process.env.HOME || process.env.USERPROFILE || "");
}

/**
 * Reads the current hyprpaper.conf file
 */
async function readHyprpaperConfig(configPath: string): Promise<string> {
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
async function writeHyprpaperConfig(
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
 * Uses v0.8.1+ block syntax for all monitors
 */
async function updateHyprpaperConfig(
	configPath: string,
	wallpaperPath: string,
): Promise<void> {
	try {
		const config = await readHyprpaperConfig(configPath);
		const lines = config.split("\n");

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

			// Keep other config lines
			updatedLines.push(line);
		}

		// Ensure ipc is enabled
		if (!updatedLines.some(l => l.trim().startsWith("ipc ="))) {
			updatedLines.push("ipc = true");
		}

		// Add wallpaper assignment for all monitors using new block syntax
		updatedLines.push("");
		updatedLines.push("# Monitor wallpaper assignments");
		updatedLines.push("");
		updatedLines.push("wallpaper {");
		// monitor MUST be the first key in the block (hyprpaper requirement)
		// For all monitors, use empty monitor value
		updatedLines.push("  monitor = ");
		updatedLines.push(`  path = ${wallpaperPath}`);
		updatedLines.push("  fit_mode = cover");
		updatedLines.push("}");

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
async function reloadHyprpaper(): Promise<void> {
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
 */
export async function applyWallpaper(
	wallpaperPath: string,
	configPath: string,
): Promise<void> {
	try {
		// Update config
		await updateHyprpaperConfig(configPath, wallpaperPath);

		// Reload hyprpaper
		await reloadHyprpaper();
	} catch (error) {
		console.error("Error applying wallpaper:", error);
		throw error;
	}
}
