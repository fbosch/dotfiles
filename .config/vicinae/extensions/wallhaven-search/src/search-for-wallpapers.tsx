import { useState, useEffect } from "react";
import {
  Grid,
  ActionPanel,
  Action,
  showToast,
  Toast,
  Detail,
  getPreferenceValues,
  Icon,
  Cache,
} from "@vicinae/api";
import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { downloadWallpaper } from "./utils/download";
import { createRoundedImageSVG } from "./utils/imageWithRoundedCorners";

type Preferences = {
  apiKey?: string;
  useUserSettings: boolean;
  purity: string;
  sorting: string;
  topRange: string;
  downloadDirectory: string;
};

type UserSettings = {
  purity: string[];
  categories: string[];
  toplist_range: string;
  resolutions: string[];
  aspect_ratios: string[];
  ai_art_filter: number;
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

const cache = new Cache();
const USER_SETTINGS_CACHE_KEY = "wallhaven-user-settings-v1";
const DEFAULT_WALLPAPERS_CACHE_KEY = "wallhaven-default-wallpapers-v1";
const SETTINGS_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const WALLPAPERS_CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 hours

type CachedUserSettings = {
  settings: UserSettings;
  cachedAt: number;
};

type CachedWallpapers = {
  wallpapers: WallhavenResponse;
  cachedAt: number;
};

function getCachedUserSettings(): UserSettings | null {
  const cached = cache.get(USER_SETTINGS_CACHE_KEY);
  if (!cached) return null;

  try {
    const data: CachedUserSettings = JSON.parse(cached);
    const age = Date.now() - data.cachedAt;

    if (age < SETTINGS_CACHE_DURATION) {
      return data.settings;
    }

    cache.remove(USER_SETTINGS_CACHE_KEY);
    return null;
  } catch {
    cache.remove(USER_SETTINGS_CACHE_KEY);
    return null;
  }
}

function setCachedUserSettings(settings: UserSettings): void {
  const data: CachedUserSettings = {
    settings,
    cachedAt: Date.now(),
  };
  cache.set(USER_SETTINGS_CACHE_KEY, JSON.stringify(data));
}

function getCachedDefaultWallpapers(): WallhavenResponse | null {
  const cached = cache.get(DEFAULT_WALLPAPERS_CACHE_KEY);
  if (!cached) return null;

  try {
    const data: CachedWallpapers = JSON.parse(cached);
    const age = Date.now() - data.cachedAt;

    if (age < WALLPAPERS_CACHE_DURATION) {
      return data.wallpapers;
    }

    cache.remove(DEFAULT_WALLPAPERS_CACHE_KEY);
    return null;
  } catch {
    cache.remove(DEFAULT_WALLPAPERS_CACHE_KEY);
    return null;
  }
}

function setCachedDefaultWallpapers(wallpapers: WallhavenResponse): void {
  const data: CachedWallpapers = {
    wallpapers,
    cachedAt: Date.now(),
  };
  cache.set(DEFAULT_WALLPAPERS_CACHE_KEY, JSON.stringify(data));
}

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

type SearchParams = {
  query: string;
  categories: string;
  purity: string;
  sorting: string;
  topRange?: string;
  page: number;
  apiKey?: string;
  resolutions?: string[];
  aspectRatios?: string[];
  aiArtFilter?: number;
};

async function fetchUserSettings(apiKey: string): Promise<UserSettings | null> {
  try {
    const response = await fetch(
      `https://wallhaven.cc/api/v1/settings?apikey=${apiKey.trim()}`,
    );

    if (!response.ok) {
      console.error("Failed to fetch user settings:", response.status);
      return null;
    }

    const data = await response.json();
    console.log("User Settings Fetched:", data.data);
    const settings = data.data;

    setCachedUserSettings(settings);

    return settings;
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
    urlParams.append("apikey", params.apiKey.trim());
  }

  if (
    params.resolutions &&
    params.resolutions.length > 0 &&
    params.resolutions[0] !== ""
  ) {
    urlParams.append("resolutions", params.resolutions.join(","));
  }

  if (
    params.aspectRatios &&
    params.aspectRatios.length > 0 &&
    params.aspectRatios[0] !== ""
  ) {
    urlParams.append("ratios", params.aspectRatios.join(","));
  }

  if (params.aiArtFilter !== undefined) {
    urlParams.append("ai_art_filter", params.aiArtFilter.toString());
  }

  const url = `https://wallhaven.cc/api/v1/search?${urlParams.toString()}`;
  console.log("Wallhaven API Request:", url);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data: WallhavenResponse = await response.json();
  console.log("Wallhaven API Response:", {
    resultsCount: data.data.length,
    page: data.meta.current_page,
    total: data.meta.total,
  });

  const isDefaultSearch =
    params.query.trim() === "" &&
    params.page === 1 &&
    params.categories === "111";

  if (isDefaultSearch) {
    setCachedDefaultWallpapers(data);
  }

  return data;
}

function WallpaperDetail({ wallpaper }: { wallpaper: Wallpaper }) {
  const preferences = getPreferenceValues<Preferences>();

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  const handleDownload = async () => {
    await downloadWallpaper(
      wallpaper.path,
      wallpaper.id,
      wallpaper.resolution,
      preferences.downloadDirectory,
    );
  };

  const markdown = `
![Wallpaper](${wallpaper.thumbs.large})
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
          <Action
            title="Download Wallpaper"
            icon={Icon.Download}
            onAction={handleDownload}
            shortcut={{ modifiers: ["cmd"], key: "d" }}
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
            <Action.OpenInBrowser
              title="Download in Browser"
              url={wallpaper.path}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

function WallhavenSearchContent() {
  const preferences = getPreferenceValues<Preferences>();
  const [searchText, setSearchText] = useState("");
  const [categories, setCategories] = useState("111");
  const debouncedSearchText = useDebounce(searchText, 800);

  const handleDownload = async (wallpaper: Wallpaper) => {
    await downloadWallpaper(
      wallpaper.path,
      wallpaper.id,
      wallpaper.resolution,
      preferences.downloadDirectory,
    );
  };

  const { data: userSettings } = useQuery({
    queryKey: ["userSettings", preferences.apiKey],
    queryFn: () => fetchUserSettings(preferences.apiKey!),
    enabled: Boolean(preferences.apiKey && preferences.useUserSettings),
    initialData: () => getCachedUserSettings() || undefined,
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

  console.log("Settings:", {
    useUserSettings: preferences.useUserSettings,
    hasUserSettings: Boolean(userSettings),
    userSettingsPurity: userSettings?.purity,
    effectivePurity,
    preferencePurity: preferences.purity,
    effectiveTopRange,
    sorting: preferences.sorting,
  });

  const isDefaultSearch =
    debouncedSearchText.trim() === "" && categories === "111";

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
      debouncedSearchText,
      categories,
      effectivePurity,
      preferences.sorting,
      effectiveTopRange,
      preferences.apiKey,
      preferences.useUserSettings && userSettings
        ? userSettings.resolutions
        : undefined,
      preferences.useUserSettings && userSettings
        ? userSettings.aspect_ratios
        : undefined,
      preferences.useUserSettings && userSettings
        ? userSettings.ai_art_filter
        : undefined,
    ],
    queryFn: ({ pageParam = 1 }) =>
      searchWallpapers({
        query: debouncedSearchText,
        categories,
        purity: effectivePurity,
        sorting: preferences.sorting,
        topRange: effectiveTopRange,
        page: pageParam,
        apiKey: preferences.apiKey,
        resolutions:
          preferences.useUserSettings && userSettings
            ? userSettings.resolutions
            : undefined,
        aspectRatios:
          preferences.useUserSettings && userSettings
            ? userSettings.aspect_ratios
            : undefined,
        aiArtFilter:
          preferences.useUserSettings && userSettings
            ? userSettings.ai_art_filter
            : undefined,
      }),
    initialData: () => {
      if (isDefaultSearch) {
        const cached = getCachedDefaultWallpapers();
        if (cached) {
          return {
            pages: [cached],
            pageParams: [1],
          };
        }
      }
      return undefined;
    },
    staleTime: 12 * 60 * 60 * 1000, // 12 hours - avoid refetching
    gcTime: 12 * 60 * 60 * 1000, // 12 hours - keep in cache
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
            content={wallpaper.thumbs.large}
            subtitle={`${wallpaper.resolution} · ★ ${wallpaper.favorites} · ${wallpaper.views} views`}
            actions={
              <ActionPanel>
                <Action.Push
                  title="Show Preview"
                  target={<WallpaperDetail wallpaper={wallpaper} />}
                />
                <Action
                  title="Download Wallpaper"
                  icon={Icon.Download}
                  onAction={() => handleDownload(wallpaper)}
                  shortcut={{ modifiers: ["cmd"], key: "d" }}
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
                    title="Download in Browser"
                    url={wallpaper.path}
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
