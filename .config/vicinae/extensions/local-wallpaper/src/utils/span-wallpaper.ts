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

export type SpanLayout = {
	width: number;
	height: number;
	crops: SpanCrop[];
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

function getEffectivePhysicalDimensions(monitor: Monitor): {
	width: number;
	height: number;
} {
	const isRotated = monitor.transform % 2 === 1;
	return isRotated
		? { width: monitor.physicalHeight, height: monitor.physicalWidth }
		: { width: monitor.physicalWidth, height: monitor.physicalHeight };
}

type MonitorLayout = {
	monitor: Monitor;
	logicalWidth: number;
	logicalHeight: number;
	physicalWidth: number;
	physicalHeight: number;
};

function getResolutionSpanCrops(monitorLayouts: MonitorLayout[]): {
	width: number;
	height: number;
	crops: SpanCrop[];
} {
	const left = Math.min(...monitorLayouts.map(({ monitor }) => monitor.x));
	const top = Math.min(...monitorLayouts.map(({ monitor }) => monitor.y));
	const pixelsPerLogicalPixel = Math.max(
		...monitorLayouts.map((layout) => layout.monitor.scale),
	);
	const toPixels = (value: number) =>
		Math.round(value * pixelsPerLogicalPixel);
	const crops = monitorLayouts.map((layout) => {
		const x = toPixels(layout.monitor.x - left);
		const y = toPixels(layout.monitor.y - top);
		return {
			monitor: layout.monitor.name,
			width: toPixels(layout.logicalWidth),
			height: toPixels(layout.logicalHeight),
			x,
			y,
		};
	});

	return {
		width: Math.max(...crops.map((crop) => crop.x + crop.width)),
		height: Math.max(...crops.map((crop) => crop.y + crop.height)),
		crops,
	};
}

function getPhysicalAxisPositions(
	monitorLayouts: MonitorLayout[],
	axis: "x" | "y",
): Map<MonitorLayout, number> {
	const start = (layout: MonitorLayout) =>
		axis === "x" ? layout.monitor.x : layout.monitor.y;
	const logicalLength = (layout: MonitorLayout) =>
		axis === "x" ? layout.logicalWidth : layout.logicalHeight;
	const physicalLength = (layout: MonitorLayout) =>
		axis === "x" ? layout.physicalWidth : layout.physicalHeight;
	const remaining = [...monitorLayouts];
	const anchor = remaining.reduce((first, layout) =>
		start(layout) < start(first) ? layout : first,
	);
	const positions = new Map<MonitorLayout, number>([[anchor, 0]]);
	remaining.splice(remaining.indexOf(anchor), 1);

	while (remaining.length > 0) {
		let nextLayout: MonitorLayout | undefined;
		let nextPosition: number | undefined;

		for (const candidate of remaining) {
			for (const [placed, placedPosition] of positions) {
				const placedStart = start(placed);
				const placedEnd = placedStart + logicalLength(placed);
				const scale = physicalLength(placed) / logicalLength(placed);
				const candidateStart = start(candidate);
				const candidateEnd = candidateStart + logicalLength(candidate);

				if (candidateStart >= placedStart && candidateStart <= placedEnd) {
					nextLayout = candidate;
					nextPosition =
						placedPosition + (candidateStart - placedStart) * scale;
					break;
				}

				if (candidateEnd >= placedStart && candidateEnd <= placedEnd) {
					nextLayout = candidate;
					nextPosition =
						placedPosition +
						(candidateEnd - placedStart) * scale -
						physicalLength(candidate);
					break;
				}
			}

			if (nextLayout !== undefined) {
				break;
			}
		}

		if (nextLayout === undefined || nextPosition === undefined) {
			nextLayout = remaining.reduce((first, layout) =>
				start(layout) < start(first) ? layout : first,
			);
			nextPosition =
				(start(nextLayout) - start(anchor)) *
				(physicalLength(anchor) / logicalLength(anchor));
		}

		positions.set(nextLayout, nextPosition);
		remaining.splice(remaining.indexOf(nextLayout), 1);
	}

	return positions;
}

export function getSpanCrops(monitors: Monitor[]): SpanLayout {
	if (monitors.length < 2) {
		throw new Error("Connect at least two monitors to span a wallpaper");
	}

	const monitorLayouts = monitors.map((monitor) => {
		const dimensions = getEffectiveDimensions(monitor);
		const physicalDimensions = getEffectivePhysicalDimensions(monitor);
		return {
			monitor,
			logicalWidth: dimensions.width / monitor.scale,
			logicalHeight: dimensions.height / monitor.scale,
			physicalWidth: physicalDimensions.width,
			physicalHeight: physicalDimensions.height,
		};
	});
	if (
		monitorLayouts.some(
			(layout) => layout.physicalWidth <= 0 || layout.physicalHeight <= 0,
		)
	) {
		return getResolutionSpanCrops(monitorLayouts);
	}
	const xPositions = getPhysicalAxisPositions(monitorLayouts, "x");
	const yPositions = getPhysicalAxisPositions(monitorLayouts, "y");
	const left = Math.min(...xPositions.values());
	const top = Math.min(...yPositions.values());
	const pixelsPerMillimeter = Math.max(
		...monitorLayouts.flatMap((layout) => [
			(layout.logicalWidth * layout.monitor.scale) / layout.physicalWidth,
			(layout.logicalHeight * layout.monitor.scale) / layout.physicalHeight,
		]),
	);
	const toPixels = (value: number) => Math.round(value * pixelsPerMillimeter);
	const crops = monitorLayouts.map((layout) => ({
		monitor: layout.monitor.name,
		width: toPixels(layout.physicalWidth),
		height: toPixels(layout.physicalHeight),
		x: toPixels(xPositions.get(layout)! - left),
		y: toPixels(yPositions.get(layout)! - top),
	}));

	return {
		width: Math.max(...crops.map((crop) => crop.x + crop.width)),
		height: Math.max(...crops.map((crop) => crop.y + crop.height)),
		crops,
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
		await execFileAsync(
			"magick",
			getSpanWallpaperCommand(wallpaperPath, layout, crop, outputPath),
		);
		outputs.set(crop.monitor, outputPath);
	}

	return outputs;
}

export function getSpanWallpaperCommand(
	wallpaperPath: string,
	layout: Pick<SpanLayout, "width" | "height">,
	crop: SpanCrop,
	outputPath: string,
): string[] {
	return [
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
	];
}
