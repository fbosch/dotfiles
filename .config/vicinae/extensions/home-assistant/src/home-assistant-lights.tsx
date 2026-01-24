import {
	keepPreviousData,
	QueryClient,
	QueryClientProvider,
	useQuery,
	useQueryClient,
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
import { useEffect, useMemo, useState } from "react";
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

const FAVORITE_LIGHTS_KEY = "homeAssistantFavoriteLights";

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
	preferences,
	hasPreferences,
	onUpdate,
}: {
	light: LightState;
	preferences: PreferencesState;
	hasPreferences: boolean;
	onUpdate: (update: LightSettingsUpdate) => void;
}) {
	const { data: lights = [] } = useQuery({
		queryKey: ["home-assistant", "lights"],
		queryFn: () => fetchLights(preferences),
		enabled: hasPreferences,
		placeholderData: keepPreviousData,
		refetchInterval: 1000,
		refetchIntervalInBackground: true,
	});

	const currentLight =
		lights.find((item) => item.entity_id === light.entity_id) ?? light;
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
										onUpdate({
											brightnessPercent: clampNumber(
												brightnessPercent + 10,
												0,
												100,
											),
										})
									}
								/>
								<Action
									title="Decrease Brightness"
									icon={Icon.Minus}
									onAction={() =>
										onUpdate({
											brightnessPercent: clampNumber(
												brightnessPercent - 10,
												0,
												100,
											),
										})
									}
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
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const queryClient = useQueryClient();

	const hasPreferences = Boolean(preferences.baseUrl && preferences.accessToken);

	useEffect(() => {
		if (!preferences.baseUrl || !preferences.accessToken) {
			setErrorMessage(null);
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
		isError,
		error,
	} = useQuery({
		queryKey: ["home-assistant", "lights"],
		queryFn: () => fetchLights(preferences),
		enabled: hasPreferences,
		placeholderData: keepPreviousData,
		refetchInterval: 1000,
		refetchIntervalInBackground: true,
	});

	const { data: favoriteLights = [] } = useQuery({
		queryKey: ["home-assistant", "lights", "favorites"],
		queryFn: loadFavoriteLights,
		staleTime: Infinity,
	});

	const favoriteSet = useMemo(
		() => new Set(favoriteLights),
		[favoriteLights],
	);

	useEffect(() => {
		if (isError && error) {
			const message =
				error instanceof Error ? error.message : "Unknown error";
			setErrorMessage(message);
			showToast({
				style: Toast.Style.Failure,
				title: "Failed to load lights",
				message,
			});
			console.error("[Home Assistant] Failed to load lights:", error);
		}
	}, [isError, error]);

	const filteredLights = useMemo(() => {
		const query = searchText.trim().toLowerCase();
		const sorted = [...lights].sort((a, b) =>
			friendlyName(a).localeCompare(friendlyName(b)),
		);
		if (!query) {
			return sorted.sort((a, b) => {
				const aFavorite = favoriteSet.has(a.entity_id);
				const bFavorite = favoriteSet.has(b.entity_id);
				if (aFavorite === bFavorite) {
					return friendlyName(a).localeCompare(friendlyName(b));
				}
				return aFavorite ? -1 : 1;
			});
		}
		return sorted.filter((light) => {
			const name = friendlyName(light).toLowerCase();
			return name.includes(query) || light.entity_id.toLowerCase().includes(query);
		});
	}, [lights, searchText, favoriteSet]);

	async function toggleFavorite(light: LightState): Promise<void> {
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
	}

	async function handleLightSettings(
		light: LightState,
		update: LightSettingsUpdate,
	): Promise<void> {
		const cachedLights = queryClient.getQueryData<LightState[]>([
			"home-assistant",
			"lights",
		]);
		const currentLight =
			cachedLights?.find((item) => item.entity_id === light.entity_id) ??
			light;

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

		try {
			await callLightService("turn_on", light.entity_id, preferences, payload);
			queryClient.setQueryData<LightState[]>(
				["home-assistant", "lights"],
				(existing) => {
					if (!existing) return existing;
					return existing.map((item) => {
						if (item.entity_id !== light.entity_id) return item;
						return {
							...item,
							state: "on",
							attributes: {
								...item.attributes,
								...(brightnessPayload !== null && {
									brightness: brightnessPayload,
								}),
								...(hsColorPayload && { hs_color: hsColorPayload }),
							},
							last_updated: new Date().toISOString(),
						};
					});
				},
			);
			await showToast({
				style: Toast.Style.Success,
				title: "Light updated",
				message: friendlyName(light),
			});
		} catch (requestError) {
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

	async function handleLightAction(
		light: LightState,
		service: "turn_on" | "turn_off" | "toggle",
		label: string,
	): Promise<void> {
		try {
			await callLightService(service, light.entity_id, preferences);
			queryClient.setQueryData<LightState[]>(
				["home-assistant", "lights"],
				(existing) => {
					if (!existing) return existing;
					return existing.map((item) => {
						if (item.entity_id !== light.entity_id) return item;
						const nextState =
							service === "turn_on"
								? "on"
								: service === "turn_off"
									? "off"
									: item.state === "on"
										? "off"
										: "on";
						return {
							...item,
							state: nextState,
							last_updated: new Date().toISOString(),
						};
					});
				},
			);
			await showToast({
				style: Toast.Style.Success,
				title: label,
				message: friendlyName(light),
			});
		} catch (requestError) {
			await showToast({
				style: Toast.Style.Failure,
				title: "Action failed",
				message:
					requestError instanceof Error
						? requestError.message
						: "Unknown error",
			});
		}
	}

	return (
		<List
			isLoading={isLoading}
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
			) : errorMessage ? (
				<List.EmptyView
					title="Failed to load lights"
					description={errorMessage}
					icon={Icon.Warning}
				/>
			) : filteredLights.length === 0 && !isLoading ? (
				<List.EmptyView
					title="No lights found"
					description="Check your Home Assistant instance"
					icon={Icon.LightBulb}
				/>
			) : (
				filteredLights.map((light) => (
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
									<Action
										title="Toggle Light"
										icon={Icon.Switch}
										onAction={() =>
											handleLightAction(light, "toggle", "Light toggled")
										}
									/>
									<Action.Push
										title="Adjust Brightness/Color"
										icon={Icon.EyeDropper}
										target={
											<QueryClientProvider client={queryClient}>
												<LightSettingsList
													light={light}
													preferences={preferences}
													hasPreferences={hasPreferences}
													onUpdate={(values) =>
													handleLightSettings(light, values)
												}
												/>
											</QueryClientProvider>
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
								<ActionPanel.Section>
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
										title="Toggle Detail"
										icon={Icon.AppWindowSidebarLeft}
										onAction={() => setShowingDetail(!showingDetail)}
										shortcut={{ modifiers: ["cmd"], key: "d" }}
									/>
								</ActionPanel.Section>
								<ActionPanel.Section>
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
							</ActionPanel>
						}
					/>
				))
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
