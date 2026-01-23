/// <reference types="@vicinae/api">

/*
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 */

type ExtensionPreferences = {
  /** Home Assistant URL - Base URL for your Home Assistant instance */
	"baseUrl"?: string;

	/** Long-Lived Access Token - Create a token in Home Assistant user profile */
	"accessToken"?: string;
}

declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Command: Home Assistant Lights */
	export type HomeAssistantLights = ExtensionPreferences & {
		
	}
}

declare namespace Arguments {
  /** Command: Home Assistant Lights */
	export type HomeAssistantLights = {
		
	}
}