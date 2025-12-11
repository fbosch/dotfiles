import { exec } from "node:child_process";
import { promisify } from "node:util";
import {
	Action,
	ActionPanel,
	closeMainWindow,
	getPreferenceValues,
	Icon,
	List,
	showToast,
	Toast,
} from "@vicinae/api";
import { useEffect, useMemo, useState } from "react";
import {
	filterDirectories,
	getAllDirectories,
	getFileManagerCommand,
} from "./filesystem";
import type { DirectoryEntry, Preferences } from "./types";

const execAsync = promisify(exec);

function getDirectoryIcon(dir: DirectoryEntry): Icon {
	if (!dir.exists) return Icon.XmarkCircle;
	if (dir.isHidden) return Icon.EyeSlash;

	// Common directory icons based on name
	const name = dir.name.toLowerCase();
	if (name === "downloads") return Icon.Download;
	if (name === "documents") return Icon.Document;
	if (name === "pictures" || name === "photos") return Icon.Image;
	if (name === "videos" || name === "movies") return Icon.Video;
	if (name === "music") return Icon.Music;
	if (name === "desktop") return Icon.Desktop;
	if (name === "projects" || name === "code" || name === "dev")
		return Icon.Code;
	if (name.includes("git") || name === ".git") return Icon.Terminal;

	return dir.isSubdirectory ? Icon.Folder : Icon.HardDrive;
}

