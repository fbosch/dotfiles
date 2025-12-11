import { setCachedDefaultWallpapers, setCachedUserSettings } from "./cache";
import {
	DEFAULT_CATEGORIES,
	DEFAULT_SEARCH_FALLBACK,
	WALLHAVEN_BASE_URL,
} from "./constants";
import type {
	SearchParams,
	UserSettings,
	WallhavenResponse,
	Wallpaper,
} from "./types";

export async function fetchUserSettings(
	apiKey: string,
): Promise<UserSettings | null> {
	try {
		const response = await fetch(
			`${WALLHAVEN_BASE_URL}/settings?apikey=${apiKey.trim()}`,
		);
		if (!response.ok) {
			console.error("Failed to fetch user settings:", response.status);
			return null;
		}
		const data = await response.json();
		const settings = data.data;
		setCachedUserSettings(settings);
		return settings;
	} catch (error) {
		console.error("Error fetching user settings:", error);
		return null;
	}
}

export function convertUserSettingsToPurity(purityArray: string[]): string {
	const sfw = purityArray.includes("sfw") ? "1" : "0";
	const sketchy = purityArray.includes("sketchy") ? "1" : "0";
	const nsfw = purityArray.includes("nsfw") ? "1" : "0";
	return `${sfw}${sketchy}${nsfw}`;
}

export async function searchWallpapers(
	params: SearchParams,
): Promise<WallhavenResponse> {
	const searchQuery = params.query.trim() || DEFAULT_SEARCH_FALLBACK;

	const urlParams = new URLSearchParams({
		q: searchQuery,
		categories: params.categories,
		purity: params.purity,
		sorting: params.sorting,
		page: params.page.toString(),
	});

	if (params.sorting === "toplist" && params.topRange) {
		urlParams.append("topRange", params.topRange);
	}
	if (params.apiKey) {
		urlParams.append("apikey", params.apiKey.trim());
	}
	if (
		params.resolutions &&
		params.resolutions.length > 0 &&
		params.resolutions[0] !== ""
	) {
		urlParams.append("resolutions", params.resolutions.join(","));
	}
	if (
		params.aspectRatios &&
		params.aspectRatios.length > 0 &&
		params.aspectRatios[0] !== ""
	) {
		urlParams.append("ratios", params.aspectRatios.join(","));
	}
	if (params.aiArtFilter !== undefined) {
		urlParams.append("ai_art_filter", params.aiArtFilter.toString());
	}

	const url = `${WALLHAVEN_BASE_URL}/search?${urlParams.toString()}`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`);
	}
	const data: WallhavenResponse = await response.json();

	const isDefaultSearch =
		params.query.trim() === "" &&
		params.page === 1 &&
		params.categories === DEFAULT_CATEGORIES;
	if (isDefaultSearch) {
		setCachedDefaultWallpapers(data);
	}
	return data;
}

export async function fetchWallpaperDetails(
	id: string,
	apiKey?: string,
): Promise<Wallpaper> {
	const url = apiKey
		? `${WALLHAVEN_BASE_URL}/w/${id}?apikey=${apiKey.trim()}`
		: `${WALLHAVEN_BASE_URL}/w/${id}`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch wallpaper details: ${response.status}`);
	}
	const data = await response.json();
	return data.data;
}
