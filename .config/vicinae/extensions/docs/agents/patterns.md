# Common Patterns

## React Query setup

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
```

## Caching with Vicinae Cache

```typescript
import { Cache } from "@vicinae/api";

const cache = new Cache();
const CACHE_KEY = "extension-data-v1";
const CACHE_DURATION = 24 * 60 * 60 * 1000;

type CachedData = {
  data: YourDataType[];
  cachedAt: number;
};

function getCachedData(): YourDataType[] | null {
  const cached = cache.get(CACHE_KEY);
  if (!cached) return null;

  try {
    const data: CachedData = JSON.parse(cached);
    if (Date.now() - data.cachedAt < CACHE_DURATION) {
      return data.data;
    }
    cache.remove(CACHE_KEY);
    return null;
  } catch {
    cache.remove(CACHE_KEY);
    return null;
  }
}

function setCachedData(data: YourDataType[]): void {
  cache.set(
    CACHE_KEY,
    JSON.stringify({ data, cachedAt: Date.now() } satisfies CachedData),
  );
}
```

## Debounced search

```typescript
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

const [searchText, setSearchText] = useState("");
const debouncedSearch = useDebounce(searchText, 500);
```
