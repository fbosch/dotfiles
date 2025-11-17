import { useState } from "react";
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

type FlathubApp = {
  app_id: string;
  name: string;
  summary: string;
  icon?: string;
  project_license?: string;
  installs_last_month?: number;
  trending?: number;
  favorites_count?: number;
};

type FlathubSearchResponse = {
  hits: Array<{
    app_id: string;
    name: string;
    summary: string;
    icon?: string;
    project_license?: string;
    installs_last_month?: number;
    trending?: number;
    favorites_count?: number;
  }>;
};

const cache = new Cache();
const POPULAR_APPS_CACHE_KEY = "popular-apps-v1";
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

type CachedData = {
  apps: FlathubApp[];
  cachedAt: number;
};

function getCachedPopularApps(): FlathubApp[] | null {
  const cached = cache.get(POPULAR_APPS_CACHE_KEY);
  if (!cached) return null;

  try {
    const data: CachedData = JSON.parse(cached);
    const age = Date.now() - data.cachedAt;
    
    if (age < CACHE_DURATION) {
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
  const data: CachedData = {
    apps,
    cachedAt: Date.now(),
  };
  cache.set(POPULAR_APPS_CACHE_KEY, JSON.stringify(data));
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

async function searchFlathub(query: string): Promise<FlathubApp[]> {
  if (!query.trim()) return [];

  const response = await fetch("https://flathub.org/api/v2/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error(`Search failed: ${response.statusText}`);
  }

  const data: FlathubSearchResponse = await response.json();
  const results = data.hits || [];

  return results.sort((a, b) => {
    const aInstalls = a.installs_last_month || 0;
    const bInstalls = b.installs_last_month || 0;
    return bInstalls - aInstalls;
  });
}

async function getPopularApps(): Promise<FlathubApp[]> {
  const response = await fetch("https://flathub.org/api/v2/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: "" }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch popular apps: ${response.statusText}`);
  }

  const data: FlathubSearchResponse = await response.json();
  const apps = data.hits || [];

  const sortedApps = apps
    .slice(0, 20)
    .map((app) => ({
      app_id: app.app_id,
      name: app.name,
      summary: app.summary,
      icon: app.icon,
      project_license: app.project_license,
      installs_last_month: app.installs_last_month,
      trending: app.trending,
      favorites_count: app.favorites_count,
    }));
  
  setCachedPopularApps(sortedApps);
  
  return sortedApps;
}

function formatInstalls(count?: number): string {
  if (!count) return "";

  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M installs`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K installs`;
  }
  return `${count} installs`;
}

function FlathubSearchContent() {
  const [searchText, setSearchText] = useState("");

  const { data: popularApps = [], isLoading: isLoadingPopular } = useQuery({
    queryKey: ["popular-apps"],
    queryFn: getPopularApps,
    initialData: () => getCachedPopularApps() || undefined,
    staleTime: 10 * 60 * 1000,
  });

  const {
    data: searchResults = [],
    isLoading: isSearching,
    isError,
    error,
  } = useQuery({
    queryKey: ["search", searchText],
    queryFn: () => searchFlathub(searchText),
    placeholderData: keepPreviousData,
    enabled: searchText.trim().length > 0,
  });

  if (isError && error) {
    showToast({
      style: Toast.Style.Failure,
      title: "Search failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }

  const displayedApps = searchText.trim() ? searchResults : popularApps;
  const isLoading = searchText.trim() ? isSearching : isLoadingPopular;

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search Flathub applications..."
      onSearchTextChange={setSearchText}
    >
      {displayedApps.length === 0 && searchText.trim() !== "" && !isLoading ? (
        <List.EmptyView
          title="No applications found"
          description="Try different search terms"
        />
      ) : (
        <>
          {!searchText.trim() && displayedApps.length > 0 && (
            <List.Section title="Popular Applications" />
          )}
          {displayedApps.map((app) => (
            <List.Item
              key={app.app_id}
              title={app.name}
              subtitle={app.summary}
              icon={app.icon || Icon.AppWindow}
              accessories={[
                ...(app.installs_last_month
                  ? [{ text: formatInstalls(app.installs_last_month) }]
                  : []),
                { text: app.app_id },
              ]}
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
