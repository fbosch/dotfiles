// Centralized constants and magic numbers/strings

export const WALLHAVEN_BASE_URL = "https://wallhaven.cc/api/v1";

// Cache keys
export const USER_SETTINGS_CACHE_KEY = "wallhaven-user-settings-v1";
export const DEFAULT_WALLPAPERS_CACHE_KEY = "wallhaven-default-wallpapers-v1";
export const PERSIST_KEY = "wallhaven-query-v1";

// Durations (ms)
export const SETTINGS_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
export const WALLPAPERS_CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 hours
export const PERSIST_MAX_AGE = 12 * 60 * 60 * 1000; // 12 hours

// Query stale/gc times
export const QUERY_STALE_TIME = 12 * 60 * 60 * 1000; // 12 hours
export const QUERY_GC_TIME = PERSIST_MAX_AGE;

// Defaults
export const DEFAULT_SEARCH_FALLBACK = "nature";
export const DEFAULT_CATEGORIES = "111";
export const DEFAULT_DEBOUNCE_MS = 800;
