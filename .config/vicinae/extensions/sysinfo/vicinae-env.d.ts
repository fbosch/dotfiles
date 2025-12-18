/// <reference types="@vicinae/api">

/*
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 */

type ExtensionPreferences = {
  /** Show Distribution Logo - Show a visual representation of your Linux distribution */
	"showDistroArt": boolean;

	/** Auto-refresh Interval - How often to auto-refresh system stats (0 = manual only) */
	"refreshInterval": "0" | "5000" | "10000" | "30000" | "60000";
}

declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Command: Show System Info */
	export type SystemInfo = ExtensionPreferences & {
		
	}
}

declare namespace Arguments {
  /** Command: Show System Info */
	export type SystemInfo = {
		
	}
}