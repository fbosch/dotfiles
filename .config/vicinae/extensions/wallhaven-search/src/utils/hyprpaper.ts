import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type HyprpaperSyntax = "block" | "legacy";

/**
 * Expands ~ to home directory in a path
 */
function expandPath(path: string): string {
	return path.replace(/^~/, process.env.HOME || process.env.USERPROFILE || "");
}

function parseVersion(versionOutput: string): [number, number, number] | null {
	const match = versionOutput.match(/(\d+)\.(\d+)\.(\d+)/);
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

async function tryApplyWallpaperViaIpc(wallpaperPath: string): Promise<boolean> {
	try {
		await execFileAsync("hyprctl", ["hyprpaper", "listloaded"]);
		await execFileAsync("hyprctl", ["hyprpaper", "preload", wallpaperPath]);
		await execFileAsync("hyprctl", ["hyprpaper", "wallpaper", `,${wallpaperPath}`]);
		return true;
	} catch {
		return false;
	}
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
		throw new Error("Failed to read hyprpaper config", { cause: error });
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
		throw new Error("Failed to write hyprpaper config", { cause: error });
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

		const syntax = await detectHyprpaperSyntax();

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

			if (
				trimmed === "# Preloaded wallpapers" ||
				trimmed === "# Monitor wallpaper assignments" ||
				trimmed.startsWith("# NOTE:")
			) {
				continue;
			}

			if (trimmed.length > 0) {
				updatedLines.push(line);
			}
		}

		if (updatedLines.some((line) => line.trim().startsWith("ipc =")) === false) {
			updatedLines.push("ipc = true");
		}

		updatedLines.push("");
		updatedLines.push("# Preloaded wallpapers");
		updatedLines.push(`preload = ${wallpaperPath}`);

		updatedLines.push("");
		updatedLines.push("# Monitor wallpaper assignments");

		if (syntax === "legacy") {
			updatedLines.push(`wallpaper = ,${wallpaperPath}`);
		} else {
			updatedLines.push("");
			updatedLines.push("wallpaper {");
			updatedLines.push(`  path = ${wallpaperPath}`);
			updatedLines.push("  fit_mode = cover");
			updatedLines.push("}");
		}

		// Ensure file ends with newline
		const newConfig = `${updatedLines.join("\n")}\n`;
		await writeHyprpaperConfig(configPath, newConfig);
	} catch (error) {
		throw new Error("Failed to update hyprpaper config", { cause: error });
	}
}

/**
 * Reloads hyprpaper to apply the new wallpaper
 */
async function reloadHyprpaper(): Promise<void> {
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
export async function applyWallpaper(
	wallpaperPath: string,
	configPath: string,
): Promise<void> {
	try {
		await updateHyprpaperConfig(configPath, wallpaperPath);
		const didApplyViaIpc = await tryApplyWallpaperViaIpc(wallpaperPath);
		if (didApplyViaIpc === false) {
			await reloadHyprpaper();
		}
	} catch (error) {
		throw error;
	}
}
