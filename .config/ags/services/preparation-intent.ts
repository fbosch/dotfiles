import { P } from "ts-pattern";

export interface PreparationIntentClaims<Source extends string> {
	claim(source: Source, sequence?: number): boolean;
	release(source: Source, sequence?: number): boolean;
	clear(): boolean;
	hasClaims(): boolean;
}

const preparationSequencePattern = P.when(
	(value): value is number =>
		typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
);

export function createPreparationRequestPattern<const Source extends string>(
	source: Source,
) {
	return P.union(
		{ action: "prepare", source, sequence: preparationSequencePattern },
		{ action: "release", source, sequence: preparationSequencePattern },
	);
}

export function createPreparationIntentClaims<
	Source extends string,
>(): PreparationIntentClaims<Source> {
	const sources = new Set<Source>();
	const latestSequences = new Map<Source, number>();

	function acceptSequence(source: Source, sequence: number | undefined): boolean {
		if (sequence === undefined) return true;
		const latest = latestSequences.get(source);
		if (latest !== undefined && sequence <= latest) return false;
		latestSequences.set(source, sequence);
		return true;
	}

	return {
		claim(source, sequence) {
			if (acceptSequence(source, sequence) === false) return false;
			if (sources.has(source)) return false;
			sources.add(source);
			return sources.size === 1;
		},
		release(source, sequence) {
			if (acceptSequence(source, sequence) === false) return false;
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
