export interface AccessibilityWindowCandidate<T> {
	active: boolean;
	exactPid: boolean;
	titleMatch?: boolean;
	value: T;
}

export function chooseAccessibilityWindow<T>(
	candidates: AccessibilityWindowCandidate<T>[],
): T | null {
	// Compositor reloads can leave AT-SPI focus stale until the application receives a new focus event.
	const exact = candidates.filter(({ exactPid }) => exactPid);
	if (exact.length === 1) return exact[0].value;
	if (exact.length > 1) {
		const exactTitleMatches = exact.filter(({ titleMatch }) => titleMatch === true);
		if (exactTitleMatches.length === 1) return exactTitleMatches[0].value;
		if (exactTitleMatches.length > 1) {
			const activeExactTitleMatch = exactTitleMatches.filter(({ active }) => active);
			if (activeExactTitleMatch.length === 1) return activeExactTitleMatch[0].value;
		}
		const activeExact = exact.filter(({ active }) => active);
		return activeExact.length === 1 ? activeExact[0].value : null;
	}

	const titleMatches = candidates.filter(({ titleMatch }) => titleMatch === true);
	if (titleMatches.length === 1) return titleMatches[0].value;
	if (titleMatches.length > 1) {
		const activeTitleMatch = titleMatches.filter(({ active }) => active);
		return activeTitleMatch.length === 1 ? activeTitleMatch[0].value : null;
	}
	const active = candidates.filter((candidate) => candidate.active);
	return active.length === 1 ? active[0].value : null;
}
