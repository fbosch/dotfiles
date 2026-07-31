import { createHash } from "node:crypto";
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

export const accountQueryKey = ["codex"] as const;
export const usageQueryKey = [...accountQueryKey, "usage"] as const;
export const resetCreditsQueryKey = [
	...accountQueryKey,
	"reset-credits",
] as const;

export function accountCredentialKey(accountId: string): string {
	return createHash("sha256").update(accountId).digest("hex");
}

export const usageCacheTimeMs = 10_000;
export const resetCreditsCacheTimeMs = 8 * 60 * 60 * 1_000;
const usageCacheBuster = "fbb.opencode-multi-auth-query-cache/v2";
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
		filters: { queryKey: accountQueryKey },
		maxAge: resetCreditsCacheTimeMs,
		prefix: usageCachePrefix,
		refetchOnRestore: true,
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
