import { Cache } from "@vicinae/api";
import type {
	PersistedClient,
	Persister,
} from "@tanstack/react-query-persist-client";

export const PERSIST_KEY = "sysinfo-query-v1";
export const PERSIST_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

const cache = new Cache();

export const persister = {
	persistClient: async (client: PersistedClient) => {
		cache.set(PERSIST_KEY, JSON.stringify(client));
	},
	restoreClient: async () => {
		const cached = cache.get(PERSIST_KEY);
		if (!cached) return undefined;
		try {
			return JSON.parse(cached) as PersistedClient;
		} catch {
			cache.remove(PERSIST_KEY);
			return undefined;
		}
	},
	removeClient: async () => {
		cache.remove(PERSIST_KEY);
	},
} satisfies Persister;
