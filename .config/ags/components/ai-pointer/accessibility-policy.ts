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
const commonAncestorRoles = new Set(["article", "list item", "section"]);
const collectionRoles = new Set([
	"check box",
	"combo box",
	"entry",
	"icon",
	"image",
	"link",
	"list item",
	"menu item",
	"page tab",
	"push button",
	"radio button",
	"slider",
	"spin button",
	"table cell",
	"toggle button",
]);
const maximumCollectionTargets = 8;
const minimumCollectionDensity = 0.15;
const maximumCollectionOverlap = 0.5;
const maximumDiagnostics = 12;
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

export interface AccessibilityTargetMetadata {
	centerHit?: boolean;
	confidence: number;
	hitCount?: number;
	name?: string;
	role: string;
	targetGeometry: SelectionGeometry;
	url?: string;
}

export interface ProgramMetadata {
	class?: string;
	coverage?: number;
	geometry: SelectionGeometry;
	pid: number;
	title?: string;
}

export interface AccessibilityMetadata extends Omit<AccessibilityTargetMetadata, "targetGeometry"> {
	program?: ProgramMetadata;
	targetGeometry?: SelectionGeometry;
	targets?: AccessibilityTargetMetadata[];
}

export interface AccessibilityResolution {
	geometry: SelectionGeometry;
	metadata: AccessibilityMetadata;
}

export interface AccessibilityCandidateDiagnostic {
	centerHit: boolean;
	confidence?: number;
	geometry: SelectionGeometry;
	hitCount: number;
	name?: string;
	reason: string;
	role: string;
	selected: boolean;
}

export interface AccessibilityEvaluation {
	diagnostics: AccessibilityCandidateDiagnostic[];
	resolution: AccessibilityResolution | null;
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
	return evaluateAccessibleSnap(selection, candidates, clientGeometry).resolution;
}

export function evaluateAccessibleSnap(
	selection: SelectionGeometry,
	candidates: AccessibleCandidate[],
	clientGeometry: SelectionGeometry,
): AccessibilityEvaluation {
	const resolution = chooseAccessibleSnapInternal(selection, candidates, clientGeometry);
	return {
		diagnostics: diagnoseCandidates(selection, candidates, clientGeometry, resolution),
		resolution,
	};
}

function chooseAccessibleSnapInternal(
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
			directTargetFit(selection, right) - directTargetFit(selection, left) ||
			left.geometry.width * left.geometry.height - right.geometry.width * right.geometry.height,
		);
	const ranked = deduplicateCandidates(candidates)
		.map((candidate) => rankCandidate(selection, candidate, clientGeometry))
		.filter((candidate): candidate is RankedCandidate => candidate !== null)
		.sort((left, right) =>
			right.confidence - left.confidence ||
			left.candidate.role.localeCompare(right.candidate.role) ||
			(left.candidate.name ?? "").localeCompare(right.candidate.name ?? "")
		);
	const best = ranked[0];
	const alternative = ranked.find(
		(candidate) => best && geometryKey(candidate.candidate.geometry) !== geometryKey(best.candidate.geometry),
	);
	const bestIsClear = Boolean(
		best &&
		best.confidence >= minimumConfidence &&
		(!alternative || best.confidence - alternative.confidence >= minimumConfidenceMargin),
	);
	const bestRole = best?.candidate.role.trim().toLowerCase();
	if (
		(directTargets.length === 0 || bestRole === "list item") &&
		bestIsClear &&
		best &&
		(best.candidate.hitCount ?? 1) >= 7 &&
		commonAncestorRoles.has(best.candidate.role.trim().toLowerCase())
	) {
		const resolution = resolutionFromCandidate(best.candidate, best.confidence, clientGeometry);
		if (resolution) return resolution;
	}

	const collection = resolutionFromCollection(selection, ranked, clientGeometry);
	if (collection) return collection;

	for (const candidate of directTargets) {
		if (containsSelectionCenter(candidate.geometry, selection, strokeCapturePadding) === false)
			continue;
		const resolution = resolutionFromCandidate(candidate, 1, clientGeometry);
		if (resolution) return resolution;
	}

	if (!best || bestIsClear === false) return null;

	return resolutionFromCandidate(best.candidate, best.confidence, clientGeometry);
}

function diagnoseCandidates(
	selection: SelectionGeometry,
	candidates: AccessibleCandidate[],
	clientGeometry: SelectionGeometry,
	resolution: AccessibilityResolution | null,
): AccessibilityCandidateDiagnostic[] {
	const selectedGeometries = new Set(
		resolution?.metadata.targets?.map(({ targetGeometry }) => geometryKey(targetGeometry)) ??
			(resolution?.metadata.targetGeometry
				? [geometryKey(resolution.metadata.targetGeometry)]
				: []),
	);
	return deduplicateCandidates(candidates)
		.map((candidate) => {
			const ranked = rankCandidate(selection, candidate, clientGeometry);
			return {
				centerHit: candidate.centerHit === true,
				confidence: ranked?.confidence,
				geometry: candidate.geometry,
				hitCount: candidate.hitCount ?? 1,
				name: candidate.name,
				reason: ranked ? "eligible" : candidateRejectionReason(selection, candidate, clientGeometry),
				role: candidate.role,
				selected: selectedGeometries.has(geometryKey(candidate.geometry)),
			};
		})
		.sort((left, right) =>
			Number(right.selected) - Number(left.selected) ||
			(right.confidence ?? -1) - (left.confidence ?? -1) ||
			right.hitCount - left.hitCount,
		)
		.slice(0, maximumDiagnostics);
}

