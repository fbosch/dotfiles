import { QueryClientProvider, useInfiniteQuery } from "@tanstack/react-query";
import {
	Action,
	ActionPanel,
	Grid,
	getPreferenceValues,
	Icon,
	showToast,
	Toast,
} from "@vicinae/api";
import { useState } from "react";
import { convertUserSettingsToPurity, searchWallpapers } from "../api";
import { getCachedDefaultWallpapers } from "../cache";
import { DEFAULT_CATEGORIES, DEFAULT_DEBOUNCE_MS } from "../constants";
import { useDebounce } from "../hooks";
import { queryClient } from "../queryClient";
import type { Preferences, Wallpaper } from "../types";
import { downloadWallpaper } from "../utils/download";
import { WallpaperDetail } from "./WallpaperDetail";

export function WallpaperGrid() {
	const preferences = getPreferenceValues<Preferences>();
	const [searchText, setSearchText] = useState("");
	const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
	const debouncedSearchText = useDebounce(searchText, DEFAULT_DEBOUNCE_MS);

	const handleDownload = async (wallpaper: Wallpaper) => {
		await downloadWallpaper(
			wallpaper.path,
			wallpaper.id,
			wallpaper.resolution,
			preferences.downloadDirectory,
		);
	};

	const { data: userSettings } = useInfiniteUserSettings(preferences);

	const effectivePurity =
		preferences.useUserSettings && userSettings
			? convertUserSettingsToPurity(userSettings.purity)
			: preferences.purity;

	const effectiveTopRange =
		preferences.useUserSettings && userSettings
			? userSettings.toplist_range
			: preferences.topRange;

	const isDefaultSearch =
		debouncedSearchText.trim() === "" && categories === DEFAULT_CATEGORIES;

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
		staleTime: 12 * 60 * 60 * 1000,
		gcTime: 12 * 60 * 60 * 1000,
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

// Extracted user settings query to simplify main component
import { useQuery } from "@tanstack/react-query";
import { fetchUserSettings } from "../api";
import { getCachedUserSettings } from "../cache";
import type { UserSettings } from "../types";

function useInfiniteUserSettings(preferences: Preferences) {
	const { data: userSettings } = useQuery<UserSettings | null>({
		queryKey: ["userSettings", preferences.apiKey],
		queryFn: () => {
			if (!preferences.apiKey) throw new Error("API key required");
			return fetchUserSettings(preferences.apiKey);
		},
		enabled: Boolean(preferences.apiKey && preferences.useUserSettings),
		initialData: () => getCachedUserSettings() || undefined,
		staleTime: 60 * 60 * 1000,
	});
	return { data: userSettings };
}
