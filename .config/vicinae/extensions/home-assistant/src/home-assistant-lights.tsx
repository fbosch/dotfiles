import {
	keepPreviousData,
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
import {
	Action,
	ActionPanel,
	Color,
	getPreferenceValues,
	Icon,
	LocalStorage,
	LaunchProps,
	List,
	showToast,
	Toast,
} from "@vicinae/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { callLightService, fetchLights } from "./api";
import type { LightState } from "./types";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 5 * 1000,
			refetchOnWindowFocus: false,
			retry: 1,
		},
	},
});

type PreferencesState = {
	baseUrl: string;
	accessToken: string;
};

type LightSettingsUpdate = {
	brightnessPercent?: number;
	hue?: number;
	saturation?: number;
};

type LightSettingsOptions = {
	allowWhilePending?: boolean;
	silent?: boolean;
	debounce?: boolean;
};

const FAVORITE_LIGHTS_KEY = "homeAssistantFavoriteLights";
const TRANSITION_SECONDS = 1.25;
const TRANSITION_MS = TRANSITION_SECONDS * 1000;
const DEBOUNCE_MS = 500;

async function loadFavoriteLights(): Promise<string[]> {
	const stored = await LocalStorage.getItem<string>(FAVORITE_LIGHTS_KEY);
	if (!stored) return [];

	try {
		return JSON.parse(stored) as string[];
	} catch {
		return [];
	}
}

async function saveFavoriteLights(favorites: string[]): Promise<void> {
	await LocalStorage.setItem(FAVORITE_LIGHTS_KEY, JSON.stringify(favorites));
}

function formatBrightness(brightness?: number): string | null {
	if (brightness === undefined || Number.isNaN(brightness)) return null;
	const percent = Math.round((brightness / 255) * 100);
	return `${percent}%`;
}

function formatBrightnessPercent(brightness?: number): number | null {
	if (brightness === undefined || Number.isNaN(brightness)) return null;
	return Math.round((brightness / 255) * 100);
}