function candidateRejectionReason(
	selection: SelectionGeometry,
	candidate: AccessibleCandidate,
	clientGeometry: SelectionGeometry,
): string {
	if (eligibleRoles.has(candidate.role.trim().toLowerCase()) === false) return "ineligible role";
	const geometry = validatedSelectionGeometry(
		candidate.geometry.x,
		candidate.geometry.y,
		candidate.geometry.width,
		candidate.geometry.height,
	);
	if (!geometry) return "invalid geometry";
	if (containsGeometry(clientGeometry, geometry) === false) return "outside client";
	const fuzzySelection = paddedSelectionGeometry(selection, strokeCapturePadding);
	if (!fuzzySelection || intersection(fuzzySelection, geometry) <= 0) return "outside brush";
	const selectionArea = selection.width * selection.height;
	const candidateArea = geometry.width * geometry.height;
	const intersectionArea = intersection(selection, geometry);
	const areaRatio = candidateArea / selectionArea;
	if (areaRatio < minimumAreaRatio) return "too small";
	const selectionCoverage = intersectionArea / selectionArea;
	const namedCommonAncestor =
		areaRatio <= maximumNamedAncestorAreaRatio &&
		selectionCoverage >= 0.7 &&
		(candidate.hitCount ?? 1) >= 7 &&
		Boolean(candidate.name) &&
		commonAncestorRoles.has(candidate.role.trim().toLowerCase());
	if (areaRatio > maximumAreaRatio && namedCommonAncestor === false) return "too large";
	return "weak overlap";
}

function directTargetFit(
	selection: SelectionGeometry,
	candidate: AccessibleCandidate,
): number {
	const intersectionArea = intersection(selection, candidate.geometry);
	const selectionArea = selection.width * selection.height;
	const candidateArea = candidate.geometry.width * candidate.geometry.height;
	const selectionCoverage = intersectionArea / selectionArea;
	const candidateCoverage = intersectionArea / candidateArea;
	const areaRatio = candidateArea / selectionArea;
	const sizeSimilarity = Math.min(areaRatio, 1 / areaRatio);
	return selectionCoverage * 0.5 + candidateCoverage * 0.25 + sizeSimilarity * 0.25;
}

function resolutionFromCollection(
	selection: SelectionGeometry,
	ranked: RankedCandidate[],
	clientGeometry: SelectionGeometry,
): AccessibilityResolution | null {
	const selected: RankedCandidate[] = [];
	for (const rankedCandidate of ranked) {
		if (rankedCandidate.confidence < minimumConfidence) continue;
		const { candidate } = rankedCandidate;
		if (
			collectionRoles.has(candidate.role.trim().toLowerCase()) === false ||
			containsSelectionCenter(selection, candidate.geometry) === false
		)
			continue;
		const candidateArea = candidate.geometry.width * candidate.geometry.height;
		const overlapsSelected = selected.some(({ candidate: existing }) => {
			const existingArea = existing.geometry.width * existing.geometry.height;
			return (
				intersection(candidate.geometry, existing.geometry) /
				Math.min(candidateArea, existingArea)
			) >= maximumCollectionOverlap;
		});
		if (overlapsSelected) continue;
		selected.push(rankedCandidate);
		if (selected.length >= maximumCollectionTargets) break;
	}
	if (selected.length < 2) return null;

	const left = Math.min(...selected.map(({ candidate }) => candidate.geometry.x));
	const top = Math.min(...selected.map(({ candidate }) => candidate.geometry.y));
	const right = Math.max(...selected.map(({ candidate }) => candidate.geometry.x + candidate.geometry.width));
	const bottom = Math.max(...selected.map(({ candidate }) => candidate.geometry.y + candidate.geometry.height));
	const targetGeometry = validatedSelectionGeometry(left, top, right - left, bottom - top);
	if (!targetGeometry || containsGeometry(clientGeometry, targetGeometry) === false) return null;
	const targetArea = targetGeometry.width * targetGeometry.height;
	const memberArea = selected.reduce(
		(total, { candidate }) => total + candidate.geometry.width * candidate.geometry.height,
		0,
	);
	if (
		memberArea / targetArea < minimumCollectionDensity ||
		targetArea / (selection.width * selection.height) > maximumAreaRatio
	)
		return null;
	const geometry = paddedSelectionGeometry(targetGeometry, snapPadding);
	if (!geometry || containsGeometry(clientGeometry, geometry) === false) return null;
	const targets = selected.map(({ candidate, confidence }) => ({
		centerHit: candidate.centerHit,
		confidence,
		hitCount: candidate.hitCount ?? 1,
		name: candidate.name,
		role: candidate.role,
		targetGeometry: candidate.geometry,
		url: candidate.url,
	}));
	return {
		geometry,
		metadata: {
			centerHit: targets.some(({ centerHit }) => centerHit),
			confidence: Math.min(...targets.map(({ confidence }) => confidence)),
			hitCount: targets.reduce((total, { hitCount }) => total + (hitCount ?? 1), 0),
			name: `${targets.length} accessible targets`,
			role: "collection",
			targetGeometry,
			targets,
		},
	};
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