function FavoriteDirectoriesContent() {
	const preferences = getPreferenceValues<Preferences>();
	const [isLoading, setIsLoading] = useState(true);
	const [directories, setDirectories] = useState<DirectoryEntry[]>([]);
	const [searchText, setSearchText] = useState("");

	// Load directories on mount
	useEffect(() => {
		async function loadDirectories() {
			try {
				setIsLoading(true);
				const dirs = await getAllDirectories(
					preferences.favoriteDirectories,
					preferences.includeSubdirectories,
					preferences.showHiddenFiles,
				);
				setDirectories(dirs);
			} catch (error) {
				showToast({
					style: Toast.Style.Failure,
					title: "Failed to load directories",
					message: error instanceof Error ? error.message : "Unknown error",
				});
			} finally {
				setIsLoading(false);
			}
		}

		loadDirectories();
	}, [
		preferences.favoriteDirectories,
		preferences.includeSubdirectories,
		preferences.showHiddenFiles,
	]);

	// Filter directories based on search
	const filteredDirectories = useMemo(() => {
		return filterDirectories(directories, searchText);
	}, [directories, searchText]);

	// Group directories by parent
	const { favorites, subdirectories } = useMemo(() => {
		const favs: DirectoryEntry[] = [];
		const subs: DirectoryEntry[] = [];

		filteredDirectories.forEach((dir) => {
			if (dir.isSubdirectory) {
				subs.push(dir);
			} else {
				favs.push(dir);
			}
		});

		return { favorites: favs, subdirectories: subs };
	}, [filteredDirectories]);

	async function openInFileManager(dir: DirectoryEntry) {
		if (!dir.exists) {
			showToast({
				style: Toast.Style.Failure,
				title: "Directory does not exist",
				message: dir.absolutePath,
			});
			return;
		}

		try {
			const fileManager = await getFileManagerCommand(preferences.fileManager);
			await execAsync(`${fileManager} "${dir.absolutePath}"`);
			await closeMainWindow();
		} catch (error) {
			showToast({
				style: Toast.Style.Failure,
				title: "Failed to open directory",
				message: error instanceof Error ? error.message : "Unknown error",
			});
		}
	}

	async function openInTerminal(dir: DirectoryEntry) {
		if (!dir.exists) {
			showToast({
				style: Toast.Style.Failure,
				title: "Directory does not exist",
				message: dir.absolutePath,
			});
			return;
		}

		try {
			// Try common terminal emulators
			const terminals = [
				{ cmd: "foot", args: "-D" },
				{ cmd: "kitty", args: "--directory" },
				{ cmd: "alacritty", args: "--working-directory" },
				{ cmd: "wezterm", args: "start --cwd" },
				{ cmd: "gnome-terminal", args: "--working-directory" },
				{ cmd: "konsole", args: "--workdir" },
				{ cmd: "xterm", args: "-e 'cd" },
			];

			for (const terminal of terminals) {
				try {
					if (terminal.cmd === "xterm") {
						await execAsync(
							`${terminal.cmd} ${terminal.args} ${dir.absolutePath} && $SHELL'`,
						);
					} else {
						await execAsync(
							`${terminal.cmd} ${terminal.args} "${dir.absolutePath}"`,
						);
					}
					await closeMainWindow();
					return;
				} catch {}
			}

			showToast({
				style: Toast.Style.Failure,
				title: "No terminal emulator found",
				message: "Please install foot, kitty, alacritty, or gnome-terminal",
			});
		} catch (error) {
			showToast({
				style: Toast.Style.Failure,
				title: "Failed to open terminal",
				message: error instanceof Error ? error.message : "Unknown error",
			});
		}
	}

	function renderDirectoryItem(dir: DirectoryEntry) {
		const accessories: List.Item.Accessory[] = [];

		if (!dir.exists) {
			accessories.push({ icon: Icon.XmarkCircle, tooltip: "Does not exist" });
		}

		if (dir.isSubdirectory && dir.parentPath) {
			accessories.push({ text: dir.parentPath, tooltip: "Parent directory" });
		}

		return (
			<List.Item
				key={dir.id}
				title={dir.name}
				subtitle={dir.absolutePath}
				icon={getDirectoryIcon(dir)}
				accessories={accessories}
				actions={
					<ActionPanel>
						<ActionPanel.Section title="Navigation">
							<Action
								title="Open in File Manager"
								icon={Icon.Finder}
								onAction={() => openInFileManager(dir)}
							/>
							<Action
								title="Open in Terminal"
								icon={Icon.Terminal}
								shortcut={{ modifiers: ["cmd"], key: "t" }}
								onAction={() => openInTerminal(dir)}
							/>
						</ActionPanel.Section>
						<ActionPanel.Section title="Copy">
							<Action.CopyToClipboard
								title="Copy Path"
								content={dir.path}
								shortcut={{ modifiers: ["cmd"], key: "c" }}
							/>
							<Action.CopyToClipboard
								title="Copy Absolute Path"
								content={dir.absolutePath}
								shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
							/>
						</ActionPanel.Section>
						{dir.exists && (
							<ActionPanel.Section title="Reveal">
								<Action
									title="Show in Parent Directory"
									icon={Icon.ArrowUp}
									shortcut={{ modifiers: ["cmd"], key: "e" }}
									onAction={async () => {
										try {
											const fileManager = await getFileManagerCommand(
												preferences.fileManager,
											);
											// Most file managers support showing a file/directory
											await execAsync(`${fileManager} "${dir.absolutePath}"`);
											await closeMainWindow();
										} catch (error) {
											showToast({
												style: Toast.Style.Failure,
												title: "Failed to show in parent",
												message:
													error instanceof Error
														? error.message
														: "Unknown error",
											});
										}
									}}
								/>
							</ActionPanel.Section>
						)}
					</ActionPanel>
				}
			/>
		);
	}

	return (
		<List
			isLoading={isLoading}
			searchBarPlaceholder="Search favorite directories..."
			onSearchTextChange={setSearchText}
			filtering={false}
		>
			{filteredDirectories.length === 0 && !isLoading ? (
				<List.EmptyView
					title={
						searchText ? "No directories found" : "No favorite directories"
					}
					description={
						searchText
							? "Try a different search term"
							: "Add directories in extension preferences"
					}
					icon={Icon.Folder}
				/>
			) : (
				<>
					{favorites.length > 0 && (
						<List.Section
							title="Favorite Directories"
							subtitle={`${favorites.length} ${favorites.length === 1 ? "directory" : "directories"}`}
						>
							{favorites.map(renderDirectoryItem)}
						</List.Section>
					)}
					{subdirectories.length > 0 && (
						<List.Section
							title="Subdirectories"
							subtitle={`${subdirectories.length} ${subdirectories.length === 1 ? "directory" : "directories"}`}
						>
							{subdirectories.map(renderDirectoryItem)}
						</List.Section>
					)}
				</>
			)}
		</List>
	);
}

export default function FavoriteDirectories() {
	return <FavoriteDirectoriesContent />;
}
