# Cache Patterns

Prefer React Query persistence for query data. Use a Vicinae Cache-backed persister for cross-session storage. Align `gcTime` with `persistQueryClient` `maxAge`.

## Key rules

- Use versioned persist keys (`feature-name-query-v1`).
- Persist only dehydrated query state via `persistQueryClient`.
- Keep `gcTime` aligned with `maxAge` to avoid early garbage collection.
- Remove persisted cache on parse errors.

## Vicinae Cache persister

```ts
import { Cache } from "@vicinae/api";
import type {
  PersistedClient,
  Persister,
} from "@tanstack/react-query-persist-client";

const cache = new Cache();
const PERSIST_KEY = "extension-query-v1";
const MAX_AGE = 12 * 60 * 60 * 1000; // 12h

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
```

## React Query integration

```ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: MAX_AGE,
      gcTime: MAX_AGE,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

<PersistQueryClientProvider
  client={queryClient}
  persistOptions={{ persister, maxAge: MAX_AGE }}
>
  <App />
</PersistQueryClientProvider>
```

When refreshing, invalidate the query and let persistence resync on the next save.
