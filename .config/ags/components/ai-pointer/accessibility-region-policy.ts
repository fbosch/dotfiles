import {
	commonAncestorRoles,
	directTargetPriority,
	accessibilityRegionRolePriority,
} from "./accessibility-target-roles";
import {
	paddedSelectionGeometry,
	type SelectionGeometry,
	validatedSelectionGeometry,
} from "./selection";
import type { AccessibleCandidate, AccessibilityResolution } from "./accessibility-policy";
import type { StrokeSelectionRegion } from "./stroke";

const snapPadding = 12;
const minimumConfidence = 0.5;
const maximumCollectionTargets = 8;
const maximumCollectionOverlap = 0.5;
const minimumCollectionDensity = 0.15;
const maximumAreaRatio = 5;
const minimumConfidenceMargin = 0.03;

export interface RankedAccessibleCandidate {
	candidate: AccessibleCandidate;
	confidence: number;
}

export function resolveStrokeRegionSelection(
	selection: SelectionGeometry,
	ranked: RankedAccessibleCandidate[],
	clientGeometry: SelectionGeometry,
	regionKind: StrokeSelectionRegion["kind"],
): AccessibilityResolution | null {
	const eligible = [...ranked]
		.filter(({ confidence }) => confidence >= minimumConfidence)
		.sort((left, right) =>
			accessibilityRegionRolePriority(left.candidate.role) -
				accessibilityRegionRolePriority(right.candidate.role) ||
			right.confidence - left.confidence ||
			left.candidate.geometry.width * left.candidate.geometry.height -
				right.candidate.geometry.width * right.candidate.geometry.height
		);
	const hasDirectTarget = eligible.some(({ candidate }) =>
		candidate.centerHit === true &&
		directTargetPriority.has(candidate.role.trim().toLowerCase())
	);
	const commonAncestors = eligible.filter(({ candidate }) => {
		const role = candidate.role.trim().toLowerCase();
		return (
			commonAncestorRoles.has(role) &&
			(candidate.hitCount ?? 1) >= 7 &&
			Boolean(candidate.name) &&
			(role === "list item" || hasDirectTarget === false)
		);
	});
	if (regionKind === "closed" && commonAncestors.length === 1) {
		const [commonAncestor] = commonAncestors;
		return resolutionFromCandidate(
			commonAncestor.candidate,
			commonAncestor.confidence,
			clientGeometry,
		);
	}

	const selected: RankedAccessibleCandidate[] = [];
	for (const candidate of eligible) {
		const candidateArea = candidate.candidate.geometry.width * candidate.candidate.geometry.height;
		const overlapping = selected.find(({ candidate: existing }) => {
			const existingArea = existing.geometry.width * existing.geometry.height;
			return (
				intersection(candidate.candidate.geometry, existing.geometry) /
				Math.min(candidateArea, existingArea)
			) >= maximumCollectionOverlap;
		});
		if (overlapping) {
			if (
				accessibilityRegionRolePriority(overlapping.candidate.role) ===
					accessibilityRegionRolePriority(candidate.candidate.role) &&
				overlapping.confidence - candidate.confidence < minimumConfidenceMargin
			)
				return null;
			continue;
		}
		if (selected.length >= maximumCollectionTargets) return null;
		selected.push(candidate);
	}
	if (selected.length === 0) return null;
	if (selected.length === 1) {
		const [{ candidate, confidence }] = selected;
		return resolutionFromCandidate(candidate, confidence, clientGeometry);
	}

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
