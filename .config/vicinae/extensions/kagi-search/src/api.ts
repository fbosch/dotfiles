import * as cheerio from "cheerio";
import type { KagiSearchResponse } from "./types";

const KAGI_SEARCH_URL = "https://kagi.com/html/search";
const USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Extract token from either a full URL or just the token string
 */
function extractToken(input: string): string {
	const trimmed = input.trim();
	
	// Check if it's a URL
	if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
		try {
			const url = new URL(trimmed);
			const token = url.searchParams.get("token");
			if (token) {
				return token;
			}
		} catch {
			// Invalid URL, treat as token
		}
	}
	
	// Return as-is (assumed to be token)
	return trimmed;
}

/**
 * Search Kagi using session token authentication
 */
export async function searchKagi(
	query: string,
	tokenInput: string,
): Promise<KagiSearchResponse> {
	const trimmed = query.trim();
	if (!trimmed) {
		throw new Error("Search query is required");
	}

	if (!tokenInput) {
		throw new Error("Kagi session token is required");
	}

	const token = extractToken(tokenInput);

	try {
		const url = new URL(KAGI_SEARCH_URL);
		url.searchParams.set("q", trimmed);

		console.log("[Kagi] Searching for:", trimmed);

		const response = await fetch(url.toString(), {
			method: "GET",
			headers: {
				Cookie: `kagi_session=${token}`,
				"User-Agent": USER_AGENT,
			},
		});

		console.log("[Kagi] Response status:", response.status);

		if (!response.ok) {
			if (response.status === 401 || response.status === 403) {
				throw new Error(
					"Invalid or expired session token. Please update your token in settings.",
				);
			}
			throw new Error(
				`Kagi search failed: ${response.status} ${response.statusText}`,
			);
		}

		const html = await response.text();
		console.log("[Kagi] Received HTML length:", html.length);

		// Check for error messages in the HTML
		if (html.includes("Session expired") || html.includes("Invalid session")) {
			throw new Error(
				"Invalid or expired session token. Please update your token in settings.",
			);
		}

		const parsedResults = parseSearchResults(html);
		console.log("[Kagi] Parsed results:", parsedResults.results.length);

		return parsedResults;
	} catch (error) {
		console.error("[Kagi] Search error:", error);
		if (error instanceof Error) {
			throw error;
		}
		throw new Error("Failed to search Kagi");
	}
}

/**
 * Parse HTML search results from Kagi
 */
function parseSearchResults(html: string): KagiSearchResponse {
	const $ = cheerio.load(html);
	const results: KagiSearchResponse = {
		results: [],
		groupedResults: [],
		relatedSearches: [],
	};

	// Parse main search results - try multiple selector patterns for robustness
	const searchResultSelectors = [
		"._0_SRI.search-result", // Primary pattern (current)
		".search-result", // Fallback if _0_ prefix changes
		"[class*='_SRI'][class*='search-result']", // Partial class match
	];

	let searchResultElements = $();
	for (const selector of searchResultSelectors) {
		searchResultElements = $(selector);
		if (searchResultElements.length > 0) {
			console.log(`[Kagi] Found ${searchResultElements.length} results using selector: ${selector}`);
			break;
		}
	}

	if (searchResultElements.length === 0) {
		console.warn("[Kagi] No search results found with any selector");
		return results;
	}

	searchResultElements.each((_i, el) => {
		const $result = $(el);

		// Get the title - try multiple selectors for robustness
		let title = "";
		const titleSelectors = [
			".__sri_title_link", // Primary
			".sri_title_link", // Without prefix
			".__sri-title-box a", // Alternative path
			".__sri-title a", // Broader match
			"h3 a", // Generic fallback
		];

		for (const selector of titleSelectors) {
			const $titleLink = $result.find(selector).first();
			title = $titleLink.text().trim();
			if (title) break;
		}

		// Get the URL - try multiple sources for robustness
		let url = "";
		const urlSelectors = [
			".__sri-url", // Primary (display URL)
			".__sri_title_link", // Title link (fallback)
			"a[href^='http']", // Any external link
		];

		for (const selector of urlSelectors) {
			const $urlLink = $result.find(selector).first();
			url = $urlLink.attr("href") || "";
			// Ensure URL is absolute (not Kagi internal link)
			if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
				break;
			}
		}

		// Get the snippet - try multiple selectors
		let snippet = "";
		const snippetSelectors = [
			".__sri-desc", // Primary
			".sri-desc", // Without prefix
			".__sri-body", // Broader container
		];

		for (const selector of snippetSelectors) {
			const $desc = $result.find(selector).first();
			snippet = $desc.text().trim();
			if (snippet) break;
		}

		// Only add if we have at least a URL and title
		if (url && title) {
			results.results.push({
				t: 0,
				url,
				title,
				snippet: snippet || "",
			});
		} else {
			console.warn(`[Kagi] Skipping result ${_i}: url=${url}, title=${title}`);
		}
	});

	console.log(`[Kagi] Successfully parsed ${results.results.length} results`);

	// Parse grouped results (sub-results under main results)
	const groupSelectors = [".sr-group", ".__sri-group"];
	for (const groupSelector of groupSelectors) {
		$(groupSelector).each((_i, el) => {
			const $group = $(el);

			// Try to find sub-results
			const $subResults = $group.find(".__srgi, .srgi");

			if ($subResults.length > 0) {
				$subResults.each((_j, item) => {
					const $item = $(item);
					const $link = $item.find("a").first();
					const url = $link.attr("href") || "";
					const title = $link.text().trim();
					const snippet = $item.find(".__sri-desc, .sri-desc").text().trim();

					// Add sub-results as regular results
					if (url && title && (url.startsWith("http://") || url.startsWith("https://"))) {
						results.results.push({
							t: 0,
							url,
							title,
							snippet: snippet || "",
						});
					}
				});
			}
		});
	}

	// Parse related searches - try multiple selectors
	const relatedSelectors = [
		".__related-searches a",
		".related-searches a",
		"[class*='related'] a",
	];

	for (const selector of relatedSelectors) {
		$(selector).each((_i, el) => {
			const text = $(el).text().trim();
			if (text && !results.relatedSearches.includes(text)) {
				results.relatedSearches.push(text);
			}
		});
		if (results.relatedSearches.length > 0) break;
	}

	return results;
}
