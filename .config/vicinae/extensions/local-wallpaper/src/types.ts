// Types for local wallpaper extension

export type Preferences = {
	wallpapersDirectory: string;
	hyprpaperConfigPath: string;
	fileExtensions: string;
	sortBy: string;
};

export type LocalWallpaper = {
	id: string;
	name: string;
	path: string;
	absolutePath: string;
	size: number;
	modified: Date;
	extension: string;
	resolution?: string;
	dimensions?: {
		width: number;
		height: number;
	};
};

export type SortOption =
	| "name"
	| "modified-desc"
	| "modified-asc"
	| "size-desc"
	| "size-asc";

export type Monitor = {
	id: number;
	name: string;
	width: number;
	height: number;
	x: number;
	y: number;
	scale: number;
	refreshRate: number;
	activeWorkspace: {
		id: number;
		name: string;
	};
	focused: boolean;
	dpmsStatus: boolean;
	transform: number;
};

// Fill modes for wallpaper display
// NOTE: hyprpaper may not support all modes natively
// This is a framework for future implementation
export type FillMode =
	| "cover" // Fill screen, crop if needed (default)
	| "contain" // Fit entire image within screen
	| "center" // Center image, no scaling
	| "tile" // Repeat image to fill
	| "stretch"; // Stretch to fill (may distort)
