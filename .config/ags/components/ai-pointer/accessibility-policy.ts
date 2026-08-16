import { type SelectionGeometry, validatedSelectionGeometry } from "./selection";

const snapPadding = 12;
const minimumCandidateCoverage = 0.85;
const minimumAreaRatio = 0.12;
const maximumAreaRatio = 2;
const minimumConfidence = 0.68;
const minimumConfidenceMargin = 0.06;
const maximumCandidates = 24;
const maximumRoleLength = 80;
const maximumNameLength = 160;
export const accessibilityProtocolVersion = 1;
export const accessibilityCoordinateSpace = "window";
const eligibleRoles = new Set([
	"check box",
	"combo box",
	"entry",
	"heading",
	"icon",
	"image",
	"link",
	"list item",
	"menu item",
	"page tab",
	"paragraph",
	"push button",
	"radio button",
	"slider",
	"spin button",
	"table cell",
	"text",
	"toggle button",
]);

export interface AccessibleCandidate {
	geometry: SelectionGeometry;
	name?: string;
	role: string;
}

export interface AccessibilityMetadata {
	confidence: number;
	name?: string;
	role: string;
}

export interface AccessibilityResolution {
	geometry: SelectionGeometry;
	metadata: AccessibilityMetadata;
}

export function parseAccessibilityHelperOutput(output: string): AccessibleCandidate[] | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(output);
	} catch {
		return null;
	}
	if (
		!isRecord(parsed) ||
		parsed.protocolVersion !== accessibilityProtocolVersion ||
		parsed.coordinateSpace !== accessibilityCoordinateSpace ||
		Array.isArray(parsed.candidates) === false
	)
		return null;

	const candidates: AccessibleCandidate[] = [];
	for (const value of parsed.candidates.slice(0, maximumCandidates)) {
		if (!isRecord(value) || !isRecord(value.geometry)) continue;
		const { x, y, width, height } = value.geometry;
		if (
			typeof x !== "number" ||
			typeof y !== "number" ||
			typeof width !== "number" ||
			typeof height !== "number"
		)
			continue;
		const geometry = validatedSelectionGeometry(x, y, width, height);
		if (
			!geometry ||
			typeof value.role !== "string" ||
			isSafeMetadata(value.role, maximumRoleLength) === false
		)
			continue;
		if (
			value.name !== undefined &&
			(typeof value.name !== "string" || isSafeMetadata(value.name, maximumNameLength) === false)
		)
			continue;
		candidates.push({ geometry, role: value.role, name: value.name });
	}
	return candidates;
}

interface RankedCandidate {
	candidate: AccessibleCandidate;
	confidence: number;
}

export function chooseAccessibleSnap(
	selection: SelectionGeometry,
	candidates: AccessibleCandidate[],
	clientGeometry: SelectionGeometry,
): AccessibilityResolution | null {
	const ranked = deduplicateCandidates(candidates)
		.map((candidate) => rankCandidate(selection, candidate, clientGeometry))
		.filter((candidate): candidate is RankedCandidate => candidate !== null)
		.sort((left, right) =>
			right.confidence - left.confidence ||
			left.candidate.role.localeCompare(right.candidate.role) ||
			(left.candidate.name ?? "").localeCompare(right.candidate.name ?? "")
		);
	const best = ranked[0];
	if (!best || best.confidence < minimumConfidence) return null;
	const alternative = ranked.find(
		(candidate) => geometryKey(candidate.candidate.geometry) !== geometryKey(best.candidate.geometry),
	);
	if (alternative && best.confidence - alternative.confidence < minimumConfidenceMargin) return null;

	const { x, y, width, height } = best.candidate.geometry;
	const geometry = validatedSelectionGeometry(
		x - snapPadding,
		y - snapPadding,
		width + snapPadding * 2,
		height + snapPadding * 2,
	);
	if (!geometry || containsGeometry(clientGeometry, geometry) === false) return null;

	return {
		geometry,
		metadata: {
			confidence: best.confidence,
			name: best.candidate.name,
			role: best.candidate.role,
		},
	};
}

function rankCandidate(
	selection: SelectionGeometry,
	candidate: AccessibleCandidate,
	clientGeometry: SelectionGeometry,
): RankedCandidate | null {
	if (eligibleRoles.has(candidate.role.trim().toLowerCase()) === false) return null;
	const geometry = validatedSelectionGeometry(
		candidate.geometry.x,
		candidate.geometry.y,
		candidate.geometry.width,
		candidate.geometry.height,
	);
	if (!geometry || containsGeometry(clientGeometry, geometry) === false) return null;

	const intersectionArea = intersection(selection, geometry);
	if (intersectionArea <= 0) return null;
	const selectionArea = selection.width * selection.height;
	const candidateArea = geometry.width * geometry.height;
	const candidateCoverage = intersectionArea / candidateArea;
	const areaRatio = candidateArea / selectionArea;
	if (
		candidateCoverage < minimumCandidateCoverage ||
		areaRatio < minimumAreaRatio ||
		areaRatio > maximumAreaRatio
	)
		return null;

	const centerAgreement =
		containsCenter(geometry, selection) || containsCenter(selection, geometry) ? 1 : 0;
	if (centerAgreement === 0) return null;
	const selectionCoverage = intersectionArea / selectionArea;
	const sizeSimilarity = Math.min(areaRatio, 1 / areaRatio);
	const confidence =
		candidateCoverage * 0.4 +
		sizeSimilarity * 0.25 +
		centerAgreement * 0.2 +
		Math.min(selectionCoverage, 1) * 0.15;

	return { candidate: { ...candidate, geometry }, confidence };
}

function deduplicateCandidates(candidates: AccessibleCandidate[]): AccessibleCandidate[] {
	const candidatesByGeometry = new Map<string, AccessibleCandidate>();
	for (const candidate of candidates) {
		const key = geometryKey(candidate.geometry);
		const existing = candidatesByGeometry.get(key);
		if (!existing || (!existing.name && candidate.name)) candidatesByGeometry.set(key, candidate);
	}
	return [...candidatesByGeometry.values()];
}

function geometryKey({ x, y, width, height }: SelectionGeometry): string {
	return `${x},${y}:${width}x${height}`;
}

function intersection(left: SelectionGeometry, right: SelectionGeometry): number {
	const width = Math.max(
		0,
		Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
	);
	const height = Math.max(
		0,
		Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
	);
	return width * height;
}

function containsCenter(container: SelectionGeometry, target: SelectionGeometry): boolean {
	const centerX = target.x + target.width / 2;
	const centerY = target.y + target.height / 2;
	return (
		centerX >= container.x &&
		centerX < container.x + container.width &&
		centerY >= container.y &&
		centerY < container.y + container.height
	);
}

function containsGeometry(container: SelectionGeometry, target: SelectionGeometry): boolean {
	return (
		target.x >= container.x &&
		target.y >= container.y &&
		target.x + target.width <= container.x + container.width &&
		target.y + target.height <= container.y + container.height
	);
}

function isSafeMetadata(value: string, maximumLength: number): boolean {
	return value.length > 0 && value.length <= maximumLength && /[\u0000-\u001f\u007f]/.test(value) === false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