function clampNumber(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function friendlyName(light: LightState): string {
	return light.attributes.friendly_name || light.entity_id;
}


function getLightAccessories(light: LightState): { text: string }[] {
	const accessories: { text: string }[] = [{ text: light.state }];
	const brightness = formatBrightness(light.attributes.brightness);
	if (brightness) accessories.push({ text: brightness });
	return accessories;
}

function getLightIcon(light: LightState) {
	const tintColor = light.state === "on" ? Color.Yellow : Color.SecondaryText;
	return { source: Icon.LightBulb, tintColor };
}

function LightSettingsList({
	light,
	onUpdate,
}: {
	light: LightState;
	onUpdate: (update: LightSettingsUpdate, options?: LightSettingsOptions) => void;
}) {
	const currentLight = light;
	const brightnessPercent =
		formatBrightnessPercent(currentLight.attributes.brightness) ?? 50;
	const hue = currentLight.attributes.hs_color?.[0] ?? 0;
	const saturation = currentLight.attributes.hs_color?.[1] ?? 100;

	const brightnessLabel = `${Math.round(brightnessPercent)}%`;
	const hueLabel = `${Math.round(hue)}°`;
	const saturationLabel = `${Math.round(saturation)}%`;

	const brightnessPresets = [0, 25, 50, 75, 100];
	const huePresets = [0, 30, 60, 120, 180, 240, 300];
	const huePresetLabels = [
		"Red",
		"Orange",
		"Yellow",
		"Green",
		"Cyan",
		"Blue",
		"Purple",
	];

	return (
		<List navigationTitle={`${friendlyName(currentLight)} Settings`}>
			<List.Section title="Brightness">
				<List.Item
					title="Brightness"
					subtitle={brightnessLabel}
					icon={Icon.LightBulb}
					actions={
						<ActionPanel>
							<ActionPanel.Section>
							<Action
								title="Increase Brightness"
								icon={Icon.Plus}
								onAction={() =>
									onUpdate(
										{
											brightnessPercent: clampNumber(
												brightnessPercent + 10,
												0,
												100,
											),
										},
										{ allowWhilePending: true, silent: true, debounce: true },
									)
								}
								shortcut={{ modifiers: ["cmd"], key: "]" }}
							/>
							<Action
								title="Decrease Brightness"
								icon={Icon.Minus}
								onAction={() =>
									onUpdate(
										{
											brightnessPercent: clampNumber(
												brightnessPercent - 10,
												0,
												100,
											),
										},
										{ allowWhilePending: true, silent: true, debounce: true },
									)
								}
								shortcut={{ modifiers: ["cmd"], key: "[" }}
							/>
							</ActionPanel.Section>
							<ActionPanel.Section title="Presets">
								{brightnessPresets.map((preset) => (
									<Action
										key={preset}
										title={`Set ${preset}%`}
										onAction={() =>
											onUpdate({ brightnessPercent: preset })
										}
									/>
								))}
							</ActionPanel.Section>
						</ActionPanel>
					}
				/>
			</List.Section>
			<List.Section title="Color">
				<List.Item
					title="Hue"
					subtitle={hueLabel}
					icon={Icon.Palette}
					actions={
						<ActionPanel>
							<ActionPanel.Section>
								<Action
									title="Increase Hue"
									icon={Icon.Plus}
									onAction={() =>
										onUpdate({
											hue: clampNumber(hue + 15, 0, 360),
										})
									}
								/>
								<Action
									title="Decrease Hue"
									icon={Icon.Minus}
									onAction={() =>
										onUpdate({
											hue: clampNumber(hue - 15, 0, 360),
										})
									}
								/>
							</ActionPanel.Section>
							<ActionPanel.Section title="Presets">
								{huePresets.map((preset, index) => (
									<Action
										key={preset}
										title={`Set ${huePresetLabels[index]}`}
										onAction={() => onUpdate({ hue: preset })}
									/>
								))}
							</ActionPanel.Section>
						</ActionPanel>
					}
				/>
				<List.Item
					title="Saturation"
					subtitle={saturationLabel}
					icon={Icon.Droplets}
					actions={
						<ActionPanel>
							<ActionPanel.Section>
								<Action
									title="Increase Saturation"
									icon={Icon.Plus}
									onAction={() =>
										onUpdate({
											saturation: clampNumber(
												saturation + 10,
												0,
												100,
											),
										})
									}
								/>
								<Action
									title="Decrease Saturation"
									icon={Icon.Minus}
									onAction={() =>
										onUpdate({
											saturation: clampNumber(
												saturation - 10,
												0,
												100,
											),
										})
									}
								/>
							</ActionPanel.Section>
							<ActionPanel.Section title="Presets">
								{[0, 25, 50, 75, 100].map((preset) => (
									<Action
										key={preset}
										title={`Set ${preset}%`}
										onAction={() => onUpdate({ saturation: preset })}
									/>
								))}
							</ActionPanel.Section>
						</ActionPanel>
					}
				/>
			</List.Section>
		</List>
	);
}

function LightDetail({ light }: { light: LightState }) {
	const brightness = formatBrightness(light.attributes.brightness);
	const markdown = `# ${friendlyName(light)}\n\nState: **${light.state}**`;

	return (
		<List.Item.Detail
			markdown={markdown}
			metadata={
				<List.Item.Detail.Metadata>
					<List.Item.Detail.Metadata.Label
						title="Entity ID"
						text={light.entity_id}
					/>
					<List.Item.Detail.Metadata.Label
						title="State"
						text={light.state}
					/>
					{brightness && (
						<List.Item.Detail.Metadata.Label
							title="Brightness"
							text={brightness}
						/>
					)}
					{light.attributes.color_mode && (
						<List.Item.Detail.Metadata.Label
							title="Color Mode"
							text={light.attributes.color_mode}
						/>
					)}
					<List.Item.Detail.Metadata.Label
						title="Last Updated"
						text={new Date(light.last_updated).toLocaleString()}
					/>
				</List.Item.Detail.Metadata>
			}
		/>
	);
}

function HomeAssistantLightsContent({ fallbackText }: { fallbackText?: string }) {
	const preferences = getPreferenceValues<PreferencesState>();
	const [searchText, setSearchText] = useState(fallbackText || "");
	const [showingDetail, setShowingDetail] = useState(false);
	const [pendingEntities, setPendingEntities] = useState<Set<string>>(
		() => new Set(),
	);
	const pendingEntitiesRef = useRef(new Set<string>());
	const debounceTimersRef = useRef(new Map<string, NodeJS.Timeout>());

	const setPending = useCallback((entityId: string, pending: boolean) => {
		if (pending) {
			pendingEntitiesRef.current.add(entityId);
			setPendingEntities((current) => {
				if (current.has(entityId)) return current;
				const next = new Set(current);
				next.add(entityId);
				return next;
			});
			return;
		}
		pendingEntitiesRef.current.delete(entityId);
		setPendingEntities((current) => {
			if (!current.has(entityId)) return current;
			const next = new Set(current);
			next.delete(entityId);
			return next;
		});
	}, []);

	const refreshLights = useCallback(async () => {
		const freshLights = await fetchLights(preferences);
		queryClient.setQueryData(["home-assistant", "lights"], freshLights);
		return freshLights;
	}, [preferences]);

	const refreshLightsAfterDelay = useCallback((delayMs: number) => {
		const timeoutId = setTimeout(() => {
			void refreshLights().catch((refreshError) => {
				console.error("[Home Assistant] Failed to refresh lights:", refreshError);
			});
		}, delayMs);
		return timeoutId;
	}, [refreshLights]);

	const hasPreferences = Boolean(preferences.baseUrl && preferences.accessToken);

	// Cleanup debounce timers on unmount
	useEffect(() => {
		return () => {
			for (const timerId of debounceTimersRef.current.values()) {
				clearTimeout(timerId);
			}
			debounceTimersRef.current.clear();
		};
	}, []);

	useEffect(() => {
		if (!preferences.baseUrl || !preferences.accessToken) {
			showToast({
				style: Toast.Style.Failure,
				title: "Missing preferences",
				message: "Set your Home Assistant URL and access token",
			});
		}
	}, [preferences.baseUrl, preferences.accessToken]);

	const {
		data: lights = [],
		isLoading,
		isSuccess,
		isError,
		error,
	} = useQuery({
		queryKey: ["home-assistant", "lights"],
		queryFn: () => fetchLights(preferences),
		enabled: hasPreferences,
		placeholderData: keepPreviousData,
		refetchInterval: 1000,
		refetchIntervalInBackground: true,
		onError: (queryError) => {
			const message =
				queryError instanceof Error ? queryError.message : "Unknown error";
			showToast({
				style: Toast.Style.Failure,
				title: "Failed to load lights",
				message,
			});
			console.error("[Home Assistant] Failed to load lights:", queryError);
		},
	});

	const lightsById = useMemo(() => {
		return new Map(lights.map((light) => [light.entity_id, light]));
	}, [lights]);

	useEffect(() => {
		if (!isSuccess) return;
		for (const light of lights) {
			setPending(light.entity_id, false);
		}
	}, [isSuccess, lights, setPending]);

	const { data: favoriteLights = [] } = useQuery({
		queryKey: ["home-assistant", "lights", "favorites"],
		queryFn: loadFavoriteLights,
		staleTime: Infinity,
	});

	const favoriteSet = useMemo(
		() => new Set(favoriteLights),
		[favoriteLights],
	);

	const filteredLights = useMemo(() => {
		const query = searchText.trim().toLowerCase();
		
		// Filter first if there's a search query
		const filtered = query
			? lights.filter((light) => {
					const name = friendlyName(light).toLowerCase();
					return name.includes(query) || light.entity_id.toLowerCase().includes(query);
			  })
			: lights;
		
		// Sort once: favorites first, then alphabetically
		return [...filtered].sort((a, b) => {
			const aFavorite = favoriteSet.has(a.entity_id);
			const bFavorite = favoriteSet.has(b.entity_id);
			if (aFavorite !== bFavorite) {
				return aFavorite ? -1 : 1;
			}
			return friendlyName(a).localeCompare(friendlyName(b));
		});
	}, [lights, searchText, favoriteSet]);

	const toggleFavorite = useCallback(async (light: LightState): Promise<void> => {
		const isFavorite = favoriteSet.has(light.entity_id);
		const updated = isFavorite
			? favoriteLights.filter((entityId) => entityId !== light.entity_id)
			: [light.entity_id, ...favoriteLights];

		await saveFavoriteLights(updated);
		queryClient.setQueryData(
			["home-assistant", "lights", "favorites"],
			updated,
		);
		await showToast({
			style: Toast.Style.Success,
			title: isFavorite ? "Removed from favorites" : "Added to favorites",
			message: friendlyName(light),
		});
	}, [favoriteLights, favoriteSet]);

	const handleLightSettings = useCallback(async (
		light: LightState,
		update: LightSettingsUpdate,
		options?: LightSettingsOptions,
	): Promise<void> => {
		if (
			pendingEntitiesRef.current.has(light.entity_id) &&
			!options?.allowWhilePending
		) {
			await showToast({
				style: Toast.Style.Failure,
				title: "Update in progress",
				message: "Waiting for Home Assistant to refresh",
			});
			return;
		}
		const currentLight = lightsById.get(light.entity_id) ?? light;

		const payload: Record<string, unknown> = {};
		const brightnessPercent = update.brightnessPercent;
		const currentHue = currentLight.attributes.hs_color?.[0] ?? 0;
		const currentSaturation = currentLight.attributes.hs_color?.[1] ?? 100;

		let brightnessPayload: number | null = null;
		let hsColorPayload: [number, number] | null = null;

		if (brightnessPercent !== undefined) {
			const clamped = clampNumber(brightnessPercent, 0, 100);
			brightnessPayload = Math.round((clamped / 100) * 255);
			payload.brightness = brightnessPayload;
		}

		if (update.hue !== undefined || update.saturation !== undefined) {
			const hue = clampNumber(update.hue ?? currentHue, 0, 360);
			const saturation = clampNumber(
				update.saturation ?? currentSaturation,
				0,
				100,
			);
			hsColorPayload = [hue, saturation];
			payload.hs_color = hsColorPayload;
		}

		if (Object.keys(payload).length === 0) {
			await showToast({
				style: Toast.Style.Failure,
				title: "No settings provided",
				message: "Choose brightness or color settings",
			});
			return;
		}

		// Store previous state for rollback on error
		const previousData = queryClient.getQueryData<LightState[]>(["home-assistant", "lights"]);

		// Always update cache optimistically for immediate UI feedback
		queryClient.setQueryData<LightState[]>(
			["home-assistant", "lights"],
			(oldData) => {
				if (!oldData) return oldData;
				return oldData.map((l) => {
					if (l.entity_id !== light.entity_id) return l;
					const updatedAttributes = { ...l.attributes };
					if (brightnessPayload !== null) {
						updatedAttributes.brightness = brightnessPayload;
					}
					if (hsColorPayload !== null) {
						updatedAttributes.hs_color = hsColorPayload;
					}
					return { ...l, attributes: updatedAttributes };
				});
			},
		);

		// Debounced mode: cancel previous timer and schedule new API call
		if (options?.debounce) {
			const timerId = debounceTimersRef.current.get(light.entity_id);
			if (timerId) {
				clearTimeout(timerId);
			}
			
			const newTimerId = setTimeout(() => {
				debounceTimersRef.current.delete(light.entity_id);
				void (async () => {
					try {
						await callLightService("turn_on", light.entity_id, preferences, {
							...payload,
							transition: TRANSITION_SECONDS,
						});
						refreshLightsAfterDelay(TRANSITION_MS);
						if (!options?.silent) {
							await showToast({
								style: Toast.Style.Success,
								title: "Light updated",
								message: friendlyName(light),
							});
						}
					} catch (requestError) {
						// Rollback optimistic update on error
						if (previousData) {
							queryClient.setQueryData(["home-assistant", "lights"], previousData);
						}
						if (!options?.silent) {
							await showToast({
								style: Toast.Style.Failure,
								title: "Update failed",
								message:
									requestError instanceof Error
										? requestError.message
										: "Unknown error",
							});
						}
						console.error("[Home Assistant] Light settings update failed:", requestError);
					}
				})();
			}, DEBOUNCE_MS);
			
			debounceTimersRef.current.set(light.entity_id, newTimerId);
			return;
		}

		// Non-debounced mode: immediate API call
		if (!options?.allowWhilePending) {
			setPending(light.entity_id, true);
		}
		try {
			await callLightService("turn_on", light.entity_id, preferences, {
				...payload,
				transition: TRANSITION_SECONDS,
			});
			if (options?.allowWhilePending) {
				refreshLightsAfterDelay(TRANSITION_MS);
				if (!options?.silent) {
					await showToast({
						style: Toast.Style.Success,
						title: "Light updated",
						message: friendlyName(light),
					});
				}
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, TRANSITION_MS));
			await refreshLights();
			setPending(light.entity_id, false);
			if (!options?.silent) {
				await showToast({
					style: Toast.Style.Success,
					title: "Light updated",
					message: friendlyName(light),
				});
			}
		} catch (requestError) {
			setPending(light.entity_id, false);
			if (!options?.silent) {
				await showToast({
					style: Toast.Style.Failure,
					title: "Update failed",
					message:
						requestError instanceof Error
							? requestError.message
							: "Unknown error",
				});
			}
		}
	}, [
		lightsById,
		preferences,
		queryClient,
		refreshLights,
		refreshLightsAfterDelay,
		setPending,
	]);

	const handleLightAction = useCallback(async (
		light: LightState,
		service: "turn_on" | "turn_off" | "toggle",
		label: string,
	): Promise<void> => {
		if (pendingEntitiesRef.current.has(light.entity_id)) {
			await showToast({
				style: Toast.Style.Failure,
				title: "Update in progress",
				message: "Waiting for Home Assistant to refresh",
			});
			return;
		}
		setPending(light.entity_id, true);
		try {
			await callLightService(service, light.entity_id, preferences, {
				transition: TRANSITION_SECONDS,
			});
			await new Promise((resolve) => setTimeout(resolve, TRANSITION_MS));
			await refreshLights();
			setPending(light.entity_id, false);
			await showToast({
				style: Toast.Style.Success,
				title: label,
				message: friendlyName(light),
			});
		} catch (requestError) {
			setPending(light.entity_id, false);
			await showToast({
				style: Toast.Style.Failure,
				title: "Action failed",
				message:
					requestError instanceof Error
						? requestError.message
						: "Unknown error",
			});
		}
	}, [
		preferences,
		refreshLights,
		setPending,
	]);

	return (
		<List
			isLoading={isLoading || pendingEntities.size > 0}
			isShowingDetail={showingDetail}
			searchBarPlaceholder="Search lights..."
			onSearchTextChange={setSearchText}
			searchText={searchText}
		>
			{!hasPreferences ? (
				<List.EmptyView
					title="Configure Home Assistant"
					description="Set your Home Assistant URL and access token"
					icon={Icon.Gear}
				/>
			) : isError && error ? (
				<List.EmptyView
					title="Failed to load lights"
					description={
						error instanceof Error ? error.message : "Unknown error"
					}
					icon={Icon.Warning}
				/>
			) : filteredLights.length === 0 && !isLoading ? (
				<List.EmptyView
					title="No lights found"
					description="Check your Home Assistant instance"
					icon={Icon.LightBulb}
				/>
			) : (
				filteredLights.map((light) => {
					const brightnessPercent =
						formatBrightnessPercent(light.attributes.brightness) ?? 50;
					return (
						<List.Item
							key={light.entity_id}
							title={friendlyName(light)}
							subtitle={
								light.attributes.friendly_name ? light.entity_id : undefined
							}
							icon={getLightIcon(light)}
							accessories={getLightAccessories(light)}
							detail={<LightDetail light={light} />}
							actions={
								<ActionPanel>
									<ActionPanel.Section title="Primary Actions">
										<Action
											title="Toggle Light"
											icon={Icon.Switch}
											onAction={() =>
												handleLightAction(light, "toggle", "Light toggled")
											}
										/>
										<Action
											title="Toggle Detail"
											icon={Icon.AppWindowSidebarLeft}
											onAction={() => setShowingDetail(!showingDetail)}
											shortcut={{ modifiers: ["cmd"], key: "d" }}
										/>
										<Action
											title="Increase Brightness"
											icon={Icon.Plus}
											onAction={() =>
												handleLightSettings(
													light,
													{
														brightnessPercent: clampNumber(
															brightnessPercent + 10,
															0,
															100,
														),
													},
													{ allowWhilePending: true, silent: true, debounce: true },
												)
											}
											shortcut={{ modifiers: ["cmd"], key: "]" }}
										/>
										<Action
											title="Decrease Brightness"
											icon={Icon.Minus}
											onAction={() =>
												handleLightSettings(
													light,
													{
														brightnessPercent: clampNumber(
															brightnessPercent - 10,
															0,
															100,
														),
													},
													{ allowWhilePending: true, silent: true, debounce: true },
												)
											}
											shortcut={{ modifiers: ["cmd"], key: "[" }}
										/>
										<Action.Push
											title="Adjust Brightness/Color"
											icon={Icon.EyeDropper}
											target={
												<LightSettingsList
													light={light}
													onUpdate={(values, options) =>
														handleLightSettings(light, values, options)
													}
												/>
											}
										/>
									</ActionPanel.Section>
									<ActionPanel.Section title="Light Control">
										<Action
											title="Turn On"
											icon={Icon.LightBulb}
											onAction={() =>
												handleLightAction(light, "turn_on", "Light turned on")
											}
										/>
										<Action
											title="Turn Off"
											icon={Icon.LightBulbOff}
											onAction={() =>
												handleLightAction(light, "turn_off", "Light turned off")
											}
										/>
										<Action
											title={
												favoriteSet.has(light.entity_id)
													? "Remove from Favorites"
													: "Add to Favorites"
											}
											icon={Icon.Pin}
											onAction={() => toggleFavorite(light)}
										/>
									</ActionPanel.Section>
									<ActionPanel.Section title="External">
										<Action.OpenInBrowser
											title="Open Home Assistant"
											url={preferences.baseUrl}
											shortcut={{ modifiers: ["cmd"], key: "o" }}
										/>
										<Action.CopyToClipboard
											title="Copy Entity ID"
											content={light.entity_id}
											shortcut={{ modifiers: ["cmd"], key: "c" }}
										/>
									</ActionPanel.Section>
									<ActionPanel.Section title="Management">
										<Action
											title="Refresh"
											icon={Icon.Repeat}
											onAction={() =>
												queryClient.invalidateQueries({
													queryKey: ["home-assistant", "lights"],
												})
											}
											shortcut={{ modifiers: ["cmd"], key: "r" }}
										/>
									</ActionPanel.Section>
								</ActionPanel>
							}
					/>
					);
				})
			)}
		</List>
	);
}

export default function HomeAssistantLights(props: LaunchProps) {
	return (
		<QueryClientProvider client={queryClient}>
			<HomeAssistantLightsContent fallbackText={props.fallbackText} />
		</QueryClientProvider>
	);
}
