import { useState } from "react";
import {
  Grid,
  ActionPanel,
  Action,
  showToast,
  Toast,
  Detail,
  getPreferenceValues,
} from "@vicinae/api";
import {
  keepPreviousData,
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";

type Preferences = {
  purity: string;
  sorting: string;
  topRange: string;
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
      staleTime: 5 * 60 * 1000,
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
};

async function searchWallpapers(params: SearchParams): Promise<Wallpaper[]> {
  const searchQuery = params.query.trim() || "nature";

  const urlParams = new URLSearchParams({
    q: searchQuery,
    categories: params.categories,
    purity: params.purity,
    sorting: params.sorting,
  });

  if (params.sorting === "toplist" && params.topRange) {
    urlParams.append("topRange", params.topRange);
  }

  const response = await fetch(
    `https://wallhaven.cc/api/v1/search?${urlParams.toString()}`,
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data: WallhavenResponse = await response.json();
  return data.data;
}

function WallpaperDetail({ wallpaper }: { wallpaper: Wallpaper }) {
  const markdown = `
![Preview](${wallpaper.path})
# ${wallpaper.resolution}
## Stats
- **Favorites:** ❤️ ${wallpaper.favorites.toLocaleString()}
- **Views:** 👁️ ${wallpaper.views.toLocaleString()}
- **Resolution:** ${wallpaper.resolution}
- **Colors:** ${wallpaper.colors.join(", ")}

[View on Wallhaven](${wallpaper.short_url})
`;

  return (
    <Detail
      markdown={markdown}
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

  const {
    data: wallpapers = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["wallpapers", searchText, categories, preferences.purity, preferences.sorting, preferences.topRange],
    queryFn: () =>
      searchWallpapers({
        query: searchText,
        categories,
        purity: preferences.purity,
        sorting: preferences.sorting,
        topRange: preferences.topRange,
      }),
    placeholderData: keepPreviousData,
  });

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
      throttle
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
      {wallpapers.map((wallpaper) => (
        <Grid.Item
          key={wallpaper.id}
          content={{
            value: wallpaper.thumbs.large,
            inset: Grid.Inset.None,
            rounded: true,
          }}
          title={wallpaper.resolution}
          subtitle={`❤️ ${wallpaper.favorites} · 👁️ ${wallpaper.views}`}
          actions={
            <ActionPanel>
              <Action.Push
                title="Show Preview"
                target={<WallpaperDetail wallpaper={wallpaper} />}
              />
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
            </ActionPanel>
          }
        />
      ))}
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
