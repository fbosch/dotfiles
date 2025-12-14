/**
 * Kagi API types
 */

export type KagiSearchResult = {
	t: number; // Result type: 0 = regular result
	url: string;
	title: string;
	snippet: string;
};

export type KagiGroupedResult = {
	t: number; // Result type: 3 = grouped result
	title: string;
	results: Array<{
		url: string;
		title: string;
	}>;
};

export type KagiRelatedSearch = {
	t: number; // Result type: 1 = related search
	text: string;
};

export type KagiSearchResponse = {
	results: KagiSearchResult[];
	groupedResults: KagiGroupedResult[];
	relatedSearches: string[];
};
