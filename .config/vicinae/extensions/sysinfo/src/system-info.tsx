import {
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
import {
	Action,
	ActionPanel,
	Clipboard,
	Detail,
	environment,
	getPreferenceValues,
	Icon,
	showToast,
	Toast,
} from "@vicinae/api";
import { useMemo } from "react";
import { getDynamicSystemInfo, getStaticSystemInfo } from "./aggregators";
import {
	getCachedStaticInfo,
	STORAGE_CATEGORIES_CACHE_DURATION,
} from "./cache";
import { analyzeStorageCategories } from "./storage-analyzer";
import { generateSystemInfoSVG, svgToDataUri } from "./svg-generator";
import type { Preferences } from "./types";
import { execAsync } from "./utils";

// Cache tool availability to avoid repeated "which" command execution
const toolCache = new Map<string, boolean>();

async function checkToolAvailability(toolName: string): Promise<boolean> {
	if (toolCache.has(toolName)) {
		return toolCache.get(toolName)!;
	}
	try {
		await execAsync(`which ${toolName}`);
		toolCache.set(toolName, true);
		return true;
	} catch {
		toolCache.set(toolName, false);
		return false;
	}
}

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
			// Prevent concurrent fetches - only one query at a time per key
			refetchInterval: false, // Disable automatic refetch by default
			staleTime: 5000, // Consider data fresh for 5 seconds
		},
	},
});

