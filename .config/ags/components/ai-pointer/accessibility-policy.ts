import {
	containsSelectionCenter,
	paddedSelectionGeometry,
	type SelectionGeometry,
	validatedSelectionGeometry,
} from "./selection";
import { strokeCapturePadding } from "./stroke";

const snapPadding = 12;
const minimumCandidateCoverage = 0.3;
const minimumAreaRatio = 0.05;
const maximumAreaRatio = 5;
const maximumNamedAncestorAreaRatio = 12;
const minimumConfidence = 0.5;
const minimumConfidenceMargin = 0.03;
const maximumCandidates = 24;
const maximumRoleLength = 80;
const maximumNameLength = 160;
const maximumUrlLength = 512;
export const accessibilityProtocolVersion = 3;
export const accessibilityCoordinateSpace = "window";
const eligibleRoles = new Set([
	"article",
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
	"section",
	"slider",
	"spin button",
	"table cell",
	"text",
	"toggle button",
]);
const commonAncestorRoles = new Set(["article", "section"]);
const directTargetPriority = new Map([
	["link", 0],
	["image", 1],
]);

export interface AccessibleCandidate {
	centerHit?: boolean;
	geometry: SelectionGeometry;
	hitCount?: number;
	name?: string;
	role: string;
	url?: string;
}

export interface AccessibilityMetadata {
	centerHit?: boolean;
	confidence: number;
	hitCount?: number;
	name?: string;
	program?: {
		class?: string;
		pid: number;
		title?: string;
	};
	role: string;
	targetGeometry?: SelectionGeometry;
	url?: string;
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
		if (
			value.url !== undefined &&
			(typeof value.url !== "string" ||
				value.role.trim().toLowerCase() !== "link" ||
				isSafeUrl(value.url) === false)
		)
			continue;
		if (
			value.centerHit !== undefined &&
			typeof value.centerHit !== "boolean"
		)
			continue;
		if (
			value.hitCount !== undefined &&
			(typeof value.hitCount !== "number" ||
				Number.isSafeInteger(value.hitCount) === false ||
				value.hitCount < 1 ||
				value.hitCount > 24)
		)
			continue;
		candidates.push({
			centerHit: value.centerHit,
			geometry,
			hitCount: value.hitCount,
			role: value.role,
			name: value.name,
			url: value.url,
		});
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
	const directTargets = candidates
		.filter((candidate) =>
			candidate.centerHit === true &&
			directTargetPriority.has(candidate.role.trim().toLowerCase()),
		)
		.sort((left, right) =>
			Number(right.centerHit) - Number(left.centerHit) ||
			(directTargetPriority.get(left.role.trim().toLowerCase()) ?? Number.MAX_SAFE_INTEGER) -
				(directTargetPriority.get(right.role.trim().toLowerCase()) ?? Number.MAX_SAFE_INTEGER) ||
			left.geometry.width * left.geometry.height - right.geometry.width * right.geometry.height,
		);
	for (const candidate of directTargets) {
		if (containsSelectionCenter(candidate.geometry, selection, strokeCapturePadding) === false)
			continue;
		const resolution = resolutionFromCandidate(candidate, 1, clientGeometry);
		if (resolution) return resolution;
	}

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

	return resolutionFromCandidate(best.candidate, best.confidence, clientGeometry);
}

