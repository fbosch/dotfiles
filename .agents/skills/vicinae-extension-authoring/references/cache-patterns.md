# Cache Patterns

Use Vicinae Cache for persistence across sessions. Align Cache TTL with React Query `staleTime`.

## Key rules

- Use versioned keys (`feature-name-v1`).
- Store `{ data, cachedAt }` in JSON.
- Remove cache on parse errors or expiration.
- Keep TTLs in `constants.ts` and reuse in QueryClient.

## Baseline helper

```ts
import { Cache } from "@vicinae/api";

const cache = new Cache();
const CACHE_KEY = "extension-data-v1";
const CACHE_TTL = 12 * 60 * 60 * 1000; // 12h

type CachedData<T> = {
  data: T;
  cachedAt: number;
};

export function getCachedData<T>(): T | null {
  const cached = cache.get(CACHE_KEY);
  if (!cached) return null;
  try {
    const parsed: CachedData<T> = JSON.parse(cached);
    if (Date.now() - parsed.cachedAt < CACHE_TTL) {
      return parsed.data;
    }
    cache.remove(CACHE_KEY);
    return null;
  } catch {
    cache.remove(CACHE_KEY);
    return null;
  }
}

export function setCachedData<T>(data: T): void {
  cache.set(
    CACHE_KEY,
    JSON.stringify({ data, cachedAt: Date.now() } satisfies CachedData<T>),
  );
}

export function clearCachedData(): void {
  cache.remove(CACHE_KEY);
}
```

## React Query integration

```ts
const cached = getCachedData<YourType>();

const query = useQuery({
  queryKey: ["extension", "resource"],
  queryFn: fetchResource,
  initialData: cached ?? undefined,
  initialDataUpdatedAt: cached ? cached.cachedAt : undefined,
  staleTime: CACHE_TTL,
  refetchOnWindowFocus: false,
  retry: 1,
});
```

When refreshing, clear Vicinae cache and invalidate the query to force a network fetch.
