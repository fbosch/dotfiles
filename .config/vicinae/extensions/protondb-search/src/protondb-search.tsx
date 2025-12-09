import { useState, useEffect } from "react";
import {
  List,
  ActionPanel,
  Action,
  showToast,
  Icon,
  Toast,
  Color,
  Cache,
  Detail,
} from "@vicinae/api";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import type {
  SteamGame,
  ProtonDBRating,
  ProtonDBTier,
  ProtonDBConfidence,
} from "./types";

const STEAM_SEARCH_URL = "https://steamcommunity.com/actions/SearchApps";
const PROTONDB_RATING_URL = "https://www.protondb.com/api/v1/reports/summaries";
const STEAM_APPDETAILS_URL = "https://www.protondb.com/proxy/steam/api/appdetails";
const STEAM_FEATURED_URL = "https://store.steampowered.com/api/featuredcategories";
const SEARCH_DEBOUNCE_MS = 500;

// Query cache configuration
const QUERY_STALE_TIME = 12 * 60 * 60 * 1000; // 12 hours
const QUERY_GC_TIME = 12 * 60 * 60 * 1000; // 12 hours

// Vicinae Cache only for featured games initial load
const cache = new Cache();
const FEATURED_GAMES_CACHE_KEY = "protondb-featured-games-v1";
const FEATURED_CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 hours

type CachedFeaturedGames = {
  games: SteamGame[];
  cachedAt: number;
};

function getCachedFeaturedGames(): SteamGame[] | null {
  const cached = cache.get(FEATURED_GAMES_CACHE_KEY);
  if (!cached) return null;

  try {
    const data: CachedFeaturedGames = JSON.parse(cached);
    if (Date.now() - data.cachedAt < FEATURED_CACHE_DURATION) {
      return data.games;
    }
    cache.remove(FEATURED_GAMES_CACHE_KEY);
    return null;
  } catch {
    cache.remove(FEATURED_GAMES_CACHE_KEY);
    return null;
  }
}

