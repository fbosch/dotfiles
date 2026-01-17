/// <reference types="@vicinae/api">

/*
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 */

type ExtensionPreferences = {
  /** Recursive Scanning - Enable recursive scanning of subdirectories */
	"recursiveScan": boolean;

	/** Show Infected Files Only - Hide clean files from scan results */
	"showInfectedOnly": boolean;

	/** Auto-Remove Infected Files - WARNING: This will permanently delete infected files without confirmation */
	"removeInfected": boolean;

	/** Exclude Patterns - Comma-separated regex patterns to exclude (e.g., .*\.log,.*\.tmp) */
	"excludePatterns": string;
}

declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Command: Scan Directory */
	export type ScanDirectory = ExtensionPreferences & {
		
	}

	/** Command: Quick Scan Home */
	export type ScanHome = ExtensionPreferences & {
		
	}

	/** Command: Update Virus Database */
	export type UpdateDatabase = ExtensionPreferences & {
		
	}
}

declare namespace Arguments {
  /** Command: Scan Directory */
	export type ScanDirectory = {
		
	}

	/** Command: Quick Scan Home */
	export type ScanHome = {
		
	}

	/** Command: Update Virus Database */
	export type UpdateDatabase = {
		
	}
}