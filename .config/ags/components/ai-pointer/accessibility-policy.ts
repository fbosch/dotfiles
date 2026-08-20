import {
	containsSelectionCenter,
	paddedSelectionGeometry,
	type SelectionGeometry,
	validatedSelectionGeometry,
} from "./selection";
import {
	pointInStrokeRegion,
	strokeCapturePadding,
	strokeRegionContainsGeometry,
	strokeRegionGeometryCoverage,
	type StrokeSelectionRegion,
} from "./stroke";
import {
	accessibilityRegionRolePriority,
	commonAncestorRoles,
	directTargetPriority,
	isEligibleAccessibilityRole,
} from "./accessibility-target-roles";
import {
	resolveStrokeRegionSelection,
	type RankedAccessibleCandidate,
} from "./accessibility-region-policy";
import type { AccessibleCandidate } from "./accessibility-helper-protocol";
export {
	accessibilityCoordinateSpace,
	accessibilityProtocolVersion,
	parseAccessibilityHelperOutput,
} from "./accessibility-helper-protocol";
export type {
	AccessibilityHelperOutput,
	AccessibilityHelperTiming,
	AccessibleCandidate,
} from "./accessibility-helper-protocol";

const snapPadding = 12;
const minimumCandidateCoverage = 0.3;
const minimumAreaRatio = 0.05;
const maximumAreaRatio = 5;
const maximumNamedAncestorAreaRatio = 12;
const minimumConfidence = 0.5;
const minimumConfidenceMargin = 0.03;
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

type RankedCandidate = RankedAccessibleCandidate;

interface CandidateAnalysis {
	candidate: AccessibleCandidate;
	ranked: RankedCandidate | null;
}

export function chooseAccessibleSnap(
	selection: SelectionGeometry,
	candidates: AccessibleCandidate[],
	clientGeometry: SelectionGeometry,
	region?: StrokeSelectionRegion,
): AccessibilityResolution | null {
	return evaluateAccessibleSnap(selection, candidates, clientGeometry, region).resolution;
}

export { isEligibleAccessibilityRole } from "./accessibility-target-roles";

export function evaluateAccessibleSnap(
	selection: SelectionGeometry,
	candidates: AccessibleCandidate[],
	clientGeometry: SelectionGeometry,
	region?: StrokeSelectionRegion,
): AccessibilityEvaluation {
	const analyzed = deduplicateCandidates(candidates).map((candidate) => ({
		candidate,
		ranked: rankCandidate(selection, candidate, clientGeometry, region),
	}));
	const ranked = analyzed
		.map(({ ranked: candidate }) => candidate)
		.filter((candidate): candidate is RankedCandidate => candidate !== null)
		.sort((left, right) =>
			right.confidence - left.confidence ||
			left.candidate.role.localeCompare(right.candidate.role) ||
			(left.candidate.name ?? "").localeCompare(right.candidate.name ?? "")
		);
	const resolution = region
		? resolveStrokeRegionSelection(selection, ranked, clientGeometry)
		: chooseAccessibleSnapInternal(selection, candidates, clientGeometry, ranked);
	return {
		diagnostics: diagnoseCandidates(selection, analyzed, clientGeometry, resolution, region),
		resolution,
	};
}

