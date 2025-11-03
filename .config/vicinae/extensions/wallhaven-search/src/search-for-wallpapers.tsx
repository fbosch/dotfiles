import { useState } from "react";
import {
  Grid,
  ActionPanel,
  Action,
  showToast,
  Toast,
  Detail,
  getPreferenceValues,
  Icon,
} from "@vicinae/api";
import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";

type Preferences = {
  apiKey?: string;
  useUserSettings: boolean;
  purity: string;
  sorting: string;
  topRange: string;
};

type UserSettings = {
  purity: string[];
  categories: string[];
  toplist_range: string;
};

type Wallpaper = {
  id: string;
  url: string;
  short_url: string;
  views: number;
  favorites: number;
  resolution: string;
  colors: string[];
  path: string;
  category: string;
  purity: string;
  file_size: number;
  tags: Array<{
    id: number;
    name: string;
  }>;
  thumbs: {
    large: string;
    original: string;
    small: string;
  };
};

type WallhavenResponse = {
  data: Wallpaper[];
  meta: {
    current_page: number;
    last_page: number;
    total: number;
  };
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 12 * 60 * 60 * 1000, // 12 hours - queries stay fresh for 12 hours
      gcTime: 12 * 60 * 60 * 1000, // 12 hours - cache cleanup after 12 hours
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const localStoragePersister = {
  persistClient: async (client: any) => {
    try {
      const data = {
        timestamp: Date.now(),
        clientState: client,
      };
      localStorage.setItem("wallhaven-cache", JSON.stringify(data));
    } catch (error) {
      console.error("Failed to persist cache:", error);
    }
  },
  restoreClient: async () => {
    try {
      const cached = localStorage.getItem("wallhaven-cache");
      if (!cached) return undefined;

      const data = JSON.parse(cached);
      const age = Date.now() - data.timestamp;
      const maxAge = 12 * 60 * 60 * 1000; // 12 hours

      if (age > maxAge) {
        localStorage.removeItem("wallhaven-cache");
        return undefined;
      }

      return data.clientState;
    } catch (error) {
      console.error("Failed to restore cache:", error);
      return undefined;
    }
  },
  removeClient: async () => {
    try {
      localStorage.removeItem("wallhaven-cache");
    } catch (error) {
      console.error("Failed to remove cache:", error);
    }
  },
};

persistQueryClient({
  queryClient,
  persister: localStoragePersister,
});

type SearchParams = {
  query: string;
  categories: string;
  purity: string;
  sorting: string;
  topRange?: string;
  page: number;
  apiKey?: string;
};

async function fetchUserSettings(apiKey: string): Promise<UserSettings | null> {
  try {
    const response = await fetch(
      `https://wallhaven.cc/api/v1/settings?apikey=${apiKey}`,
    );

    if (!response.ok) {
      console.error("Failed to fetch user settings:", response.status);
      return null;
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error("Error fetching user settings:", error);
    return null;
  }
}

function convertUserSettingsToPurity(purityArray: string[]): string {
  const sfw = purityArray.includes("sfw") ? "1" : "0";
  const sketchy = purityArray.includes("sketchy") ? "1" : "0";
  const nsfw = purityArray.includes("nsfw") ? "1" : "0";
  return `${sfw}${sketchy}${nsfw}`;
}

async function searchWallpapers(
  params: SearchParams,
): Promise<WallhavenResponse> {
  const searchQuery = params.query.trim() || "nature";

  const urlParams = new URLSearchParams({
    q: searchQuery,
    categories: params.categories,
    purity: params.purity,
    sorting: params.sorting,
    page: params.page.toString(),
  });

  if (params.sorting === "toplist" && params.topRange) {
    urlParams.append("topRange", params.topRange);
  }

  if (params.apiKey) {
    urlParams.append("apikey", params.apiKey);
  }

  const response = await fetch(
    `https://wallhaven.cc/api/v1/search?${urlParams.toString()}`,
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data: WallhavenResponse = await response.json();
  return data;
}

function WallpaperDetail({ wallpaper }: { wallpaper: Wallpaper }) {
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  const tags =
    wallpaper.tags && wallpaper.tags.length > 0
      ? wallpaper.tags.map((tag) => tag.name).join(", ")
      : "None";

  const colors =
    wallpaper.colors.length > 0 ? wallpaper.colors.join(", ") : "None";

  const markdown = `
![Wallpaper](${wallpaper.path})
`;

  return (
    <Detail
      markdown={markdown}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label
            title="Resolution"
            text={wallpaper.resolution}
          />
          <Detail.Metadata.Label
            title="Size"
            text={formatBytes(wallpaper.file_size)}
          />

          <Detail.Metadata.Separator />

          <Detail.Metadata.Label
            title="Favorites"
            text={`★ ${wallpaper.favorites.toLocaleString()}`}
          />
          <Detail.Metadata.Label
            title="Views"
            text={wallpaper.views.toLocaleString()}
          />

          {wallpaper.tags && wallpaper.tags.length > 0 && (
            <>
              <Detail.Metadata.Separator />
              <Detail.Metadata.TagList title="Tags">
                {wallpaper.tags.map((tag) => (
                  <Detail.Metadata.TagList.Item key={tag.id} text={tag.name} />
                ))}
              </Detail.Metadata.TagList>
            </>
          )}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <Action.OpenInBrowser
            title="Open in Browser"
            url={wallpaper.short_url}
          />
          <Action.CopyToClipboard
            title="Copy Image URL"
            content={wallpaper.path}
          />
          <Action.OpenInBrowser
            title="Download Original"
            url={wallpaper.path}
            shortcut={{ modifiers: ["cmd"], key: "d" }}
          />
        </ActionPanel>
      }
    />
  );
}

function WallhavenSearchContent() {
  const preferences = getPreferenceValues<Preferences>();
  const [searchText, setSearchText] = useState("");
  const [categories, setCategories] = useState("111");

  const { data: userSettings } = useQuery({
    queryKey: ["userSettings", preferences.apiKey],
    queryFn: () => fetchUserSettings(preferences.apiKey!),
    enabled: Boolean(preferences.apiKey && preferences.useUserSettings),
    staleTime: 60 * 60 * 1000, // Cache for 1 hour
  });

  const effectivePurity =
    preferences.useUserSettings && userSettings
      ? convertUserSettingsToPurity(userSettings.purity)
      : preferences.purity;

  const effectiveTopRange =
    preferences.useUserSettings && userSettings
      ? userSettings.toplist_range
      : preferences.topRange;

  const {
    data,
    isLoading,
    isError,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: [
      "wallpapers",
      searchText,
      categories,
      effectivePurity,
      preferences.sorting,
      effectiveTopRange,
      preferences.apiKey,
    ],
    queryFn: ({ pageParam = 1 }) =>
      searchWallpapers({
        query: searchText,
        categories,
        purity: effectivePurity,
        sorting: preferences.sorting,
        topRange: effectiveTopRange,
        page: pageParam,
        apiKey: preferences.apiKey,
      }),
    getNextPageParam: (lastPage) => {
      if (lastPage.meta.current_page < lastPage.meta.last_page) {
        return lastPage.meta.current_page + 1;
      }
      return undefined;
    },
    initialPageParam: 1,
  });

  const wallpapers = data?.pages.flatMap((page) => page.data) ?? [];
  const meta = data?.pages[data.pages.length - 1]?.meta;
  const currentPage = meta?.current_page ?? 1;

  if (isError && error) {
    showToast({
      style: Toast.Style.Failure,
      title: "Search failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }

  return (
    <Grid
      columns={3}
      fit={Grid.Fit.Fill}
      aspectRatio="16/9"
      isLoading={isLoading}
      searchBarPlaceholder="Search wallpapers..."
      onSearchTextChange={setSearchText}
      searchBarAccessory={
        <Grid.Dropdown
          tooltip="Categories"
          storeValue
          onChange={setCategories}
          value={categories}
        >
          <Grid.Dropdown.Item title="All Categories" value="111" />
          <Grid.Dropdown.Item title="General" value="100" />
          <Grid.Dropdown.Item title="Anime" value="010" />
          <Grid.Dropdown.Item title="People" value="001" />
          <Grid.Dropdown.Item title="General + Anime" value="110" />
        </Grid.Dropdown>
      }
    >
      <Grid.Section
        title={meta ? `Page ${currentPage} of ${meta.last_page}` : "Wallpapers"}
        subtitle={
          meta
            ? `${wallpapers.length} / ${meta.total.toLocaleString()} loaded`
            : undefined
        }
      >
        {wallpapers.map((wallpaper, index) => (
          <Grid.Item
            key={wallpaper.id}
            id={`wallpaper-${index}`}
            content={{
              value: wallpaper.thumbs.large,
            }}
            title={wallpaper.resolution}
            subtitle={`★ ${wallpaper.favorites} · ${wallpaper.views} views`}
            actions={
              <ActionPanel>
                <Action.Push
                  title="Show Preview"
                  target={<WallpaperDetail wallpaper={wallpaper} />}
                />
                <ActionPanel.Section>
                  <Action.OpenInBrowser
                    title="Open in Browser"
                    url={wallpaper.short_url}
                  />
                  <Action.CopyToClipboard
                    title="Copy Image URL"
                    content={wallpaper.path}
                  />
                  <Action.CopyToClipboard
                    title="Copy Page URL"
                    content={wallpaper.short_url}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
                  />
                  <Action.OpenInBrowser
                    title="Download Original"
                    url={wallpaper.path}
                    shortcut={{ modifiers: ["cmd"], key: "d" }}
                  />
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        ))}
        {hasNextPage && (
          <Grid.Item
            key="load-more"
            id={`wallpaper-${wallpapers.length}`}
            content={{
              value:
                "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32' fill='none' stroke='%23888888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 5v14M19 12l-7 7-7-7'/%3E%3C/svg%3E",
            }}
            title={isFetchingNextPage ? "Loading..." : "Load More"}
            subtitle={
              meta ? `Page ${currentPage + 1} of ${meta.last_page}` : undefined
            }
            actions={
              <ActionPanel>
                <Action title="Load More" onAction={() => fetchNextPage()} />
              </ActionPanel>
            }
          />
        )}
      </Grid.Section>
    </Grid>
  );
}

export default function WallhavenSearch() {
  return (
    <QueryClientProvider client={queryClient}>
      <WallhavenSearchContent />
    </QueryClientProvider>
  );
}
