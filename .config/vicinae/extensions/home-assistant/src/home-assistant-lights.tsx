import {
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
	type LaunchProps,
	List,
	showToast,
	Toast,
} from "@vicinae/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { callLightService, fetchLights } from "./api";
import {
	applyLightUpdate,
	LightUpdateCoordinator,
	type LightUpdatePayload,
	type LightUpdateRollback,
} from "./light-update-coordinator";
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
	brightnessDelta?: number;
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
const LIGHTS_QUERY_KEY = ["home-assistant", "lights"] as const;

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

function applyLightRollback(
	light: LightState,
	rollback: LightUpdateRollback,
): LightState {
	const attributes = { ...light.attributes };
	if (Object.prototype.hasOwnProperty.call(rollback, "brightness")) {
		attributes.brightness = rollback.brightness;
	}
	if (Object.prototype.hasOwnProperty.call(rollback, "hs_color")) {
		attributes.hs_color = rollback.hs_color;
	}
	return { ...light, attributes };
}

function LightSettingsList({
	light,
	onUpdate,
}: {
	light: LightState;
	onUpdate: (
		update: LightSettingsUpdate,
		options?: LightSettingsOptions,
	) => void;
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
											{ brightnessDelta: 10 },
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
											{ brightnessDelta: -10 },
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
										onAction={() => onUpdate({ brightnessPercent: preset })}
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
					icon={Icon.Brush}
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
											saturation: clampNumber(saturation + 10, 0, 100),
										})
									}
								/>
								<Action
									title="Decrease Saturation"
									icon={Icon.Minus}
									onAction={() =>
										onUpdate({
											saturation: clampNumber(saturation - 10, 0, 100),
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
					<List.Item.Detail.Metadata.Label title="State" text={light.state} />
					{brightness && (
						<List.Item.Detail.Metadata.Label title="Brightness" text={brightness} />
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

function HomeAssistantLightsContent({
	fallbackText,
}: {
	fallbackText?: string;
}) {
	const preferences = getPreferenceValues<PreferencesState>();
	const [searchText, setSearchText] = useState(fallbackText || "");
	const [showingDetail, setShowingDetail] = useState(false);
	const [coordinatorVersion, setCoordinatorVersion] = useState(0);
	const coordinatorRef = useRef<LightUpdateCoordinator | null>(null);
	if (!coordinatorRef.current) {
		coordinatorRef.current = new LightUpdateCoordinator({
			callbacks: {
				onChange: () => setCoordinatorVersion((version: number) => version + 1),
				onRollback: (entityId, rollback) => {
					queryClient.setQueryData<LightState[]>(LIGHTS_QUERY_KEY, (current) =>
						current?.map((light) =>
							light.entity_id === entityId
								? applyLightRollback(light, rollback)
								: light,
						),
					);
				},
				onError: (error, context) => {
					const message = error instanceof Error ? error.message : "Unknown error";
					void showToast({
						style: Toast.Style.Failure,
						title: context.kind === "action" ? "Action failed" : "Update failed",
						message,
					});
					console.error("[Home Assistant] Light operation failed:", error);
				},
				onSuccess: (context) => {
					if (context.silent) return;
					void showToast({
						style: Toast.Style.Success,
						title: context.kind === "action" ? context.label : "Light updated",
						message: context.kind === "action" ? context.entityId : context.label,
					});
				},
			},
		});
	}
	const coordinator = coordinatorRef.current;

	const refreshLights = useCallback(async () => {
		await queryClient.cancelQueries({ queryKey: LIGHTS_QUERY_KEY });
		const freshLights = await fetchLights(preferences);
		queryClient.setQueryData<LightState[]>(LIGHTS_QUERY_KEY, freshLights);
		return freshLights;
	}, [preferences]);

	const hasPreferences = Boolean(preferences.baseUrl && preferences.accessToken);

	useEffect(() => () => coordinator.dispose(), [coordinator]);

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
		data: rawLights = [],
		isLoading,
		isError,
		error,
	} = useQuery<LightState[]>({
		queryKey: LIGHTS_QUERY_KEY,
		queryFn: () => fetchLights(preferences),
		enabled: hasPreferences,
		refetchInterval: 1000,
		refetchIntervalInBackground: true,
	});

	useEffect(() => {
		if (!isError || !error) return;
		const message = error instanceof Error ? error.message : "Unknown error";
		void showToast({
			style: Toast.Style.Failure,
			title: "Failed to load lights",
			message,
		});
		console.error("[Home Assistant] Failed to load lights:", error);
	}, [isError, error]);

	// Keep optimistic desired values outside the query cache so polling cannot clear them.
	const lights = useMemo(
		() =>
			rawLights.map((light) =>
				applyLightUpdate(light, coordinator.getDesired(light.entity_id) ?? {}),
			),
		[coordinator, coordinatorVersion, rawLights],
	);

	const lightsById = useMemo(
		() =>
			new Map<string, LightState>(
				lights.map((light: LightState): [string, LightState] => [
					light.entity_id,
					light,
				]),
			),
		[lights],
	);

	useEffect(() => {
		for (const light of rawLights) coordinator.confirm(light.entity_id, light);
	}, [coordinator, rawLights]);

	const { data: favoriteLights = [] } = useQuery({
		queryKey: ["home-assistant", "lights", "favorites"],
		queryFn: loadFavoriteLights,
		staleTime: Infinity,
	});

	const favoriteSet = useMemo(() => new Set(favoriteLights), [favoriteLights]);

	const filteredLights = useMemo(() => {
		const query = searchText.trim().toLowerCase();

		// Filter first if there's a search query
		const filtered = query
			? lights.filter((light: LightState) => {
					const name = friendlyName(light).toLowerCase();
					return (
						name.includes(query) || light.entity_id.toLowerCase().includes(query)
					);
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

	const toggleFavorite = useCallback(
		async (light: LightState): Promise<void> => {
			const isFavorite = favoriteSet.has(light.entity_id);
			const updated = isFavorite
				? favoriteLights.filter((entityId) => entityId !== light.entity_id)
				: [light.entity_id, ...favoriteLights];

			await saveFavoriteLights(updated);
			queryClient.setQueryData(["home-assistant", "lights", "favorites"], updated);
			await showToast({
				style: Toast.Style.Success,
				title: isFavorite ? "Removed from favorites" : "Added to favorites",
				message: friendlyName(light),
			});
		},
		[favoriteLights, favoriteSet],
	);

	const handleLightSettings = useCallback(
		async (
			light: LightState,
			update: LightSettingsUpdate,
			options?: LightSettingsOptions,
		): Promise<void> => {
			const currentLight = applyLightUpdate(
				lightsById.get(light.entity_id) ?? light,
				coordinator.getDesired(light.entity_id) ?? {},
			);
			const currentBrightnessPercent =
				formatBrightnessPercent(currentLight.attributes.brightness) ?? 50;
			const brightnessPercent =
				update.brightnessDelta !== undefined
					? currentBrightnessPercent + update.brightnessDelta
					: update.brightnessPercent;
			const currentHue = currentLight.attributes.hs_color?.[0] ?? 0;
			const currentSaturation = currentLight.attributes.hs_color?.[1] ?? 100;
			const payload: LightUpdatePayload = {};

			if (brightnessPercent !== undefined) {
				const clamped = clampNumber(brightnessPercent, 0, 100);
				payload.brightness = Math.round((clamped / 100) * 255);
			}

			if (update.hue !== undefined || update.saturation !== undefined) {
				payload.hs_color = [
					clampNumber(update.hue ?? currentHue, 0, 360),
					clampNumber(update.saturation ?? currentSaturation, 0, 100),
				];
			}

			if (Object.keys(payload).length === 0) {
				await showToast({
					style: Toast.Style.Failure,
					title: "No settings provided",
					message: "Choose brightness or color settings",
				});
				return;
			}

			coordinator.submitSettings(light.entity_id, currentLight, payload, {
				debounce: options?.debounce,
				silent: options?.silent,
				label: friendlyName(currentLight),
				execute: (requestPayload: LightUpdatePayload) =>
					callLightService("turn_on", light.entity_id, preferences, {
						...requestPayload,
						transition: TRANSITION_SECONDS,
					}),
				afterSuccess: async () => {
					const freshLights = await refreshLights();
					return freshLights.find(
						(freshLight: LightState) => freshLight.entity_id === light.entity_id,
					);
				},
			});
		},
		[coordinator, lightsById, preferences, refreshLights],
	);

	const handleLightAction = useCallback(
		async (
			light: LightState,
			service: "turn_on" | "turn_off" | "toggle",
			label: string,
		): Promise<void> => {
			coordinator.submitAction(light.entity_id, {
				label,
				execute: () =>
					callLightService(service, light.entity_id, preferences, {
						transition: TRANSITION_SECONDS,
					}),
				afterSuccess: async () => {
					await refreshLights();
					return true;
				},
			});
		},
		[coordinator, preferences, refreshLights],
	);

	return (
		<List
			isLoading={isLoading || coordinator.getPendingCount() > 0}
			isShowingDetail={showingDetail}
			searchBarPlaceholder="Search lights..."
			onSearchTextChange={setSearchText}
			searchText={searchText}
		>
			{!hasPreferences ? (
				<List.EmptyView
					title="Configure Home Assistant"
					description="Set your Home Assistant URL and access token"
					icon={Icon.Cog}
				/>
			) : isError && error ? (
				<List.EmptyView
					title="Failed to load lights"
					description={error instanceof Error ? error.message : "Unknown error"}
					icon={Icon.Warning}
				/>
			) : filteredLights.length === 0 && !isLoading ? (
				<List.EmptyView
					title="No lights found"
					description="Check your Home Assistant instance"
					icon={Icon.LightBulb}
				/>
			) : (
				filteredLights.map((light: LightState) => (
					<List.Item
						key={light.entity_id}
						title={friendlyName(light)}
						subtitle={light.attributes.friendly_name ? light.entity_id : undefined}
						icon={getLightIcon(light)}
						accessories={getLightAccessories(light)}
						detail={<LightDetail light={light} />}
						actions={
							<ActionPanel>
								<ActionPanel.Section title="Primary Actions">
									<Action
										title="Toggle Light"
										icon={Icon.Switch}
										onAction={() => handleLightAction(light, "toggle", "Light toggled")}
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
												{ brightnessDelta: 10 },
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
												{ brightnessDelta: -10 },
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
												queryKey: LIGHTS_QUERY_KEY,
											})
										}
										shortcut={{ modifiers: ["cmd"], key: "r" }}
									/>
								</ActionPanel.Section>
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
