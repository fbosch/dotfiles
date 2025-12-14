/// <reference types="@vicinae/api">

/*
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 */

type ExtensionPreferences = {
  /** Kagi Session Link - Your Kagi session link from https://kagi.com/settings/user_details (paste the full URL) */
	"sessionToken"?: string;
}

declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Command: Search Kagi */
	export type KagiSearch = ExtensionPreferences & {
		
	}
}

declare namespace Arguments {
  /** Command: Search Kagi */
	export type KagiSearch = {
		
	}
}