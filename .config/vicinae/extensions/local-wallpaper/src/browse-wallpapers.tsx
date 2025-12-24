import {
	Action,
	ActionPanel,
	Alert,
	Application,
	confirmAlert,
	Grid,
	getPreferenceValues,
	Icon,
	showToast,
	Toast,
} from "@vicinae/api";
import { useEffect, useState } from "react";
import type { LocalWallpaper, Monitor, Preferences, FillMode } from "./types";
import { expandPath, formatFileSize, scanWallpapers } from "./utils/filesystem";
import { setWallpaper } from "./utils/hyprpaper";
import {
	getConnectedMonitors,
	formatMonitorName,
} from "./utils/monitors";

export default function BrowseWallpapers() {
	const preferences = getPreferenceValues<Preferences>();
	const [wallpapers, setWallpapers] = useState<LocalWallpaper[]>([]);
	const [monitors, setMonitors] = useState<Monitor[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [searchText, setSearchText] = useState("");

	// Load wallpapers and monitors on mount
	useEffect(() => {
		loadWallpapers();
		loadMonitors();
	}, []);

	const loadMonitors = async () => {
		try {
			const connectedMonitors = await getConnectedMonitors();
			setMonitors(connectedMonitors);
		} catch (error) {
			console.error("Failed to load monitors:", error);
			// Continue without monitor info
			setMonitors([]);
		}
	};

	const loadWallpapers = async () => {
		setIsLoading(true);
		try {
			const extensions = preferences.fileExtensions
				.split(",")
				.map((ext) => ext.trim().toLowerCase());

			const scanned = await scanWallpapers(
				preferences.wallpapersDirectory,
				extensions,
				preferences.sortBy as any,
			);

			setWallpapers(scanned);
		} catch (error) {
			await showToast({
				style: Toast.Style.Failure,
				title: "Failed to load wallpapers",
				message: error instanceof Error ? error.message : "Unknown error",
			});
			setWallpapers([]);
		} finally {
			setIsLoading(false);
		}
	};

	const handleSetWallpaper = async (
		wallpaper: LocalWallpaper,
		monitor?: string,
		fillMode: FillMode = "cover",
	) => {
		await setWallpaper(
			wallpaper.absolutePath,
			preferences.hyprpaperConfigPath,
			monitor,
			fillMode,
		);
	};

	const handleOpenInViewer = async (wallpaper: LocalWallpaper) => {
		try {
			await Application.open(wallpaper.absolutePath);
		} catch (error) {
			await showToast({
				style: Toast.Style.Failure,
				title: "Failed to open image",
				message: error instanceof Error ? error.message : "Unknown error",
			});
		}
	};

	const handleDeleteWallpaper = async (wallpaper: LocalWallpaper) => {
		const confirmed = await confirmAlert({
			title: "Delete Wallpaper",
			message: `Are you sure you want to delete "${wallpaper.path}"? This action cannot be undone.`,
			primaryAction: {
				title: "Delete",
				style: Alert.ActionStyle.Destructive,
			},
		});

		if (!confirmed) {
			return;
		}

		try {
			const fs = await import("node:fs/promises");
			await fs.unlink(wallpaper.absolutePath);

			await showToast({
				style: Toast.Style.Success,
				title: "Wallpaper deleted",
				message: wallpaper.path,
			});

			// Reload wallpapers list
			await loadWallpapers();
		} catch (error) {
			await showToast({
				style: Toast.Style.Failure,
				title: "Failed to delete wallpaper",
				message: error instanceof Error ? error.message : "Unknown error",
			});
		}
	};

	// Filter wallpapers based on search text
	const filteredWallpapers = wallpapers.filter((wallpaper) =>
		wallpaper.name.toLowerCase().includes(searchText.toLowerCase()),
	);

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
					tooltip="Sort By"
					storeValue
					onChange={async (newValue) => {
						setIsLoading(true);
						try {
							const extensions = preferences.fileExtensions
								.split(",")
								.map((ext) => ext.trim().toLowerCase());

							const scanned = await scanWallpapers(
								preferences.wallpapersDirectory,
								extensions,
								newValue as any,
							);

							setWallpapers(scanned);
						} catch (error) {
							await showToast({
								style: Toast.Style.Failure,
								title: "Failed to reload wallpapers",
								message:
									error instanceof Error ? error.message : "Unknown error",
							});
						} finally {
							setIsLoading(false);
						}
					}}
					defaultValue={preferences.sortBy}
				>
					<Grid.Dropdown.Item title="Name (A-Z)" value="name" />
					<Grid.Dropdown.Item
						title="Date Modified (Newest)"
						value="modified-desc"
					/>
					<Grid.Dropdown.Item
						title="Date Modified (Oldest)"
						value="modified-asc"
					/>
					<Grid.Dropdown.Item title="Size (Largest)" value="size-desc" />
					<Grid.Dropdown.Item title="Size (Smallest)" value="size-asc" />
				</Grid.Dropdown>
			}
		>
			<Grid.Section
				title="Wallpapers"
				subtitle={`${filteredWallpapers.length} wallpaper${filteredWallpapers.length !== 1 ? "s" : ""} · ${expandPath(preferences.wallpapersDirectory)}`}
			>
				{filteredWallpapers.map((wallpaper, index) => (
					<Grid.Item
						key={wallpaper.id}
						id={`wallpaper-${index}`}
						content={`file://${wallpaper.absolutePath}`}
						title={wallpaper.name}
						subtitle={`${formatFileSize(wallpaper.size)} · ${wallpaper.extension.toUpperCase()}`}
						actions={
							<ActionPanel>
								{monitors.length > 1 ? (
									<ActionPanel.Submenu
										title="Set as Wallpaper"
										icon={Icon.Desktop}
										shortcut={{ modifiers: ["cmd"], key: "s" }}
									>
										<ActionPanel.Submenu
											title="All Monitors"
											icon={Icon.Monitor}
										>
											<Action
												title="Cover (default)"
												onAction={() =>
													handleSetWallpaper(wallpaper, undefined, "cover")
												}
											/>
											<Action
												title="Contain"
												onAction={() =>
													handleSetWallpaper(wallpaper, undefined, "contain")
												}
											/>
											<Action
												title="Tile"
												onAction={() =>
													handleSetWallpaper(wallpaper, undefined, "tile")
												}
											/>
											<Action
												title="Fill"
												onAction={() =>
													handleSetWallpaper(wallpaper, undefined, "fill")
												}
											/>
										</ActionPanel.Submenu>
										<ActionPanel.Section title="Individual Monitors">
											{monitors.map((monitor) => (
												<ActionPanel.Submenu
													key={monitor.name}
													title={formatMonitorName(monitor)}
													icon={Icon.Monitor}
												>
													<Action
														title="Cover (default)"
														onAction={() =>
															handleSetWallpaper(
																wallpaper,
																monitor.name,
																"cover",
															)
														}
													/>
													<Action
														title="Contain"
														onAction={() =>
															handleSetWallpaper(
																wallpaper,
																monitor.name,
																"contain",
															)
														}
													/>
													<Action
														title="Tile"
														onAction={() =>
															handleSetWallpaper(wallpaper, monitor.name, "tile")
														}
													/>
													<Action
														title="Fill"
														onAction={() =>
															handleSetWallpaper(wallpaper, monitor.name, "fill")
														}
													/>
												</ActionPanel.Submenu>
											))}
										</ActionPanel.Section>
									</ActionPanel.Submenu>
								) : (
									<ActionPanel.Submenu
										title="Set as Wallpaper"
										icon={Icon.Desktop}
										shortcut={{ modifiers: ["cmd"], key: "s" }}
									>
										<Action
											title="Cover (default)"
											onAction={() => handleSetWallpaper(wallpaper, undefined, "cover")}
										/>
										<Action
											title="Contain"
											onAction={() =>
												handleSetWallpaper(wallpaper, undefined, "contain")
											}
										/>
										<Action
											title="Tile"
											onAction={() => handleSetWallpaper(wallpaper, undefined, "tile")}
										/>
										<Action
											title="Fill"
											onAction={() => handleSetWallpaper(wallpaper, undefined, "fill")}
										/>
									</ActionPanel.Submenu>
								)}
								<Action
									title="Open in Image Viewer"
									icon={Icon.Eye}
									onAction={() => handleOpenInViewer(wallpaper)}
									shortcut={{ modifiers: ["cmd"], key: "o" }}
								/>
								<ActionPanel.Section>
									<Action.CopyToClipboard
										title="Copy File Path"
										content={wallpaper.absolutePath}
									/>
									<Action
										title="Refresh Wallpapers"
										icon={Icon.ArrowClockwise}
										onAction={loadWallpapers}
										shortcut={{ modifiers: ["cmd"], key: "r" }}
									/>
								</ActionPanel.Section>
								<ActionPanel.Section>
									<Action
										title="Delete Wallpaper"
										icon={Icon.Trash}
										style={Action.Style.Destructive}
										onAction={() => handleDeleteWallpaper(wallpaper)}
										shortcut={{ modifiers: ["ctrl"], key: "x" }}
									/>
								</ActionPanel.Section>
							</ActionPanel>
						}
					/>
				))}
			</Grid.Section>
		</Grid>
	);
}
