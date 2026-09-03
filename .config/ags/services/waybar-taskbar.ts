export type WaybarTitleRewrite = Readonly<{
	pattern: string;
	replacement: string;
}>;

export function parseWaybarTitleRewrites(
	contents: string,
): WaybarTitleRewrite[] {
	const rewrites: WaybarTitleRewrite[] = [];
	const entryPattern =
		/"([^"\\]*(?:\\.[^"\\]*)*)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g;
	for (const match of contents.matchAll(entryPattern)) {
		const pattern = decodeJsonString(match[1]);
		const replacement = decodeJsonString(match[2]);
		if (pattern === null || replacement === null) continue;
		rewrites.push({ pattern, replacement });
	}
	return rewrites;
}

export function applyWaybarTitleRewrites(
	title: string,
	rewrites: readonly WaybarTitleRewrite[],
): string {
	const escapedTitle = escapePangoText(title);
	let rewrittenTitle = escapedTitle;

	for (const { pattern, replacement } of rewrites) {
		try {
			const expression = new RegExp(`^(?:${pattern})$`, "i");
			if (expression.test(escapedTitle))
				rewrittenTitle = rewrittenTitle.replace(expression, replacement);
		} catch {
			// Waybar skips invalid rewrite expressions.
		}
	}

	return unescapePangoText(rewrittenTitle);
}

function decodeJsonString(value: string): string | null {
	try {
		return JSON.parse(`"${value}"`) as string;
	} catch {
		return null;
	}
}

function escapePangoText(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll("'", "&apos;")
		.replaceAll('"', "&quot;");
}

function unescapePangoText(value: string): string {
	return value.replaceAll(
		/&(?:amp|lt|gt|apos|quot);/g,
		(entity) =>
			({
				"&amp;": "&",
				"&lt;": "<",
				"&gt;": ">",
				"&apos;": "'",
				"&quot;": '"',
			})[entity] ?? entity,
	);
}
