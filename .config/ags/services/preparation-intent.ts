export interface PreparationIntentClaims<Source extends string> {
	claim(source: Source): boolean;
	release(source: Source): boolean;
	clear(): boolean;
	hasClaims(): boolean;
}

export function createPreparationRequestPattern<const Source extends string>(
	source: Source,
) {
	return P.union(
		{ action: "prepare", source },
		{ action: "release", source },
	);
}

export function createPreparationIntentClaims<
	Source extends string,
>(): PreparationIntentClaims<Source> {
	const sources = new Set<Source>();

	return {
		claim(source) {
			if (sources.has(source)) return false;
			sources.add(source);
			return sources.size === 1;
		},
		release(source) {
			if (sources.delete(source) === false) return false;
			return sources.size === 0;
		},
		clear() {
			if (sources.size === 0) return false;
			sources.clear();
			return true;
		},
		hasClaims: () => sources.size > 0,
	};
}
