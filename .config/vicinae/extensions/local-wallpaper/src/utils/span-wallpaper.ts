import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Monitor } from "../types";

const execFileAsync = promisify(execFile);

export type SpanCrop = {
	monitor: string;
	width: number;
	height: number;
	x: number;
	y: number;
};

function getEffectiveDimensions(monitor: Monitor): {
	width: number;
	height: number;
} {
	const isRotated = monitor.transform % 2 === 1;
	return isRotated
		? { width: monitor.height, height: monitor.width }
		: { width: monitor.width, height: monitor.height };
}

export function getSpanCrops(monitors: Monitor[]): {
	width: number;
	height: number;
	crops: SpanCrop[];
} {
	if (monitors.length < 2) {
		throw new Error("Connect at least two monitors to span a wallpaper");
	}

	const monitorLayouts = monitors.map((monitor) => {
		const dimensions = getEffectiveDimensions(monitor);
		return {
			monitor,
			logicalWidth: dimensions.width / monitor.scale,
			logicalHeight: dimensions.height / monitor.scale,
		};
	});
	const left = Math.min(...monitorLayouts.map(({ monitor }) => monitor.x));
	const top = Math.min(...monitorLayouts.map(({ monitor }) => monitor.y));
	const right = Math.max(
		...monitorLayouts.map(({ monitor, logicalWidth }) =>
			monitor.x + logicalWidth,
		),
	);
	const bottom = Math.max(
		...monitorLayouts.map(({ monitor, logicalHeight }) =>
			monitor.y + logicalHeight,
		),
	);
	const pixelsPerLogicalPixel = Math.max(
		...monitors.map((monitor) => monitor.scale),
	);
	const toPixels = (value: number) =>
		Math.round(value * pixelsPerLogicalPixel);

	return {
		width: toPixels(right - left),
		height: toPixels(bottom - top),
		crops: monitorLayouts.map(({ monitor, logicalWidth, logicalHeight }) => {
			const x = toPixels(monitor.x - left);
			const y = toPixels(monitor.y - top);
			return {
				monitor: monitor.name,
				width: toPixels(monitor.x + logicalWidth - left) - x,
				height: toPixels(monitor.y + logicalHeight - top) - y,
				x,
				y,
			};
		}),
	};
}

export async function createSpanWallpapers(
	wallpaperPath: string,
	monitors: Monitor[],
): Promise<Map<string, string>> {
	const layout = getSpanCrops(monitors);
	const cacheKey = createHash("sha256")
		.update(
			JSON.stringify({
				wallpaperPath,
				layout,
			}),
		)
		.digest("hex");
	const cacheDirectory = join(homedir(), ".cache", "vicinae", "local-wallpaper", "span");
	await mkdir(cacheDirectory, { recursive: true });

	const outputs = new Map<string, string>();
	for (const crop of layout.crops) {
		const outputPath = join(cacheDirectory, `${cacheKey}-${crop.monitor}.png`);
		await execFileAsync("magick", [
			wallpaperPath,
			"-resize",
			`${layout.width}x${layout.height}^`,
			"-gravity",
			"center",
			"-extent",
			`${layout.width}x${layout.height}`,
			// Crop coordinates are relative to the virtual desktop's top-left corner.
			"-gravity",
			"northwest",
			"-crop",
			`${crop.width}x${crop.height}+${crop.x}+${crop.y}`,
			"+repage",
			outputPath,
		]);
		outputs.set(crop.monitor, outputPath);
	}

	return outputs;
}
