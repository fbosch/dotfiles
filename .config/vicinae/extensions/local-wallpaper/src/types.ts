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
