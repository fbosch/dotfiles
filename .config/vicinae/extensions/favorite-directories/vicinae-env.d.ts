/// <reference types="@vicinae/api">

/*
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 */

type ExtensionPreferences = {
  /** File Manager - Choose which file manager to use for opening directories */
	"fileManager": "auto" | "nemo" | "nautilus" | "dolphin" | "thunar" | "pcmanfm";
}

declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Command: Downloads */
	export type OpenDownloads = ExtensionPreferences & {
		
	}

	/** Command: Pictures */
	export type OpenPictures = ExtensionPreferences & {
		
	}

	/** Command: Desktop */
	export type OpenDesktop = ExtensionPreferences & {
		
	}

	/** Command: Dotfiles */
	export type OpenDotfiles = ExtensionPreferences & {
		
	}

	/** Command: Projects */
	export type OpenProjects = ExtensionPreferences & {
		
	}

	/** Command: Documents (NAS) */
	export type OpenNasDocuments = ExtensionPreferences & {
		
	}

	/** Command: Downloads (NAS) */
	export type OpenNasDownloads = ExtensionPreferences & {
		
	}

	/** Command: Music (NAS) */
	export type OpenNasMusic = ExtensionPreferences & {
		
	}

	/** Command: Photos (NAS) */
	export type OpenNasPhotos = ExtensionPreferences & {
		
	}

	/** Command: Videos (NAS) */
	export type OpenNasVideos = ExtensionPreferences & {
		
	}

	/** Command: Encrypted (NAS) */
	export type OpenNasEncrypted = ExtensionPreferences & {
		
	}

	/** Command: LaCie */
	export type OpenLacie = ExtensionPreferences & {
		
	}
}

declare namespace Arguments {
  /** Command: Downloads */
	export type OpenDownloads = {
		
	}

	/** Command: Pictures */
	export type OpenPictures = {
		
	}

	/** Command: Desktop */
	export type OpenDesktop = {
		
	}

	/** Command: Dotfiles */
	export type OpenDotfiles = {
		
	}

	/** Command: Projects */
	export type OpenProjects = {
		
	}

	/** Command: Documents (NAS) */
	export type OpenNasDocuments = {
		
	}

	/** Command: Downloads (NAS) */
	export type OpenNasDownloads = {
		
	}

	/** Command: Music (NAS) */
	export type OpenNasMusic = {
		
	}

	/** Command: Photos (NAS) */
	export type OpenNasPhotos = {
		
	}

	/** Command: Videos (NAS) */
	export type OpenNasVideos = {
		
	}

	/** Command: Encrypted (NAS) */
	export type OpenNasEncrypted = {
		
	}

	/** Command: LaCie */
	export type OpenLacie = {
		
	}
}