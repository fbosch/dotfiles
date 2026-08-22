import { containsSelectionCenter, type SelectionGeometry } from "./selection";

const candidateLimit = 5;
const textLimit = 160;
const excludedNamespaces = ["ags-ai-pointer", "ags-ai-pointer-stroke", "ags-selector", "selection"];

export type RawGeometry = { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
export type RawClient = RawGeometry & {
	address?: unknown;
	class?: unknown;
	title?: unknown;
	workspace?: { name?: unknown };
	monitor?: unknown;
	floating?: unknown;
	fullscreen?: unknown;
	pid?: unknown;
	initialClass?: unknown;
	initialTitle?: unknown;
	exe?: unknown;
	command?: unknown;
	cwd?: unknown;
};
export type RawLayer = RawGeometry & { namespace?: unknown; layer?: unknown };
export type RawMonitor = RawGeometry & { id?: unknown; name?: unknown; activeWorkspace?: { name?: unknown } };

export interface SelectionContext {
	selection: SelectionGeometry;
	snapshotAt: string;
	locked: boolean | null;
	monitor: { name: string; workspace: string } | null;
	exactWindow: ContextWindow | null;
	geometricInference: {
		limitation: "Geometric intersections are not compositor hit-test, z-order, or visible-pixel facts.";
		clients: ContextCandidate[];
		layers: ContextCandidate[];
	};
}

export interface ContextWindow {
	class: string;
	title: string;
	workspace: string;
	monitor: string;
	floating: boolean;
	fullscreen: boolean;
	active: boolean;
	relationship: "exact-geometry";
}

export interface ContextCandidate {
	kind: "client" | "layer";
	label: string;
	workspace?: string;
	monitor?: string;
	selectionCoverage: number;
	candidateCoverage: number;
	containsSelectionCenter: boolean;
	active: boolean;
}

interface CandidateInput {
	kind: "client" | "layer";
	label: string;
	workspace?: string;
	monitor?: string;
	geometry: SelectionGeometry;
	active: boolean;
}

function boundedText(value: unknown): string {
	return typeof value === "string" ? value.slice(0, textLimit) : "";
}

function geometry(value: RawGeometry): SelectionGeometry | null {
	const { x, y, width, height } = value;
	if (![x, y, width, height].every(Number.isSafeInteger)) return null;
	if ((width as number) <= 0 || (height as number) <= 0) return null;
	return { x: x as number, y: y as number, width: width as number, height: height as number };
}

function area(value: SelectionGeometry): number {
	return value.width * value.height;
}

function positiveIntersection(a: SelectionGeometry, b: SelectionGeometry): number {
	const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
	const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
	return width > 0 && height > 0 ? width * height : 0;
}

function rankCandidates(selection: SelectionGeometry, candidates: CandidateInput[]): ContextCandidate[] {
	return candidates
		.map((candidate) => {
			const intersection = positiveIntersection(selection, candidate.geometry);
			return {
				kind: candidate.kind,
				label: candidate.label,
				...(candidate.workspace ? { workspace: candidate.workspace } : {}),
				...(candidate.monitor ? { monitor: candidate.monitor } : {}),
				selectionCoverage: intersection / area(selection),
				candidateCoverage: intersection / area(candidate.geometry),
				containsSelectionCenter: containsSelectionCenter(candidate.geometry, selection),
				active: candidate.active,
			};
		})
		.filter((candidate) => candidate.selectionCoverage > 0)
		.sort((a, b) =>
			b.selectionCoverage - a.selectionCoverage ||
			b.candidateCoverage - a.candidateCoverage ||
			Number(b.containsSelectionCenter) - Number(a.containsSelectionCenter) ||
			Number(b.active) - Number(a.active) ||
			a.label.localeCompare(b.label) ||
			(a.workspace ?? "").localeCompare(b.workspace ?? "") ||
			(a.monitor ?? "").localeCompare(b.monitor ?? ""),
		)
		.slice(0, candidateLimit);
}

export function selectionContextFromSnapshots(
	selection: SelectionGeometry,
	snapshots: {
		clients: RawClient[];
		layers: Record<string, RawLayer[]>;
		monitors: RawMonitor[];
		activeWindow: { address?: unknown } | null;
		locked: boolean | null;
		snapshotAt: string;
	},
): SelectionContext {
	const activeAddress = typeof snapshots.activeWindow?.address === "string" ? snapshots.activeWindow.address : null;
	const monitorNames = new Map(
		snapshots.monitors.flatMap((monitor) =>
			Number.isSafeInteger(monitor.id) && boundedText(monitor.name)
				? [[monitor.id as number, boundedText(monitor.name)] as const]
				: []),
	);
	const clients = snapshots.clients.flatMap((client) => {
		const clientGeometry = geometry(client);
		if (!clientGeometry) return [];
		const label = boundedText(client.class);
		if (!label) return [];
		const monitor = typeof client.monitor === "number"
			? monitorNames.get(client.monitor) ?? ""
			: boundedText(client.monitor);
		return [{ client, geometry: clientGeometry, label, monitor, active: client.address === activeAddress }];
	});
	const exact = clients.filter(({ geometry: candidate }) =>
		candidate.x === selection.x && candidate.y === selection.y &&
		candidate.width === selection.width && candidate.height === selection.height,
	);
	const exactWindow = exact.length === 1
		? {
			class: exact[0].label,
			title: boundedText(exact[0].client.title),
			workspace: boundedText(exact[0].client.workspace?.name),
			monitor: exact[0].monitor,
			floating: exact[0].client.floating === true,
			fullscreen: exact[0].client.fullscreen === true,
			active: exact[0].active,
			relationship: "exact-geometry" as const,
		}
		: null;
	const layerCandidates = Object.entries(snapshots.layers).flatMap(([monitor, layers]) =>
		layers.flatMap((layer) => {
			const layerGeometry = geometry(layer);
			const namespace = boundedText(layer.namespace);
			if (!layerGeometry || !namespace || excludedNamespaces.some((prefix) => namespace.startsWith(prefix))) return [];
			return [{ kind: "layer" as const, label: namespace, monitor: boundedText(monitor), geometry: layerGeometry, active: false }];
		}),
	);
	const monitor = snapshots.monitors.find((candidate) => {
		const monitorGeometry = geometry(candidate);
		return monitorGeometry ? positiveIntersection(selection, monitorGeometry) > 0 : false;
	});
	return {
		selection,
		snapshotAt: snapshots.snapshotAt,
		locked: snapshots.locked,
		monitor: monitor ? { name: boundedText(monitor.name), workspace: boundedText(monitor.activeWorkspace?.name) } : null,
		exactWindow,
		geometricInference: {
			limitation: "Geometric intersections are not compositor hit-test, z-order, or visible-pixel facts.",
			clients: rankCandidates(selection, clients.map(({ geometry, label, monitor, client, active }) => ({
				kind: "client", label, workspace: boundedText(client.workspace?.name), monitor, geometry, active,
			}))),
			layers: rankCandidates(selection, layerCandidates),
		},
	};
}

export function emptySelectionContext(selection: SelectionGeometry): SelectionContext {
	return selectionContextFromSnapshots(selection, {
		clients: [],
		layers: {},
		monitors: [],
		activeWindow: null,
		locked: null,
		snapshotAt: new Date().toISOString(),
	});
}

export function formatSelectionContext(context: SelectionContext): string {
	const exact = context.exactWindow
		? [
			`class=${context.exactWindow.class}`,
			`title=${context.exactWindow.title || "none"}`,
			`workspace=${context.exactWindow.workspace || "unknown"}`,
			`monitor=${context.exactWindow.monitor || "unknown"}`,
			`active=${context.exactWindow.active}`,
			`floating=${context.exactWindow.floating}`,
			`fullscreen=${context.exactWindow.fullscreen}`,
			`relationship=${context.exactWindow.relationship}`,
		].join(", ")
		: "Exact window: none.";
	const candidates = (items: ContextCandidate[]) => items.map((item) => [
		item.label,
		`${Math.round(item.selectionCoverage * 100)}% selection coverage`,
		`${Math.round(item.candidateCoverage * 100)}% candidate coverage`,
		`center=${item.containsSelectionCenter}`,
		`active=${item.active}`,
		...(item.workspace ? [`workspace=${item.workspace}`] : []),
		...(item.monitor ? [`monitor=${item.monitor}`] : []),
	].join("; ")).join(" | ") || "none";
	return [
		"Desktop selection context (privacy-minimized point-in-time snapshot):",
		`Snapshot: ${context.snapshotAt}.`,
		`Selection: ${context.selection.width}x${context.selection.height} at ${context.selection.x},${context.selection.y}.`,
		`Monitor: ${context.monitor ? `${context.monitor.name || "unknown"}, workspace=${context.monitor.workspace || "unknown"}` : "unknown"}.`,
		context.exactWindow ? `Exact window: ${exact}.` : exact,
		`Client geometric candidates: ${candidates(context.geometricInference.clients)}.`,
		`Layer geometric candidates: ${candidates(context.geometricInference.layers)}.`,
		context.geometricInference.limitation,
	].join("\n");
}

export function formatDesktopPointerRequest(question: string, context: SelectionContext): string {
	return [
		"<desktop_pointer_request>",
		"<supporting_context>",
		'<desktop_screenshot attachment="image/png" trust="untrusted" />',
		'<desktop_selection_metadata trust="untrusted">',
		escapeXmlText(formatSelectionContext(context)),
		"</desktop_selection_metadata>",
		"</supporting_context>",
		"<user_question>",
		escapeXmlText(question.trim()),
		"</user_question>",
		"</desktop_pointer_request>",
	].join("\n");
}

function escapeXmlText(value: string): string {
	let validXml = "";
	for (const character of value) {
		const codePoint = character.codePointAt(0) ?? 0;
		validXml += codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd ||
			(codePoint >= 0x20 && codePoint <= 0xd7ff) ||
			(codePoint >= 0xe000 && codePoint <= 0xfffd) ||
			(codePoint >= 0x10000 && codePoint <= 0x10ffff)
			? character
			: "\uFFFD";
	}
	return validXml
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}