function setCachedFeaturedGames(games: SteamGame[]): void {
  const data: CachedFeaturedGames = {
    games,
    cachedAt: Date.now(),
  };
  cache.set(FEATURED_GAMES_CACHE_KEY, JSON.stringify(data));
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: QUERY_STALE_TIME,
      gcTime: QUERY_GC_TIME,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

async function searchSteamGames(query: string): Promise<SteamGame[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const response = await fetch(
    `${STEAM_SEARCH_URL}/${encodeURIComponent(trimmed)}`,
  );
  if (!response.ok) {
    throw new Error(
      `Steam search failed: ${response.status} ${response.statusText}`,
    );
  }

  const games: SteamGame[] = await response.json();
  return games.slice(0, 20); // Limit to 20 results
}

async function fetchFeaturedGames(): Promise<SteamGame[]> {
  try {
    const response = await fetch(STEAM_FEATURED_URL);
    if (!response.ok) {
      throw new Error(`Steam featured API failed: ${response.status}`);
    }

    const data = await response.json();
    const topSellers = data.top_sellers?.items || [];
    const specials = data.specials?.items || [];
    
    const games: SteamGame[] = [];
    const seenAppIds = new Set<number>();
    
    // Combine top sellers and specials, deduplicate and filter out Steam Deck
    const allItems = [...topSellers, ...specials];
    const appIds = allItems
      .map((item: any) => item.id)
      .filter((id: number) => {
        if (!id || id === 1675200 || seenAppIds.has(id)) return false;
        seenAppIds.add(id);
        return true;
      });

    for (const appId of appIds) {
      try {
        const detailsResponse = await fetch(`${STEAM_APPDETAILS_URL}?appids=${appId}`);
        if (!detailsResponse.ok) continue;

        const detailsData = await detailsResponse.json();
        const gameData = detailsData[appId];

        if (gameData?.success && gameData?.data && gameData.data.type === "game") {
          // Search for the game to get the icon URL
          const searchResponse = await fetch(`${STEAM_SEARCH_URL}/${encodeURIComponent(gameData.data.name)}`);
          let iconUrl = "";
          
          if (searchResponse.ok) {
            const searchResults: SteamGame[] = await searchResponse.json();
            const matchingGame = searchResults.find((g) => g.appid === String(appId));
            iconUrl = matchingGame?.icon || "";
          }

          games.push({
            appid: String(appId),
            name: gameData.data.name,
            icon: iconUrl,
            logo: gameData.data.capsule_imagev5 || gameData.data.header_image || "",
          });
        }
      } catch (error) {
        console.error(`Failed to fetch game ${appId}:`, error);
      }

      // Stop at 10 games
      if (games.length >= 10) break;
    }

    setCachedFeaturedGames(games);
    return games;
  } catch (error) {
    console.error("Failed to fetch featured games:", error);
    return [];
  }
}

async function fetchProtonDBRating(
  appId: string,
): Promise<ProtonDBRating | null> {
  try {
    const response = await fetch(`${PROTONDB_RATING_URL}/${appId}.json`);
    if (!response.ok) {
      if (response.status === 404) {
        // Game not in ProtonDB yet
        return null;
      }
      throw new Error(`ProtonDB request failed: ${response.status}`);
    }

    const rating: ProtonDBRating = await response.json();
    return rating;
  } catch (error) {
    console.error(`Failed to fetch ProtonDB rating for ${appId}:`, error);
    return null;
  }
}

async function fetchGameDetails(appId: string): Promise<any> {
  try {
    const response = await fetch(`${STEAM_APPDETAILS_URL}?appids=${appId}`);
    if (!response.ok) {
      throw new Error(`Steam API request failed: ${response.status}`);
    }

    const data = await response.json();
    const gameData = data[appId];

    if (gameData?.success && gameData?.data) {
      return gameData.data;
    }
    return null;
  } catch (error) {
    console.error(`Failed to fetch game details for ${appId}:`, error);
    return null;
  }
}

function getTierColor(tier: ProtonDBTier | undefined): Color {
  if (!tier) return Color.SecondaryText;

  const tierColors: Record<ProtonDBTier, Color> = {
    native: Color.Blue,
    platinum: Color.Purple,
    gold: Color.Yellow,
    silver: Color.Orange,
    bronze: Color.Orange,
    borked: Color.Red,
    pending: Color.SecondaryText,
  };

  return tierColors[tier] || Color.SecondaryText;
}

function getTierEmoji(tier: ProtonDBTier | undefined): string {
  if (!tier) return "❓";

  const tierEmojis: Record<ProtonDBTier, string> = {
    native: "🐧",
    platinum: "💎",
    gold: "🥇",
    silver: "🥈",
    bronze: "🥉",
    borked: "❌",
    pending: "❓",
  };

  return tierEmojis[tier] || "❓";
}

function formatTierName(tier: ProtonDBTier | undefined): string {
  if (!tier) return "Unknown";
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function formatConfidence(confidence: ProtonDBConfidence | undefined): string {
  if (!confidence) return "";
  return ` (${confidence} confidence)`;
}

function stripHtmlTags(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<ul[^>]*>/gi, "")
    .replace(/<\/ul>/gi, "")
    .replace(/<strong>(.*?)<\/strong>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

function GameDetail({ game }: { game: SteamGame }) {
  const { data: rating, isLoading: loadingRating } = useQuery({
    queryKey: ["protondb-rating", game.appid],
    queryFn: () => fetchProtonDBRating(game.appid),
  });

  const { data: gameDetails, isLoading: loadingDetails } = useQuery({
    queryKey: ["game-details", game.appid],
    queryFn: () => fetchGameDetails(game.appid),
  });

  // Build markdown conditionally to avoid layout shift
  // Only show image when gameDetails is loaded (has header_image)
  const markdown = gameDetails?.header_image
    ? `![${game.name}](${gameDetails.header_image})
  
# ${game.name}

${gameDetails?.short_description || ""}`
    : `# ${game.name}

${gameDetails?.short_description || ""}`;

  const formatPercentage = (score: number) => {
    return `${Math.round(score * 100)}%`;
  };

  return (
    <Detail
      isLoading={loadingDetails}
      markdown={markdown}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Steam App ID" text={game.appid} />

          {rating && (
            <>
              <Detail.Metadata.Separator />
              <Detail.Metadata.Label
                title="ProtonDB Rating"
                text={formatTierName(rating.tier)}
                icon={{
                  source: Icon.Circle,
                  tintColor: getTierColor(rating.tier),
                }}
              />
              <Detail.Metadata.Label
                title="Confidence"
                text={
                  rating.confidence.charAt(0).toUpperCase() +
                  rating.confidence.slice(1)
                }
              />
              <Detail.Metadata.Label
                title="Reports"
                text={`${rating.total} community reports`}
              />
              <Detail.Metadata.Label
                title="Score"
                text={formatPercentage(rating.score)}
              />
              <Detail.Metadata.Separator />
              <Detail.Metadata.Label
                title="Best Reported Tier"
                text={formatTierName(rating.bestReportedTier)}
                icon={{
                  source: Icon.Circle,
                  tintColor: getTierColor(rating.bestReportedTier),
                }}
              />
              <Detail.Metadata.Label
                title="Trending Tier"
                text={formatTierName(rating.trendingTier)}
                icon={{
                  source: Icon.Circle,
                  tintColor: getTierColor(rating.trendingTier),
                }}
              />
            </>
          )}

          {!rating && !loadingRating && (
            <>
              <Detail.Metadata.Separator />
              <Detail.Metadata.Label
                title="ProtonDB Rating"
                text="No reports available"
              />
            </>
          )}

          {gameDetails?.pc_requirements && (
            <>
              <Detail.Metadata.Separator />
              <Detail.Metadata.Label
                title="System Requirements (PC)"
                text={stripHtmlTags(
                  typeof gameDetails.pc_requirements === 'string'
                    ? gameDetails.pc_requirements
                    : gameDetails.pc_requirements.minimum || ''
                )}
              />
            </>
          )}

          {gameDetails?.linux_requirements && 
           typeof gameDetails.linux_requirements === 'object' && 
           gameDetails.linux_requirements.minimum &&
           stripHtmlTags(gameDetails.linux_requirements.minimum).length > 0 && (
            <>
              <Detail.Metadata.Separator />
              <Detail.Metadata.Label
                title="System Requirements (Linux)"
                text={stripHtmlTags(gameDetails.linux_requirements.minimum)}
              />
            </>
          )}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <Action.OpenInBrowser
            title="Open on ProtonDB"
            url={`https://www.protondb.com/app/${game.appid}`}
            icon={Icon.Globe}
          />
          <Action.OpenInBrowser
            title="Open on Steam"
            url={`https://store.steampowered.com/app/${game.appid}`}
            icon={Icon.Store}
            shortcut={{ modifiers: ["cmd"], key: "s" }}
          />
          <Action.OpenInBrowser
            title="Open in Steam"
            url={`steam://store/${game.appid}`}
            icon={Icon.AppWindow}
            shortcut={{ modifiers: ["cmd", "shift"], key: "s" }}
          />
          <ActionPanel.Section>
            <Action.CopyToClipboard
              title="Copy ProtonDB URL"
              content={`https://www.protondb.com/app/${game.appid}`}
              shortcut={{ modifiers: ["cmd"], key: "c" }}
            />
            {rating && (
              <Action.CopyToClipboard
                title="Copy Compatibility Info"
                content={`${game.name}: ${formatTierName(rating.tier)} (${rating.total} reports, ${rating.confidence} confidence)`}
                shortcut={{ modifiers: ["cmd", "shift"], key: "i" }}
              />
            )}
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

function GameListItem({ game }: { game: SteamGame }) {
  const { data: rating, isLoading } = useQuery({
    queryKey: ["protondb-rating", game.appid],
    queryFn: () => fetchProtonDBRating(game.appid),
  });

  const tierText = isLoading
    ? "Loading..."
    : rating
      ? `${getTierEmoji(rating.tier)} ${formatTierName(rating.tier)}${formatConfidence(rating.confidence)}`
      : "No rating";

  const accessories = [
    {
      text: tierText,
      ...(rating && {
        tag: {
          value: formatTierName(rating.tier),
          color: getTierColor(rating.tier),
        },
      }),
    },
  ];

  if (rating && rating.total > 0) {
    accessories.push({ text: `${rating.total} reports` });
  }

  return (
    <List.Item
      key={game.appid}
      title={game.name}
      icon={{ source: game.icon }}
      accessories={accessories}
      actions={
        <ActionPanel>
          <Action.Push
            title="Show Details"
            target={
              <QueryClientProvider client={queryClient}>
                <GameDetail game={game} />
              </QueryClientProvider>
            }
            icon={Icon.Eye}
          />
          <Action.OpenInBrowser
            title="Open on ProtonDB"
            url={`https://www.protondb.com/app/${game.appid}`}
            icon={Icon.Globe}
            shortcut={{ modifiers: ["cmd"], key: "p" }}
          />
          <Action.OpenInBrowser
            title="Open on Steam"
            url={`https://store.steampowered.com/app/${game.appid}`}
            icon={Icon.Store}
            shortcut={{ modifiers: ["cmd"], key: "s" }}
          />
          <Action.OpenInBrowser
            title="Open in Steam"
            url={`steam://store/${game.appid}`}
            icon={Icon.AppWindow}
            shortcut={{ modifiers: ["cmd", "shift"], key: "s" }}
          />
          <ActionPanel.Section>
            <Action.CopyToClipboard
              title="Copy ProtonDB URL"
              content={`https://www.protondb.com/app/${game.appid}`}
              shortcut={{ modifiers: ["cmd"], key: "c" }}
            />
            {rating && (
              <Action.CopyToClipboard
                title="Copy Compatibility Info"
                content={`${game.name}: ${formatTierName(rating.tier)} (${rating.total} reports, ${rating.confidence} confidence)`}
                shortcut={{ modifiers: ["cmd", "shift"], key: "i" }}
              />
            )}
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

function ProtonDBSearchContent() {
  const [searchText, setSearchText] = useState("");
  const debouncedSearch = useDebounce(searchText, SEARCH_DEBOUNCE_MS);

  // Featured games query (when no search)
  const { data: featuredGames = [], isLoading: loadingFeatured } = useQuery({
    queryKey: ["featured-games"],
    queryFn: fetchFeaturedGames,
    initialData: () => getCachedFeaturedGames() || undefined,
  });

  // Search query
  const {
    data: searchResults = [],
    isLoading: loadingSearch,
    isError,
    error,
  } = useQuery({
    queryKey: ["steam-search", debouncedSearch],
    queryFn: () => searchSteamGames(debouncedSearch),
    enabled: debouncedSearch.trim().length > 0,
  });

  if (isError && error) {
    showToast({
      style: Toast.Style.Failure,
      title: "Search failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }

  const showingSearch = debouncedSearch.trim().length > 0;
  const games = showingSearch ? searchResults : featuredGames;
  const isLoading = showingSearch ? loadingSearch : loadingFeatured;

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search Steam games..."
      onSearchTextChange={setSearchText}
    >
      {games.length === 0 && !isLoading ? (
        showingSearch ? (
          <List.EmptyView
            title="No games found"
            description="Try different search terms"
            icon={Icon.XMarkCircle}
          />
        ) : (
          <List.EmptyView
            title="Search Steam Games"
            description="Type to search for games and see their ProtonDB compatibility ratings"
            icon={Icon.MagnifyingGlass}
          />
        )
      ) : (
        <>
          {!showingSearch && games.length > 0 && (
            <List.Section title="Featured Games" />
          )}
          {showingSearch && games.length > 0 && (
            <List.Section title={`${games.length} Games Found`} />
          )}
          {games.map((game) => (
            <GameListItem key={game.appid} game={game} />
          ))}
        </>
      )}
    </List>
  );
}

export default function ProtonDBSearch() {
  return (
    <QueryClientProvider client={queryClient}>
      <ProtonDBSearchContent />
    </QueryClientProvider>
  );
}