function chooseAccessibleSnapInternal(
	selection: SelectionGeometry,
	candidates: AccessibleCandidate[],
	clientGeometry: SelectionGeometry,
	ranked: RankedCandidate[],
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
	analyzed: CandidateAnalysis[],
	clientGeometry: SelectionGeometry,
	resolution: AccessibilityResolution | null,
	region?: StrokeSelectionRegion,
): AccessibilityCandidateDiagnostic[] {
	const selectedGeometries = new Set(
		resolution?.metadata.targets?.map(({ targetGeometry }) => geometryKey(targetGeometry)) ??
			(resolution?.metadata.targetGeometry
				? [geometryKey(resolution.metadata.targetGeometry)]
				: []),
	);
	return analyzed
		.map(({ candidate, ranked }) => {
			return {
				centerHit: candidate.centerHit === true,
				confidence: ranked?.confidence,
				geometry: candidate.geometry,
				hitCount: candidate.hitCount ?? 1,
				name: candidate.name,
				reason: ranked
					? "eligible"
					: candidateRejectionReason(selection, candidate, clientGeometry, region),
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
	region?: StrokeSelectionRegion,
): string {
	if (isEligibleAccessibilityRole(candidate.role) === false) return "ineligible role";
	const geometry = validatedSelectionGeometry(
		candidate.geometry.x,
		candidate.geometry.y,
		candidate.geometry.width,
		candidate.geometry.height,
	);
	if (!geometry) return "invalid geometry";
	if (containsGeometry(clientGeometry, geometry) === false) return "outside client";
	if (region && strokeRegionContainsGeometry(region, geometry) === false)
		return "outside stroke region";
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
	region?: StrokeSelectionRegion,
): RankedCandidate | null {
	if (isEligibleAccessibilityRole(candidate.role) === false) return null;
	const geometry = validatedSelectionGeometry(
		candidate.geometry.x,
		candidate.geometry.y,
		candidate.geometry.width,
		candidate.geometry.height,
	);
	if (!geometry || containsGeometry(clientGeometry, geometry) === false) return null;
	if (region) {
		const centerIncluded = pointInStrokeRegion(region, {
			x: geometry.x + geometry.width / 2,
			y: geometry.y + geometry.height / 2,
		});
		const coverage = strokeRegionGeometryCoverage(region, geometry);
		if (centerIncluded === false && coverage < 0.5) return null;
		const selectionArea = selection.width * selection.height;
		const candidateArea = geometry.width * geometry.height;
		const areaRatio = candidateArea / selectionArea;
		const selectionCoverage = intersection(selection, geometry) / selectionArea;
		const role = candidate.role.trim().toLowerCase();
		const namedCommonAncestor =
			areaRatio <= maximumNamedAncestorAreaRatio &&
			selectionCoverage >= 0.7 &&
			(candidate.hitCount ?? 1) >= 7 &&
			Boolean(candidate.name) &&
			commonAncestorRoles.has(role);
		const directCenterTarget =
			candidate.centerHit === true && directTargetPriority.has(role);
		if (
			areaRatio > maximumAreaRatio &&
			namedCommonAncestor === false &&
			directCenterTarget === false
		)
			return null;
		const repeatedHitBonus = Math.min(Math.max((candidate.hitCount ?? 1) - 1, 0) / 8, 1) * 0.2;
		const confidence = Math.min(
			1,
			(centerIncluded ? 0.6 : 0.35) + coverage * 0.3 + repeatedHitBonus,
		);
		return { candidate: { ...candidate, geometry }, confidence };
	}

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
		const candidateRolePriority = isEligibleAccessibilityRole(candidateRole)
			? accessibilityRegionRolePriority(candidateRole)
			: 4;
		const existingRolePriority = existingRole && isEligibleAccessibilityRole(existingRole)
			? accessibilityRegionRolePriority(existingRole)
			: 4;
		let preferred = existing;
		if (
			!existing ||
			candidateRolePriority < existingRolePriority ||
			(candidateRolePriority === existingRolePriority &&
				((candidate.hitCount ?? 1) > (existing.hitCount ?? 1) ||
					((candidate.hitCount ?? 1) === (existing.hitCount ?? 1) &&
						!existing.name && candidate.name)))
		)
			preferred = candidate;
		if (!preferred) continue;
		const sameRole = candidateRole === existingRole;
		candidatesByGeometry.set(key, {
			...preferred,
			centerHit: sameRole
				? candidate.centerHit === true || existing?.centerHit === true
				: preferred.centerHit,
			hitCount: sameRole
				? Math.max(candidate.hitCount ?? 1, existing?.hitCount ?? 1)
				: preferred.hitCount,
			name: sameRole
				? preferred.name ?? (preferred === candidate ? existing?.name : candidate.name)
				: preferred.name,
			url: preferred.role.trim().toLowerCase() === "link"
				? sameRole
					? preferred.url ?? (preferred === candidate ? existing?.url : candidate.url)
					: preferred.url
				: undefined,
		});
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
