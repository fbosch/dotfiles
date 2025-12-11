import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Action, ActionPanel, Grid, Icon } from "@vicinae/api";
import { useMemo, useState } from "react";
import { useDebounce } from "./hooks/useDebounce";
import { useIconData } from "./hooks/useIconData";
import { type IconEntry, useIconSearch } from "./hooks/useIconSearch";
import { type RecentIcon, useRecentIcons } from "./hooks/useRecentIcons";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			refetchOnReconnect: false,
			retry: 1,
		},
	},
});

const PACK_LABELS: Record<string, string> = {
	cod: "VS Code Codicons",
	custom: "Custom Icons",
	dev: "Devicons",
	extra: "Nerd Font Extras",
	fa: "Font Awesome",
	fae: "Font Awesome Extension",
	iec: "IEC Power",
	indent: "Indent Icons",
	indentation: "Indentation Icons",
	linux: "Linux Logos",
	md: "Material Design",
	oct: "GitHub Octicons",
	pl: "Powerline",
	ple: "Powerline Extra",
	pom: "Pomicons",
	seti: "Seti UI",
	weather: "Weather Icons",
};

function NerdFontSearchInner() {
	const [searchText, setSearchText] = useState("");
	const [selectedPack, setSelectedPack] = useState("all");

	const debouncedSearch = useDebounce(searchText, 100);

	// Use custom hooks for data management
	const { recentIcons, addRecent, clearRecent } = useRecentIcons();
	const { icons: searchResults, isLoading } = useIconSearch(
		searchText,
		selectedPack,
		debouncedSearch,
	);

	// Get icon index for pack filter options
	const shouldLoadData = debouncedSearch.length >= 3;
	const { iconIndex } = useIconData(shouldLoadData);

	// Determine which icons to display
	const displayIcons = useMemo(() => {
		if (debouncedSearch.length === 0) {
			return recentIcons as IconEntry[];
		}
		if (debouncedSearch.length < 3) {
			return [];
		}
		return searchResults;
	}, [debouncedSearch, recentIcons, searchResults]);

	// Pack filter options
	const packFilterOptions = useMemo(() => {
		if (iconIndex.length === 0) return [];

		const packOptions = iconIndex.reduce<Record<string, string>>(
			(acc, icon) => {
				if (!acc[icon.pack]) {
					acc[icon.pack] = PACK_LABELS[icon.pack] ?? icon.pack.toUpperCase();
				}
				return acc;
			},
			{},
		);

		return Object.entries(packOptions)
			.map(([value, label]) => ({ value, label }))
			.sort((a, b) => a.label.localeCompare(b.label));
	}, [iconIndex]);

	const handleCopyIcon = (icon: IconEntry) => {
		const recentIcon: RecentIcon = {
			id: icon.id,
			char: icon.char,
			code: icon.code,
			displayName: icon.displayName,
			nerdFontId: icon.nerdFontId,
			packLabel: icon.packLabel,
			iconPath: icon.iconPath,
		};
		addRecent(recentIcon);
	};

	return (
		<Grid
			columns={8}
			fit={Grid.Fit.Contain}
			aspectRatio="1"
			filtering
			isLoading={isLoading}
			onSearchTextChange={setSearchText}
			searchBarPlaceholder="Search Nerd Font icons (min 3 characters)"
			searchBarAccessory={
				<Grid.Dropdown
					tooltip="Filter by icon pack"
					storeValue
					onChange={setSelectedPack}
					value={selectedPack}
				>
					<Grid.Dropdown.Item title="All icon packs" value="all" />
					{packFilterOptions.map((option) => (
						<Grid.Dropdown.Item
							key={option.value}
							title={option.label}
							value={option.value}
						/>
					))}
				</Grid.Dropdown>
			}
		>
			{displayIcons.length === 0 ? (
				<Grid.EmptyView
					title={
						debouncedSearch.length > 0 && debouncedSearch.length < 3
							? "Keep typing..."
							: debouncedSearch.length >= 3
								? "No icons found"
								: "Start searching"
					}
					description={
						debouncedSearch.length > 0 && debouncedSearch.length < 3
							? "Enter at least 3 characters to search"
							: debouncedSearch.length >= 3
								? "Try a different search term or pick another icon pack"
								: recentIcons.length > 0
									? "Your recently copied icons will appear here"
									: "Enter at least 3 characters to search for icons"
					}
					icon={Icon.MagnifyingGlass}
				/>
			) : (
				<Grid.Section
					title={
						debouncedSearch.length === 0 && recentIcons.length > 0
							? "Recently Copied"
							: selectedPack === "all"
								? "All icon packs"
								: (PACK_LABELS[selectedPack] ?? selectedPack.toUpperCase())
					}
					subtitle={`${displayIcons.length.toLocaleString()} icons`}
				>
					{displayIcons.map((icon) => (
						<Grid.Item
							key={icon.id}
							id={icon.id}
							content={icon.iconPath}
							title={icon.displayName}
							subtitle={icon.nerdFontId}
							keywords={icon.keywords || []}
							actions={
								<IconActions
									icon={icon}
									onCopy={() => handleCopyIcon(icon)}
									onClearRecent={
										recentIcons.length > 0 ? clearRecent : undefined
									}
								/>
							}
						/>
					))}
				</Grid.Section>
			)}
		</Grid>
	);
}

function IconActions({
	icon,
	onCopy,
	onClearRecent,
}: {
	icon: IconEntry;
	onCopy: () => void;
	onClearRecent?: () => void;
}) {
	return (
		<ActionPanel>
			<ActionPanel.Section>
				<Action.CopyToClipboard
					title="Copy glyph"
					content={icon.char}
					icon={Icon.CopyClipboard}
					onCopy={onCopy}
				/>
				<Action.CopyToClipboard
					title="Copy Nerd Font name"
					content={icon.nerdFontId}
					icon={Icon.Hashtag}
					onCopy={onCopy}
				/>
				<Action.CopyToClipboard
					title="Copy identifier"
					content={icon.id}
					icon={Icon.Document}
					onCopy={onCopy}
				/>
				<Action.CopyToClipboard
					title="Copy Unicode codepoint"
					content={icon.hexCode}
					icon={Icon.Terminal}
					onCopy={onCopy}
				/>
				<Action.CopyToClipboard
					title="Copy HTML entity"
					content={icon.htmlEntity}
					icon={Icon.Globe}
					onCopy={onCopy}
				/>
			</ActionPanel.Section>
			{onClearRecent && (
				<ActionPanel.Section title="Recent Icons">
					<Action
						title="Clear Recently Copied Icons"
						icon={Icon.Trash}
						shortcut={{ modifiers: ["cmd", "shift"], key: "delete" }}
						onAction={onClearRecent}
					/>
				</ActionPanel.Section>
			)}
		</ActionPanel>
	);
}

export default function NerdFontSearch() {
	return (
		<QueryClientProvider client={queryClient}>
			<NerdFontSearchInner />
		</QueryClientProvider>
	);
}
