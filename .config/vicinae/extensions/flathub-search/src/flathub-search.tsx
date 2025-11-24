import { useState, useEffect } from "react";
import {
  List,
  ActionPanel,
  Action,
  showToast,
  Icon,
  Toast,
  Cache,
} from "@vicinae/api";
import {
  keepPreviousData,
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";

export type FlathubApp = {
  app_id: string;
  name: string;
  summary: string;
  icon?: string;
  project_license?: string;
  installs_last_month?: number;
  trending?: number;
  favorites_count?: number;
};

export type FlathubSearchResponse = {
  hits: FlathubApp[];
};

const FLATHUB_SEARCH_URL = "https://flathub.org/api/v2/search";
const POPULAR_APPS_CACHE_KEY = "popular-apps-v1";
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24h
const POPULAR_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 500;

const cache = new Cache();

type CachedData = {
  apps: FlathubApp[];
  cachedAt: number;
};

function getCachedPopularApps(): FlathubApp[] | null {
  const cached = cache.get(POPULAR_APPS_CACHE_KEY);
  if (!cached) return null;
  try {
    const data: CachedData = JSON.parse(cached);
    if (Date.now() - data.cachedAt < CACHE_DURATION) {
      return data.apps;
    }
    cache.remove(POPULAR_APPS_CACHE_KEY);
    return null;
  } catch {
    cache.remove(POPULAR_APPS_CACHE_KEY);
    return null;
  }
}

function setCachedPopularApps(apps: FlathubApp[]): void {
  cache.set(
    POPULAR_APPS_CACHE_KEY,
    JSON.stringify({ apps, cachedAt: Date.now() } satisfies CachedData),
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function formatInstalls(count?: number): string {
  if (!count) return "";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M installs`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K installs`;
  return `${count} installs`;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// Unified POST helper
async function postFlathubSearch(query: string): Promise<FlathubApp[]> {
  const response = await fetch(FLATHUB_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) {
    throw new Error(
      `Flathub request failed: ${response.status} ${response.statusText}`,
    );
  }
  const data: FlathubSearchResponse = await response.json();
  return data.hits || [];
}

async function searchFlathub(query: string): Promise<FlathubApp[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const results = await postFlathubSearch(trimmed);
  // Sort by installs descending for relevance
  return results.sort(
    (a, b) => (b.installs_last_month || 0) - (a.installs_last_month || 0),
  );
}

async function fetchPopularApps(): Promise<FlathubApp[]> {
  // Empty query returns overall list; we slice top POPULAR_LIMIT
  const apps = await postFlathubSearch("");
  const subset = apps.slice(0, POPULAR_LIMIT);
  setCachedPopularApps(subset);
  return subset;
}

function FlathubSearchContent() {
  const [searchText, setSearchText] = useState("");
  const debouncedSearch = useDebounce(searchText, SEARCH_DEBOUNCE_MS);

  // Popular apps query
  const { data: popularApps = [], isLoading: loadingPopular } = useQuery({
    queryKey: ["flathub", "popular"],
    queryFn: fetchPopularApps,
    initialData: () => getCachedPopularApps() || undefined,
    staleTime: 10 * 60 * 1000,
  });

  // Search query
  const {
    data: searchResults = [],
    isLoading: loadingSearch,
    isError,
    error,
  } = useQuery({
    queryKey: ["flathub", "search", debouncedSearch],
    queryFn: () => searchFlathub(debouncedSearch),
    enabled: debouncedSearch.trim().length > 0,
    placeholderData: keepPreviousData,
  });

  if (isError && error) {
    showToast({
      style: Toast.Style.Failure,
      title: "Search failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }

  const showingSearch = debouncedSearch.trim().length > 0;
  const displayed = showingSearch ? searchResults : popularApps;
  const isLoading = showingSearch ? loadingSearch : loadingPopular;

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search Flathub applications..."
      onSearchTextChange={setSearchText}
    >
      {displayed.length === 0 && showingSearch && !isLoading ? (
        <List.EmptyView
          title="No applications found"
          description="Try different search terms"
        />
      ) : (
        <>
          {!showingSearch && displayed.length > 0 && (
            <List.Section title="Popular Applications" />
          )}
          {displayed.map((app) => (
            <List.Item
              key={app.app_id}
              title={app.name}
              subtitle={app.summary}
              icon={app.icon || Icon.AppWindow}
              accessories={app.installs_last_month ? [ { text: formatInstalls(app.installs_last_month) } ] : []}
              actions={
                <ActionPanel>
                  <Action.CopyToClipboard
                    title="Copy App ID"
                    content={app.app_id}
                    shortcut={{ modifiers: ["cmd"], key: "c" }}
                  />
                  <Action.OpenInBrowser
                    title="Open on Flathub"
                    url={`https://flathub.org/apps/${app.app_id}`}
                    shortcut={{ modifiers: ["cmd"], key: "o" }}
                  />
                  <Action.CopyToClipboard
                    title="Copy Install Command"
                    content={`flatpak install flathub ${app.app_id}`}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
                  />
                </ActionPanel>
              }
            />
          ))}
        </>
      )}
    </List>
  );
}

export default function FlathubSearch() {
  return (
    <QueryClientProvider client={queryClient}>
      <FlathubSearchContent />
    </QueryClientProvider>
  );
}
