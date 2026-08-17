import type {
	AccessibilityEvaluation,
	AccessibleCandidate,
} from "./accessibility-policy";
import {
	clickTargetGeometry,
	containsPoint,
	type PointerPosition,
	type SelectionGeometry,
	validatedSelectionGeometry,
} from "./selection";

const maximumDiagnostics = 12;
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
const actionRoles = new Set([
	"check box",
	"combo box",
	"entry",
	"link",
	"menu item",
	"page tab",
	"push button",
	"radio button",
	"slider",
	"spin button",
	"toggle button",
]);

export function evaluateAccessibleClick(
	point: PointerPosition,
	candidates: AccessibleCandidate[],
	clientGeometry: SelectionGeometry,
	monitorGeometry: SelectionGeometry,
): AccessibilityEvaluation {
	const evaluated = candidates.map((candidate) => ({
		candidate,
		reason: candidateReason(point, candidate, clientGeometry),
	}));
	const selected = evaluated
		.filter(({ reason }) => reason === "eligible")
		.map(({ candidate }) => candidate)
		.sort((left, right) =>
			rolePriority(left.role) - rolePriority(right.role) ||
			left.geometry.width * left.geometry.height - right.geometry.width * right.geometry.height ||
			Number(Boolean(right.name)) - Number(Boolean(left.name)),
		)[0];
	const geometry = selected
		? clickTargetGeometry(point, selected.geometry, monitorGeometry)
		: null;
	const resolution = selected && geometry
		? {
			geometry,
			metadata: {
				centerHit: selected.centerHit,
				confidence: 1,
				hitCount: selected.hitCount ?? 1,
				name: selected.name,
				role: selected.role,
				targetGeometry: selected.geometry,
				url: selected.url,
			},
		}
		: null;
	const selectedKey = selected ? candidateKey(selected) : null;
	return {
		diagnostics: evaluated
			.map(({ candidate, reason }) => ({
				centerHit: candidate.centerHit === true,
				confidence: reason === "eligible" ? 1 : undefined,
				geometry: candidate.geometry,
				hitCount: candidate.hitCount ?? 1,
				name: candidate.name,
				reason,
				role: candidate.role,
				selected: selectedKey === candidateKey(candidate),
			}))
			.sort((left, right) =>
				Number(right.selected) - Number(left.selected) ||
				(right.confidence ?? -1) - (left.confidence ?? -1) ||
				left.geometry.width * left.geometry.height - right.geometry.width * right.geometry.height,
			)
			.slice(0, maximumDiagnostics),
		resolution,
	};
}

function candidateReason(
	point: PointerPosition,
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
	if (candidate.centerHit !== true || containsPoint(geometry, point) === false) return "not at click";
	return "eligible";
}

function rolePriority(role: string): number {
	const normalized = role.trim().toLowerCase();
	if (actionRoles.has(normalized)) return 0;
	if (normalized === "icon" || normalized === "image") return 1;
	return 2;
}

function containsGeometry(container: SelectionGeometry, target: SelectionGeometry): boolean {
	return (
		target.x >= container.x &&
		target.y >= container.y &&
		target.x + target.width <= container.x + container.width &&
		target.y + target.height <= container.y + container.height
	);
}

function candidateKey(candidate: AccessibleCandidate): string {
	const { x, y, width, height } = candidate.geometry;
	return `${x},${y}:${width}x${height}:${candidate.role}:${candidate.name ?? ""}`;
}
