/// <reference types="@vicinae/api">

/*
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 */

type ExtensionPreferences = {
  /** Wallpapers Directory - Directory containing your wallpapers (supports ~ for home directory) */
	"wallpapersDirectory": string;

	/** Hyprpaper Config Path - Path to your hyprpaper.conf file */
	"hyprpaperConfigPath": string;

	/** File Extensions - Comma-separated list of image extensions to include */
	"fileExtensions": string;

	/** Sort By - How to sort wallpapers */
	"sortBy": "name" | "modified-desc" | "modified-asc" | "size-desc" | "size-asc";
}

declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Command: Change Wallpaper */
	export type BrowseWallpapers = ExtensionPreferences & {
		
	}
}

declare namespace Arguments {
  /** Command: Change Wallpaper */
	export type BrowseWallpapers = {
		
	}
}