function resolutionFromCandidate(
	candidate: AccessibleCandidate,
	confidence: number,
	clientGeometry: SelectionGeometry,
): AccessibilityResolution | null {
	const candidateGeometry = validatedSelectionGeometry(
		candidate.geometry.x,
		candidate.geometry.y,
		candidate.geometry.width,
		candidate.geometry.height,
	);
	if (!candidateGeometry || containsGeometry(clientGeometry, candidateGeometry) === false) return null;
	const geometry = paddedSelectionGeometry(candidateGeometry, snapPadding);
	if (!geometry || containsGeometry(clientGeometry, geometry) === false) return null;
	return {
		geometry,
		metadata: {
			centerHit: candidate.centerHit,
			confidence,
			hitCount: candidate.hitCount ?? 1,
			name: candidate.name,
			role: candidate.role,
			targetGeometry: candidateGeometry,
			url: candidate.url,
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

	const fuzzySelection = paddedSelectionGeometry(selection, strokeCapturePadding);
	if (!fuzzySelection) return null;
	const intersectionArea = intersection(selection, geometry);
	const fuzzyIntersectionArea = intersection(fuzzySelection, geometry);
	if (fuzzyIntersectionArea <= 0) return null;
	const selectionArea = selection.width * selection.height;
	const fuzzySelectionArea = fuzzySelection.width * fuzzySelection.height;
	const candidateArea = geometry.width * geometry.height;
	const candidateCoverage = intersectionArea / candidateArea;
	const fuzzyCandidateCoverage = fuzzyIntersectionArea / candidateArea;
	const areaRatio = candidateArea / selectionArea;
	const selectionCoverage = intersectionArea / selectionArea;
	const fuzzySelectionCoverage = fuzzyIntersectionArea / fuzzySelectionArea;
	const namedCommonAncestor =
		areaRatio <= maximumNamedAncestorAreaRatio &&
		selectionCoverage >= 0.7 &&
		(candidate.hitCount ?? 1) >= 7 &&
		Boolean(candidate.name) &&
		commonAncestorRoles.has(candidate.role.trim().toLowerCase());
	const centerAffinity =
		containsSelectionCenter(geometry, selection) || containsSelectionCenter(selection, geometry)
			? 1
			: containsSelectionCenter(geometry, selection, strokeCapturePadding)
				? 0.8
				: 0.5;
	const boundedPartialTarget =
		areaRatio > 1 &&
		(areaRatio <= maximumAreaRatio || namedCommonAncestor) &&
		fuzzySelectionCoverage >= 0.35 &&
		centerAffinity >= 0.8;
	const effectiveCandidateCoverage = Math.max(
		candidateCoverage,
		fuzzyCandidateCoverage * 0.75,
	);
	if (
		(effectiveCandidateCoverage < minimumCandidateCoverage && boundedPartialTarget === false) ||
		areaRatio < minimumAreaRatio ||
		(areaRatio > maximumAreaRatio && namedCommonAncestor === false)
	)
		return null;

	const sizeSimilarity = Math.min(areaRatio, 1 / areaRatio);
	const repeatedHitBonus = Math.min(Math.max((candidate.hitCount ?? 1) - 1, 0) / 8, 1) * 0.3;
	const confidence = Math.min(1,
		effectiveCandidateCoverage * 0.4 +
		sizeSimilarity * 0.25 +
		centerAffinity * 0.2 +
		Math.max(selectionCoverage, fuzzySelectionCoverage * 0.5) * 0.15 +
		repeatedHitBonus,
	);

	return { candidate: { ...candidate, geometry }, confidence };
}

function deduplicateCandidates(candidates: AccessibleCandidate[]): AccessibleCandidate[] {
	const candidatesByGeometry = new Map<string, AccessibleCandidate>();
	for (const candidate of candidates) {
		const key = geometryKey(candidate.geometry);
		const existing = candidatesByGeometry.get(key);
		const candidateRole = candidate.role.trim().toLowerCase();
		const existingRole = existing?.role.trim().toLowerCase();
		const candidateRolePriority = eligibleRoles.has(candidateRole)
			? (directTargetPriority.get(candidateRole) ?? 2)
			: 3;
		const existingRolePriority = existingRole && eligibleRoles.has(existingRole)
			? (directTargetPriority.get(existingRole) ?? 2)
			: 3;
		if (
			!existing ||
			candidateRolePriority < existingRolePriority ||
			(candidateRolePriority === existingRolePriority &&
				((candidate.hitCount ?? 1) > (existing.hitCount ?? 1) ||
					((candidate.hitCount ?? 1) === (existing.hitCount ?? 1) &&
						!existing.name && candidate.name)))
		)
			candidatesByGeometry.set(key, candidate);
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

function isSafeUrl(value: string): boolean {
	return (
		value.length <= maximumUrlLength &&
		/[\u0000-\u0020\u007f]/.test(value) === false &&
		/^https?:\/\//i.test(value)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
