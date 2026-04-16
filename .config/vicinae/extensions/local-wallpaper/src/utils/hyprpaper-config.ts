type FillMode = "cover" | "contain" | "tile" | "fill";

type HyprpaperSyntax = "block" | "legacy";

export type WallpaperConfig = {
	path: string;
	fillMode: FillMode;
};

function parseFillMode(value: string): FillMode {
	if (value === "cover") return "cover";
	if (value === "contain") return "contain";
	if (value === "tile") return "tile";
	if (value === "fill") return "fill";
	return "cover";
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
