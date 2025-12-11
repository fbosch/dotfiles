export interface DirectoryEntry {
	id: string;
	name: string;
	path: string;
	absolutePath: string;
	isSubdirectory: boolean;
	parentPath?: string;
	exists: boolean;
	isHidden: boolean;
}

export interface Preferences {
	favoriteDirectories: string;
	fileManager: "auto" | "nautilus" | "dolphin" | "thunar" | "nemo" | "pcmanfm";
	showHiddenFiles: boolean;
	includeSubdirectories: boolean;
}
