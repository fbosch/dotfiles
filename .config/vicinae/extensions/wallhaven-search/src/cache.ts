import { Cache } from "@vicinae/api";
import {
  USER_SETTINGS_CACHE_KEY,
  DEFAULT_WALLPAPERS_CACHE_KEY,
  SETTINGS_CACHE_DURATION,
  WALLPAPERS_CACHE_DURATION,
} from "./constants";
import type { UserSettings, WallhavenResponse } from "./types";

const cache = new Cache();

export type CachedUserSettings = {
  settings: UserSettings;
  cachedAt: number;
};

export type CachedWallpapers = {
  wallpapers: WallhavenResponse;
  cachedAt: number;
};

export function getCachedUserSettings(): UserSettings | null {
  const cached = cache.get(USER_SETTINGS_CACHE_KEY);
  if (!cached) return null;

  try {
    const data: CachedUserSettings = JSON.parse(cached);
    const age = Date.now() - data.cachedAt;

    if (age < SETTINGS_CACHE_DURATION) {
      return data.settings;
    }

    cache.remove(USER_SETTINGS_CACHE_KEY);
    return null;
  } catch {
    cache.remove(USER_SETTINGS_CACHE_KEY);
    return null;
  }
}

export function setCachedUserSettings(settings: UserSettings): void {
  const data: CachedUserSettings = {
    settings,
    cachedAt: Date.now(),
  };
  cache.set(USER_SETTINGS_CACHE_KEY, JSON.stringify(data));
}

export function getCachedDefaultWallpapers(): WallhavenResponse | null {
  const cached = cache.get(DEFAULT_WALLPAPERS_CACHE_KEY);
  if (!cached) return null;

  try {
    const data: CachedWallpapers = JSON.parse(cached);
    const age = Date.now() - data.cachedAt;

    if (age < WALLPAPERS_CACHE_DURATION) {
      return data.wallpapers;
    }

    cache.remove(DEFAULT_WALLPAPERS_CACHE_KEY);
    return null;
  } catch {
    cache.remove(DEFAULT_WALLPAPERS_CACHE_KEY);
    return null;
  }
}

export function setCachedDefaultWallpapers(wallpapers: WallhavenResponse): void {
  const data: CachedWallpapers = {
    wallpapers,
    cachedAt: Date.now(),
  };
  cache.set(DEFAULT_WALLPAPERS_CACHE_KEY, JSON.stringify(data));
}
