/**
 * Cache file manager detection result
 * Detects once and caches for the session
 */
import { Cache } from "@vicinae/api";

const cache = new Cache();
const FILE_MANAGER_CACHE_KEY = "detected-file-manager";
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

type CachedFileManager = {
	fileManager: string;
	cachedAt: number;
};

export function getCachedFileManager(): string | null {
	const cached = cache.get(FILE_MANAGER_CACHE_KEY);
	if (!cached) return null;

	try {
		const data: CachedFileManager = JSON.parse(cached);
		const age = Date.now() - data.cachedAt;

		if (age < CACHE_DURATION) {
			return data.fileManager;
		}

		cache.remove(FILE_MANAGER_CACHE_KEY);
		return null;
	} catch {
		cache.remove(FILE_MANAGER_CACHE_KEY);
		return null;
	}
}

export function setCachedFileManager(fileManager: string): void {
	const data: CachedFileManager = {
		fileManager,
		cachedAt: Date.now(),
	};
	cache.set(FILE_MANAGER_CACHE_KEY, JSON.stringify(data));
}
