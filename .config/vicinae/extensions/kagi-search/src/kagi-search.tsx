import {
	keepPreviousData,
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
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
import { useEffect, useState } from "react";
import { searchKagi } from "./api";
import type { KagiSearchResult } from "./types";

const SEARCH_DEBOUNCE_MS = 500;

/**
 * Detect if query contains a Kagi bang and extract the bang + query
 * Bangs can appear at start, end, or middle of query
 * Examples: "!g react hooks", "react hooks !g", "react !g hooks"
 */
function detectBang(query: string): { bang: string; cleanQuery: string } | null {
	const trimmed = query.trim();
	// Match bang pattern: ! followed by letters/numbers
	const bangPattern = /(![\w]+)/;
	const match = trimmed.match(bangPattern);
	
	if (match) {
		const bang = match[1];
		// Remove the bang from the query to get clean search terms
		const cleanQuery = trimmed.replace(bang, "").trim();
		return { bang, cleanQuery };
	}
	
	return null;
}

/**
 * Get the redirect URL for a Kagi bang
 * Kagi processes bangs server-side, so we construct the Kagi search URL
 * and let Kagi handle the redirect
 */
function getBangRedirectUrl(bang: string, query: string): string {
	const encoded = encodeURIComponent(`${bang} ${query}`);
	return `https://kagi.com/search?q=${encoded}`;
}

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 5 * 60 * 1000, // 5 minutes
			refetchOnWindowFocus: false,
			retry: 1,
		},
	},
});

function useDebounce<T>(value: T, delay: number): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const id = setTimeout(() => setDebounced(value), delay);
		return () => clearTimeout(id);
	}, [value, delay]);
	return debounced;
}

function ResultListItem({ result }: { result: KagiSearchResult }) {
	// Extract hostname for favicon
	const hostname = new URL(result.url).hostname;
	// Use DuckDuckGo's favicon service (more privacy-friendly than Google)
	const faviconUrl = `https://icons.duckduckgo.com/ip3/${hostname}.ico`;

	return (
		<List.Item
			key={result.url}
			title={result.title}
			subtitle={result.snippet}
			icon={faviconUrl}
			accessories={[{ text: hostname }]}
			actions={
				<ActionPanel>
					<Action.OpenInBrowser
						title="Open in Browser"
						url={result.url}
						onOpen={async () => {
							await showToast({
								style: Toast.Style.Success,
								title: "Opening in browser",
								message: result.title,
							});
							await closeMainWindow();
						}}
					/>
					<ActionPanel.Section>
						<Action.CopyToClipboard
							title="Copy URL"
							content={result.url}
							shortcut={{ modifiers: ["cmd"], key: "c" }}
						/>
						<Action.CopyToClipboard
							title="Copy Title"
							content={result.title}
							shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
						/>
					</ActionPanel.Section>
				</ActionPanel>
			}
		/>
	);
}

function KagiSearchContent() {
	const [searchText, setSearchText] = useState("");
	const debouncedSearch = useDebounce(searchText, SEARCH_DEBOUNCE_MS);
	const preferences = getPreferenceValues<Preferences>();

	// Validate session token exists
	useEffect(() => {
		if (!preferences.sessionToken) {
			showToast({
				style: Toast.Style.Failure,
				title: "Missing session token",
				message: "Please configure your Kagi session token in settings",
			});
		}
	}, [preferences.sessionToken]);

	// Detect bang in search query
	const bangDetection = detectBang(debouncedSearch);
	const hasBang = bangDetection !== null;

	// Search query
	const {
		data: searchResults,
		isLoading,
		isError,
		error,
	} = useQuery({
		queryKey: ["kagi-search", debouncedSearch],
		queryFn: () => searchKagi(debouncedSearch, preferences.sessionToken),
		enabled:
			debouncedSearch.trim().length > 0 && 
			!!preferences.sessionToken &&
			!hasBang, // Don't search if there's a bang - we'll redirect instead
		placeholderData: keepPreviousData,
	});

	// Handle errors with useEffect (React Query v5 pattern)
	useEffect(() => {
		if (isError && error) {
			console.error("[Kagi Search] Error:", error);
			showToast({
				style: Toast.Style.Failure,
				title: "Search failed",
				message: error instanceof Error ? error.message : "Unknown error",
			});
		}
	}, [isError, error]);

	const showingSearch = debouncedSearch.trim().length > 0;
	const results = searchResults?.results || [];
	const relatedSearches = searchResults?.relatedSearches || [];

	return (
		<List
			isLoading={isLoading}
			searchBarPlaceholder="Search Kagi..."
			onSearchTextChange={setSearchText}
			searchText={searchText}
		>
			{!showingSearch ? (
				<List.EmptyView
					title="Search Kagi"
					description="Type to search the web with Kagi"
					icon={Icon.MagnifyingGlass}
				/>
			) : hasBang ? (
				// Show bang redirect option
				<List.Item
					title={`${bangDetection.bang} ${bangDetection.cleanQuery}`}
					subtitle={`Open in browser with Kagi bang`}
					icon={Icon.ArrowRight}
					accessories={[{ text: "Press Enter to redirect" }]}
					actions={
						<ActionPanel>
							<Action.OpenInBrowser
								title="Open Bang in Browser"
								url={getBangRedirectUrl(bangDetection.bang, bangDetection.cleanQuery)}
								onOpen={async () => {
									await showToast({
										style: Toast.Style.Success,
										title: "Redirecting",
										message: `Opening ${bangDetection.bang} search`,
									});
									await closeMainWindow();
								}}
							/>
						</ActionPanel>
					}
				/>
			) : results.length === 0 && !isLoading ? (
				<List.EmptyView
					title="No results found"
					description="Try different search terms"
					icon={Icon.XMarkCircle}
				/>
			) : (
				<>
					{results.length > 0 && (
						<List.Section
							title={`${results.length} Result${results.length !== 1 ? "s" : ""}`}
						>
							{results.map((result) => (
								<ResultListItem key={result.url} result={result} />
							))}
						</List.Section>
					)}

					{relatedSearches.length > 0 && (
						<List.Section title="Related Searches">
							{relatedSearches.map((search) => (
								<List.Item
									key={search}
									title={search}
									icon={Icon.MagnifyingGlass}
									actions={
										<ActionPanel>
											<Action
												title="Search"
												onAction={() => setSearchText(search)}
												icon={Icon.MagnifyingGlass}
											/>
										</ActionPanel>
									}
								/>
							))}
						</List.Section>
					)}
				</>
			)}
		</List>
	);
}

export default function KagiSearch() {
	return (
		<QueryClientProvider client={queryClient}>
			<KagiSearchContent />
		</QueryClientProvider>
	);
}
