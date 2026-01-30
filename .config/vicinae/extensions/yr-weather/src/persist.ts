import { Cache } from "@vicinae/api";
import type {
	PersistedClient,
	Persister,
} from "@tanstack/react-query-persist-client";

export const YR_WEATHER_PERSIST_KEY = "yr-weather-query-v1";
export const YR_WEATHER_PERSIST_MAX_AGE = 30 * 60 * 1000; // 30 minutes

const cache = new Cache();

export const yrWeatherPersister = {
	persistClient: async (client: PersistedClient) => {
		cache.set(YR_WEATHER_PERSIST_KEY, JSON.stringify(client));
	},
	restoreClient: async () => {
		const cached = cache.get(YR_WEATHER_PERSIST_KEY);
		if (!cached) return undefined;
		try {
			return JSON.parse(cached) as PersistedClient;
		} catch {
			cache.remove(YR_WEATHER_PERSIST_KEY);
			return undefined;
		}
	},
	removeClient: async () => {
		cache.remove(YR_WEATHER_PERSIST_KEY);
	},
} satisfies Persister;
