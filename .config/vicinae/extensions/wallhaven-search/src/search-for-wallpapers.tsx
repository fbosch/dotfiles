import {
	QueryClient,
	QueryClientProvider,
	useInfiniteQuery,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import {
	Action,
	ActionPanel,
	Cache,
	Color,
	Detail,
	Grid,
	getPreferenceValues,
	Icon,
	showToast,
	Toast,
} from "@vicinae/api";
import { useEffect, useState } from "react";
import { downloadAndApplyWallpaper, downloadWallpaper } from "./utils/download";

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
	file_type?: string;
	created_at?: string;
	ratio?: string;
	source?: string;
	uploader?: {
		username: string;
		group: string;
	};
	tags: Array<{
		id: number;
		name: string;
		category?: string;
		purity?: string;
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

function convertUserSettingsToCategories(categoriesArray: string[]): string {
	const general = categoriesArray.includes("general") ? "1" : "0";
	const anime = categoriesArray.includes("anime") ? "1" : "0";
	const people = categoriesArray.includes("people") ? "1" : "0";
	return `${general}${anime}${people}`;
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

async function fetchWallpaperDetails(
	id: string,
	apiKey?: string,
): Promise<Wallpaper> {
	const url = apiKey
		? `https://wallhaven.cc/api/v1/w/${id}?apikey=${apiKey.trim()}`
		: `https://wallhaven.cc/api/v1/w/${id}`;

	const response = await fetch(url);

	if (!response.ok) {
		throw new Error(`Failed to fetch wallpaper details: ${response.status}`);
	}

	const data = await response.json();
	return data.data;
}

function WallpaperDetail({ wallpaper }: { wallpaper: Wallpaper }) {
	const preferences = getPreferenceValues<Preferences>();

	// Fetch full wallpaper details to get tags
	const { data: fullWallpaper, isLoading } = useQuery({
		queryKey: ["wallpaper-detail", wallpaper.id],
		queryFn: () => fetchWallpaperDetails(wallpaper.id, preferences.apiKey),
		staleTime: 12 * 60 * 60 * 1000, // 12 hours
	});

	console.log("WallpaperDetail - fullWallpaper:", {
		id: fullWallpaper?.id,
		hasTags: Boolean(fullWallpaper?.tags),
		tagsLength: fullWallpaper?.tags?.length,
		tags: fullWallpaper?.tags,
	});

	const getTagColor = (category?: string): Color => {
		if (!category) return Color.Blue;

		// Color mapping based on tag categories
		const categoryColors: Record<string, Color> = {
			"Anime & Manga": Color.Magenta,
			People: Color.Orange,
			Landscapes: Color.Green,
			Nature: Color.Green,
			Plants: Color.Green,
			Architecture: Color.Purple,
			Animals: Color.Yellow,
			Fantasy: Color.Magenta,
			Vehicles: Color.Red,
			Technology: Color.Blue,
		};

		return categoryColors[category] || Color.Blue;
	};

	const formatBytes = (bytes: number) => {
		if (bytes === 0) return "0 Bytes";
		const k = 1024;
		const sizes = ["Bytes", "KB", "MB"];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return `${Math.round((bytes / k ** i) * 100) / 100} ${sizes[i]}`;
	};

	const formatDate = (dateString?: string) => {
		if (!dateString) return null;
		const date = new Date(dateString);
		return date.toLocaleDateString(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
		});
	};

	const formatCategory = (category: string) => {
		return category.charAt(0).toUpperCase() + category.slice(1);
	};

	const formatFileType = (fileType?: string) => {
		if (!fileType) return null;
		return fileType.replace("image/", "").toUpperCase();
	};

	const handleDownload = async () => {
		const wallpaperToDownload = fullWallpaper || wallpaper;
		await downloadWallpaper(
			wallpaperToDownload.path,
			wallpaperToDownload.id,
			wallpaperToDownload.resolution,
			preferences.downloadDirectory,
		);
	};

	const handleDownloadAndApply = async () => {
		const wallpaperToDownload = fullWallpaper || wallpaper;
		await downloadAndApplyWallpaper(
			wallpaperToDownload.path,
			wallpaperToDownload.id,
			wallpaperToDownload.resolution,
			preferences.downloadDirectory,
			preferences.hyprpaperConfigPath,
		);
	};

	const displayWallpaper = fullWallpaper || wallpaper;

	const markdown = `
<img src="${wallpaper.thumbs.large}" alt="Wallpaper" style="max-width: 100%; height: auto; object-fit: contain;" />
`;

	// Show minimal metadata while loading to avoid layout shift
	if (isLoading) {
		return (
			<Detail
				isLoading={true}
				markdown={markdown}
				metadata={
					<Detail.Metadata>
						<Detail.Metadata.Label
							title="Resolution"
							text={wallpaper.resolution}
						/>
						<Detail.Metadata.Label
							title="File"
							text={formatBytes(wallpaper.file_size)}
						/>
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
						<Action
							title="Download and Apply"
							icon={Icon.Desktop}
							onAction={handleDownloadAndApply}
							shortcut={{ modifiers: ["cmd"], key: "s" }}
						/>
					</ActionPanel>
				}
			/>
		);
	}

	return (
		<Detail
			markdown={markdown}
			metadata={
				<Detail.Metadata>
					<Detail.Metadata.Label
						title="Resolution"
						text={`${displayWallpaper.resolution}${displayWallpaper.ratio ? ` (${displayWallpaper.ratio})` : ""}`}
					/>
					<Detail.Metadata.Label
						title="File"
						text={`${formatBytes(displayWallpaper.file_size)}${formatFileType(displayWallpaper.file_type) ? ` · ${formatFileType(displayWallpaper.file_type)}` : ""}`}
					/>
					{displayWallpaper.tags && displayWallpaper.tags.length > 0 && (
						<>
							<Detail.Metadata.Separator />
							<Detail.Metadata.TagList title="Tags">
								{displayWallpaper.tags.map((tag) => (
									<Detail.Metadata.TagList.Item
										key={tag.id}
										text={tag.name}
										color={getTagColor(tag.category)}
									/>
								))}
							</Detail.Metadata.TagList>
						</>
					)}
					<Detail.Metadata.Separator />
					<Detail.Metadata.Label
						title="Category"
						text={formatCategory(displayWallpaper.category)}
					/>
					<Detail.Metadata.Label
						title="Stats"
						text={`★ ${displayWallpaper.favorites.toLocaleString()} favorites · ${displayWallpaper.views.toLocaleString()} views`}
					/>
					{displayWallpaper.uploader && (
						<Detail.Metadata.Label
							title="Uploader"
							text={displayWallpaper.uploader.username}
						/>
					)}
					{displayWallpaper.created_at && (
						<Detail.Metadata.Label
							title="Uploaded"
							text={formatDate(displayWallpaper.created_at) || "Unknown"}
						/>
					)}
					{displayWallpaper.source && (
						<Detail.Metadata.Link
							title="Source"
							text={displayWallpaper.source}
							target={displayWallpaper.source}
						/>
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
					<Action
						title="Download and Apply"
						icon={Icon.Desktop}
						onAction={handleDownloadAndApply}
						shortcut={{ modifiers: ["cmd"], key: "s" }}
					/>
					<ActionPanel.Section>
						<Action.OpenInBrowser
							title="Open in Browser"
							url={displayWallpaper.short_url}
						/>
						<Action.CopyToClipboard
							title="Copy Image URL"
							content={displayWallpaper.path}
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
	const debouncedSearchText = useDebounce(searchText, 400);
	const queryClientInstance = useQueryClient();

	const handleDownload = async (wallpaper: Wallpaper) => {
		await downloadWallpaper(
			wallpaper.path,
			wallpaper.id,
			wallpaper.resolution,
			preferences.downloadDirectory,
		);
	};

	const handleDownloadAndApply = async (wallpaper: Wallpaper) => {
		await downloadAndApplyWallpaper(
			wallpaper.path,
			wallpaper.id,
			wallpaper.resolution,
			preferences.downloadDirectory,
			preferences.hyprpaperConfigPath,
		);
	};

	const handleRefreshSettings = async () => {
		try {
			await showToast({
				style: Toast.Style.Animated,
				title: "Refreshing settings...",
			});

			// Clear the cache
			cache.remove(USER_SETTINGS_CACHE_KEY);
			cache.remove(DEFAULT_WALLPAPERS_CACHE_KEY);

			// Invalidate React Query cache
			await queryClientInstance.invalidateQueries({
				queryKey: ["userSettings"],
			});
			await queryClientInstance.invalidateQueries({
				queryKey: ["wallpapers"],
			});

			// Refetch will happen automatically due to invalidation
			await showToast({
				style: Toast.Style.Success,
				title: "Settings refreshed",
				message: "Cache cleared and settings reloaded",
			});
		} catch (error) {
			await showToast({
				style: Toast.Style.Failure,
				title: "Refresh failed",
				message: error instanceof Error ? error.message : "Unknown error",
			});
		}
	};

	const { data: rawUserSettings } = useQuery({
		queryKey: ["userSettings", preferences.apiKey],
		queryFn: () => {
			if (!preferences.apiKey) throw new Error("API key required");
			return fetchUserSettings(preferences.apiKey);
		},
		enabled: Boolean(preferences.apiKey && preferences.useUserSettings),
		initialData: () => {
			// Only use cached data if we're actually using user settings
			if (preferences.apiKey && preferences.useUserSettings) {
				return getCachedUserSettings() || undefined;
			}
			return undefined;
		},
		staleTime: 60 * 60 * 1000, // Cache for 1 hour
	});

	// Only use user settings if the feature is enabled AND we have an API key
	const userSettings = (preferences.useUserSettings && preferences.apiKey) ? rawUserSettings : undefined;

	const effectivePurity =
		preferences.useUserSettings && userSettings
			? convertUserSettingsToPurity(userSettings.purity)
			: preferences.purity;

	const effectiveTopRange =
		preferences.useUserSettings && userSettings
			? userSettings.toplist_range
			: preferences.topRange;

	const effectiveCategories =
		preferences.useUserSettings && userSettings
			? convertUserSettingsToCategories(userSettings.categories)
			: categories;

	console.log("Settings:", {
		useUserSettings: preferences.useUserSettings,
		hasUserSettings: Boolean(userSettings),
		userSettingsPurity: userSettings?.purity,
		effectivePurity,
		preferencePurity: preferences.purity,
		userSettingsCategories: userSettings?.categories,
		effectiveCategories,
		categoryDropdown: categories,
		effectiveTopRange,
		sorting: preferences.sorting,
	});

	const isDefaultSearch =
		debouncedSearchText.trim() === "" && effectiveCategories === "111";

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
			effectiveCategories,
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
				categories: effectiveCategories,
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
					value={
						preferences.useUserSettings && userSettings
							? effectiveCategories
							: categories
					}
					isDisabled={preferences.useUserSettings && Boolean(userSettings)}
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
									target={
										<QueryClientProvider client={queryClient}>
											<WallpaperDetail wallpaper={wallpaper} />
										</QueryClientProvider>
									}
								/>
								<Action
									title="Download Wallpaper"
									icon={Icon.Download}
									onAction={() => handleDownload(wallpaper)}
									shortcut={{ modifiers: ["cmd"], key: "d" }}
								/>
								<Action
									title="Download and Apply"
									icon={Icon.Desktop}
									onAction={() => handleDownloadAndApply(wallpaper)}
									shortcut={{ modifiers: ["cmd"], key: "s" }}
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
										title="Open Wallhaven Settings"
										url="https://wallhaven.cc/settings/account"
										shortcut={{ modifiers: ["cmd", "shift"], key: "s" }}
									/>
								</ActionPanel.Section>
								<ActionPanel.Section>
									<Action
										title="Refresh Settings & Cache"
										icon={Icon.ArrowClockwise}
										onAction={handleRefreshSettings}
										shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
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
								<ActionPanel.Section>
									<Action.OpenInBrowser
										title="Open Wallhaven Settings"
										url="https://wallhaven.cc/settings/account"
										shortcut={{ modifiers: ["cmd", "shift"], key: "s" }}
									/>
								</ActionPanel.Section>
								<ActionPanel.Section>
									<Action
										title="Refresh Settings & Cache"
										icon={Icon.ArrowClockwise}
										onAction={handleRefreshSettings}
										shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
									/>
								</ActionPanel.Section>
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
