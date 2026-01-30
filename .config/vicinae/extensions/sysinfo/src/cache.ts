import type { StaticSystemInfo, StorageCategory } from "./types";

// Cache keys and durations
export const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
export const STORAGE_CATEGORIES_CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

export type CachedStaticInfo = {
	info: StaticSystemInfo;
	cachedAt: number;
};

export type CachedStorageCategories = {
	categories: StorageCategory[];
	cachedAt: number;
};
