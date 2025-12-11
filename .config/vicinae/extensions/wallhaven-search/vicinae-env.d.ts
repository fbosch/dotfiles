/// <reference types="@vicinae/api">

/*
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 */

type ExtensionPreferences = {
  /** API Key - Optional Wallhaven API key for accessing additional features */
	"apiKey": string;

	/** Use User Settings - Use your Wallhaven account settings (requires API key) */
	"useUserSettings": boolean;

	/** Content Purity - Filter by content rating */
	"purity": "100" | "110";

	/** Default Sorting - How to sort wallpapers */
	"sorting": "relevance" | "toplist" | "date_added" | "views" | "favorites" | "random";

	/** Top Range - Time range for top list sorting (only applies when sorting is 'Top List') */
	"topRange": "1d" | "3d" | "1w" | "1M" | "3M" | "6M" | "1y";

	/** Download Directory - Directory where wallpapers will be downloaded (supports ~ for home directory) */
	"downloadDirectory": string;

	/** Hyprpaper Config Path - Path to your hyprpaper.conf file (for Download and Apply action) */
	"hyprpaperConfigPath": string;
}

declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Command: Search for Wallpapers */
	export type SearchForWallpapers = ExtensionPreferences & {
		
	}
}

declare namespace Arguments {
  /** Command: Search for Wallpapers */
	export type SearchForWallpapers = {
		
	}
}