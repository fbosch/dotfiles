import { Cache } from "@vicinae/api";
import type {
	PersistedClient,
	Persister,
} from "@tanstack/react-query-persist-client";
import { PERSIST_KEY } from "./constants";

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