function SystemInfoContent() {
	const preferences = getPreferenceValues<Preferences>();
	// Memoize refresh interval parsing to avoid repeated Number.parseInt() calls
	const refreshInterval = useMemo(
		() => Number.parseInt(preferences.refreshInterval, 10),
		[preferences.refreshInterval],
	);

	// Static system info - load from cache first, then refresh in background
	const { data: staticInfo } = useQuery({
		queryKey: ["system-info-static"],
		queryFn: getStaticSystemInfo,
		staleTime: 60 * 60 * 1000, // 1 hour in react-query cache
		initialData: () => getCachedStaticInfo() || undefined, // Load from persistent cache immediately
		throwOnError: (error) => {
			showToast({
				style: Toast.Style.Failure,
				title: "Failed to load system info",
				message: error instanceof Error ? error.message : "Unknown error",
			});
			return false;
		},
	});

	// Dynamic system info - refreshed frequently (memory, storage usage)
	// React Query prevents concurrent fetches automatically
	const { data: dynamicInfo, refetch: refetchDynamic } = useQuery({
		queryKey: ["system-info-dynamic"],
		queryFn: getDynamicSystemInfo,
		staleTime: 5000, // 5 seconds - prevents unnecessary refetches
		enabled: !!staticInfo, // Only fetch dynamic info after static info is loaded
		refetchInterval: refreshInterval > 0 ? refreshInterval : false, // Auto-refresh based on preference
		refetchIntervalInBackground: false, // Don't refetch when window is not focused
		refetchOnMount: false, // Don't refetch on remount if data is fresh
		throwOnError: (error) => {
			showToast({
				style: Toast.Style.Failure,
				title: "Failed to load usage data",
				message: error instanceof Error ? error.message : "Unknown error",
			});
			return false;
		},
	});

	// Progressive enhancement: Load storage categories after initial data is loaded
	// This query is throttled to prevent memory issues from running du commands
	const { data: enrichedStorage } = useQuery({
		queryKey: ["storage-categories", dynamicInfo?.storage],
		queryFn: async () => {
			if (!dynamicInfo?.storage) return undefined;

			// Enrich each storage device with categories
			return await Promise.all(
				dynamicInfo.storage.map(async (device) => {
					// Only analyze / mount point
					if (device.mountPoint !== "/") {
						return device;
					}

					// Get categories (from cache or analyze)
					const categories = await analyzeStorageCategories(
						device.mountPoint,
						device.used,
					);
					return {
						...device,
						categories: categories.length > 0 ? categories : undefined,
					};
				}),
			);
		},
		enabled: !!dynamicInfo?.storage && dynamicInfo.storage.length > 0,
		staleTime: STORAGE_CATEGORIES_CACHE_DURATION, // Use cache for 10 minutes
		refetchOnMount: false, // Don't refetch on remount
		refetchOnWindowFocus: false, // Don't refetch on window focus
		refetchOnReconnect: false, // Don't refetch on reconnect
	});

	// Use enriched storage if available, fallback to basic storage
	// Memoize to prevent unnecessary object recreation
	const displayDynamicInfo = useMemo(
		() =>
			enrichedStorage && dynamicInfo
				? {
						...dynamicInfo,
						storage: enrichedStorage,
					}
				: dynamicInfo,
		[enrichedStorage, dynamicInfo],
	);

	// Combine static and dynamic info for SVG generation
	// Memoize to prevent unnecessary object recreation
	const combinedInfo = useMemo(() => {
		if (!staticInfo || !dynamicInfo) {
			return null;
		}
		if (!displayDynamicInfo) {
			return {
				...staticInfo,
				memory: dynamicInfo.memory,
				swap: dynamicInfo.swap,
				storage: dynamicInfo.storage,
				os: {
					...staticInfo.os,
					uptime: dynamicInfo.uptime,
				},
			};
		}
		return {
			...staticInfo,
			memory: displayDynamicInfo.memory,
			swap: displayDynamicInfo.swap,
			storage: displayDynamicInfo.storage,
			os: {
				...staticInfo.os,
				uptime: displayDynamicInfo.uptime,
			},
		};
	}, [staticInfo, dynamicInfo, displayDynamicInfo]);

	// Generate SVG with current theme appearance and convert to data URI
	// Memoize expensive SVG generation to prevent unnecessary recalculation
	const markdown = useMemo(() => {
		if (!combinedInfo) return "";
		const svg = generateSystemInfoSVG(combinedInfo, environment.appearance);
		const dataUri = svgToDataUri(svg);
		return `![System Information](${dataUri})`;
	}, [combinedInfo, environment.appearance]);

	// If we don't have static or dynamic info yet, show loading state
	if (!staticInfo || !dynamicInfo) {
		return <Detail markdown="" />;
	}

	return (
		<Detail
			markdown={markdown}
			metadata={
				<Detail.Metadata>
					<Detail.Metadata.Label title="Hostname" text={staticInfo.hostname} />
					{staticInfo.model && (
						<Detail.Metadata.Label title="Model" text={staticInfo.model} />
					)}
					<Detail.Metadata.Separator />
					<Detail.Metadata.Label
						title="Processor"
						text={staticInfo.cpu.name}
						icon={Icon.ComputerChip}
					/>
					<Detail.Metadata.Label
						title="Cores"
						text={`${staticInfo.cpu.cores}C / ${staticInfo.cpu.threads}T`}
					/>
					{staticInfo.gpu && (
						<>
							<Detail.Metadata.Separator />
							<Detail.Metadata.Label
								title="Graphics"
								text={staticInfo.gpu.name}
								icon={Icon.Desktop}
							/>
						</>
					)}
					{staticInfo.displays && staticInfo.displays.length > 0 && (
						<>
							<Detail.Metadata.Separator />
							{staticInfo.displays.map((display, index) => (
								<Detail.Metadata.Label
									key={index}
									title={index === 0 ? "Display" : `Display ${index + 1}`}
									text={`${display.resolution}${display.refreshRate ? ` @ ${display.refreshRate.toFixed(0)}Hz` : ""}`}
									icon={index === 0 ? Icon.Monitor : undefined}
								/>
							))}
						</>
					)}
					<Detail.Metadata.Separator />
					<Detail.Metadata.Label
						title="Kernel"
						text={staticInfo.os.kernel}
						icon={Icon.Terminal}
					/>
					<Detail.Metadata.Label
						title="Architecture"
						text={staticInfo.os.architecture}
					/>
				</Detail.Metadata>
			}
			actions={
				<ActionPanel>
					<Action
						title="Refresh"
						icon={Icon.ArrowClockwise}
						onAction={() => refetchDynamic()}
						shortcut={{ modifiers: ["cmd"], key: "r" }}
					/>
					<ActionPanel.Section title="Launch">
						<Action
							title="Open System Monitor"
							icon={Icon.LineChart}
							onAction={async () => {
								try {
									// Check all available tools in parallel (cached)
									const [hasMissionCenter, hasBtop, hasHtop] =
										await Promise.all([
											checkToolAvailability("missioncenter"),
											checkToolAvailability("btop"),
											checkToolAvailability("htop"),
										]);

									// Launch the first available tool
									if (hasMissionCenter) {
										await execAsync("missioncenter &");
									} else if (hasBtop) {
										await execAsync("foot btop &");
									} else if (hasHtop) {
										await execAsync("foot htop &");
									} else {
										throw new Error(
											"No system monitor found (tried missioncenter, btop, htop)",
										);
									}

									await showToast({
										style: Toast.Style.Success,
										title: "Launched System Monitor",
									});
								} catch (error) {
									await showToast({
										style: Toast.Style.Failure,
										title: "Failed to open system monitor",
										message:
											error instanceof Error ? error.message : "Unknown error",
									});
								}
							}}
							shortcut={{ modifiers: ["cmd"], key: "m" }}
						/>
						<Action
							title="Open Disk Usage Analyzer"
							icon={Icon.HardDrive}
							onAction={async () => {
								try {
									// Check all available tools in parallel (cached)
									const [hasBaobab, hasNcdu] = await Promise.all([
										checkToolAvailability("baobab"),
										checkToolAvailability("ncdu"),
									]);

									// Launch the first available tool
									if (hasBaobab) {
										await execAsync("baobab &");
									} else if (hasNcdu) {
										await execAsync("foot ncdu / &");
									} else {
										throw new Error(
											"No disk analyzer found (tried baobab, ncdu)",
										);
									}

									await showToast({
										style: Toast.Style.Success,
										title: "Launched Disk Usage Analyzer",
									});
								} catch (error) {
									await showToast({
										style: Toast.Style.Failure,
										title: "Failed to open disk analyzer",
										message:
											error instanceof Error ? error.message : "Unknown error",
									});
								}
							}}
							shortcut={{ modifiers: ["cmd"], key: "d" }}
						/>
					</ActionPanel.Section>
					<ActionPanel.Section title="Copy">
						<Action
							title="Copy Hostname"
							icon={Icon.Clipboard}
							onAction={async () => {
								await Clipboard.copy(staticInfo.hostname);
								await showToast({
									style: Toast.Style.Success,
									title: "Copied Hostname",
									message: staticInfo.hostname,
								});
							}}
							shortcut={{ modifiers: ["cmd"], key: "c" }}
						/>
						<Action
							title="Copy OS Info"
							icon={Icon.Clipboard}
							onAction={async () => {
								const text = `${staticInfo.os.name} ${staticInfo.os.version} (${staticInfo.os.kernel})`;
								await Clipboard.copy(text);
								await showToast({
									style: Toast.Style.Success,
									title: "Copied OS Info",
									message: text,
								});
							}}
							shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
						/>
						<Action.CopyToClipboard
							title="Copy All Info"
							content={markdown}
							shortcut={{ modifiers: ["cmd", "shift"], key: "a" }}
						/>
					</ActionPanel.Section>
				</ActionPanel>
			}
		/>
	);
}

export default function SystemInfoCommand() {
	return (
		<QueryClientProvider client={queryClient}>
			<SystemInfoContent />
		</QueryClientProvider>
	);
}
