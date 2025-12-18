import { Cache } from "@vicinae/api";
import type { StaticSystemInfo, StorageCategory } from "./types";

// Vicinae Cache for static system info persistence between sessions
export const cache = new Cache();

// Cache keys and durations
export const STATIC_INFO_CACHE_KEY = "static-system-info-v4"; // Bumped version for packages object structure
export const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
export const STORAGE_CATEGORIES_CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

type CachedStaticInfo = {
  info: StaticSystemInfo;
  cachedAt: number;
};

export function getCachedStaticInfo(): StaticSystemInfo | null {
  // Cache is now enabled in dev mode to prevent OOM errors
  const cached = cache.get(STATIC_INFO_CACHE_KEY);
  if (!cached) return null;
  try {
    const data: CachedStaticInfo = JSON.parse(cached);
    if (Date.now() - data.cachedAt < CACHE_DURATION) {
      return data.info;
    }
    cache.remove(STATIC_INFO_CACHE_KEY);
    return null;
  } catch {
    cache.remove(STATIC_INFO_CACHE_KEY);
    return null;
  }
}

export function setCachedStaticInfo(info: StaticSystemInfo): void {
  // Cache is now enabled in dev mode to prevent OOM errors
  cache.set(
    STATIC_INFO_CACHE_KEY,
    JSON.stringify({ info, cachedAt: Date.now() } satisfies CachedStaticInfo),
  );
}

export function getCachedStorageCategories(
  mountPoint: string,
): StorageCategory[] | null {
  // Cache is now enabled in dev mode to prevent OOM errors
  const cacheKey = `storage-categories-${mountPoint}-v1`;
  const cached = cache.get(cacheKey);
  if (!cached) return null;
  try {
    const data: { categories: StorageCategory[]; cachedAt: number } =
      JSON.parse(cached);
    if (Date.now() - data.cachedAt < STORAGE_CATEGORIES_CACHE_DURATION) {
      return data.categories;
    }
    cache.remove(cacheKey);
    return null;
  } catch {
    cache.remove(cacheKey);
    return null;
  }
}

export function setCachedStorageCategories(
  mountPoint: string,
  categories: StorageCategory[],
): void {
  // Cache is now enabled in dev mode to prevent OOM errors
  const cacheKey = `storage-categories-${mountPoint}-v1`;
  cache.set(
    cacheKey,
    JSON.stringify({ categories, cachedAt: Date.now() }),
  );
}
