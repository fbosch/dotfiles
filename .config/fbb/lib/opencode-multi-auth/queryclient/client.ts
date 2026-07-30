import {
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { QueryClient } from "@tanstack/query-core";
import {
	type AsyncStorage,
	experimental_createQueryPersister,
} from "@tanstack/query-persist-client-core";
import type { AccountPaths } from "../types.ts";

export const usageQueryKey = ["codex", "usage"] as const;

const usageCacheTimeMs = 60_000;
const usageCacheBuster = "fbb.opencode-multi-auth-query-cache/v1";
const usageCachePrefix = "fbb-opencode-multi-auth";
const clients = new Map<string, PersistentQueryClient>();

export type PersistentQueryClient = {
	queryClient: QueryClient;
	queryPersister: ReturnType<typeof experimental_createQueryPersister>;
};

export function queryClientFor(paths: AccountPaths): PersistentQueryClient {
	const cacheDirectory = paths.queryCacheDirectory || ".query-cache";
	const existing = clients.get(cacheDirectory);
	if (existing) {
		return existing;
	}

	const queryPersister = experimental_createQueryPersister({
		buster: usageCacheBuster,
		filters: { queryKey: usageQueryKey },
		maxAge: usageCacheTimeMs,
		prefix: usageCachePrefix,
		refetchOnRestore: false,
		storage: fileStorage(cacheDirectory),
	});
	const persistentClient = {
		queryClient: new QueryClient({
			defaultOptions: {
				queries: {
					// Infinite gcTime avoids retaining the one-shot CLI process.
					gcTime: Number.POSITIVE_INFINITY,
					persister: queryPersister.persisterFn,
					retry: false,
					staleTime: usageCacheTimeMs,
				},
			},
		}),
		queryPersister,
	};
	clients.set(cacheDirectory, persistentClient);
	return persistentClient;
}

function fileStorage(cacheDirectory: string): AsyncStorage {
	return {
		entries() {
			try {
				return readdirSync(cacheDirectory).map((key) => [
					decodeURIComponent(key),
					readFileSync(join(cacheDirectory, key), "utf8"),
				]);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") {
					return [];
				}
				throw error;
			}
		},
		getItem(key) {
			try {
				return readFileSync(cacheFilePath(cacheDirectory, key), "utf8");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") {
					return null;
				}
				throw error;
			}
		},
		removeItem(key) {
			rmSync(cacheFilePath(cacheDirectory, key), { force: true });
		},
		setItem(key, value) {
			mkdirSync(cacheDirectory, { recursive: true });
			writeFileSync(cacheFilePath(cacheDirectory, key), value, { mode: 0o600 });
		},
	};
}

function cacheFilePath(cacheDirectory: string, key: string): string {
	return join(cacheDirectory, encodeURIComponent(key));
}
