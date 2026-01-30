/// <reference types="@vicinae/api">

/*
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 */

type ExtensionPreferences = {
  /** Latitude - Latitude in decimal degrees (e.g., 59.9139 for Oslo) */
	"latitude"?: string;

	/** Longitude - Longitude in decimal degrees (e.g., 10.7522 for Oslo) */
	"longitude"?: string;

	/** Altitude (optional) - Ground surface height above sea level in meters (improves temperature accuracy) */
	"altitude": string;

	/** Location Name - Custom name for the location (e.g., 'Home', 'Oslo') */
	"locationName": string;
}

declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Command: Weather Forecast */
	export type YrWeather = ExtensionPreferences & {
		
	}
}

declare namespace Arguments {
  /** Command: Weather Forecast */
	export type YrWeather = {
		
	}
}