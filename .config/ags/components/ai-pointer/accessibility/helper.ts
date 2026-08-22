import Atspi from "gi://Atspi?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { decodeAccessibilityHelperArgument } from "./helper-argument";
import {
	boundedName,
	boundedUrl,
	insideWindow,
	intersects,
	rectangle,
	roleName,
	visible,
} from "./helper-candidate";
import {
	accessibilityCoordinateSpace as coordinateSpace,
	accessibilityProtocolVersion as protocolVersion,
} from "./helper-protocol";
import {
	parseAccessibilityHelperInput,
	type AccessibilityHelperInput as HelperInput,
	type HelperGeometry as Geometry,
} from "./helper-input";
import { isEligibleAccessibilityRole } from "./target-roles";
import { matchesInputWindowFrame } from "./window-policy";
import { matchingWindow } from "./window-discovery";
import {
	pointInStrokeRegion,
	representativeStrokePoints,
	strokeRegionContainsGeometry,
	strokeSelectionRegion,
	type StrokeSelectionRegion,
} from "../stroke";

const maximumAncestorDepth = 32;
const maximumTraversalDepth = 16;
const maximumTraversalNodes = 512;
const maximumChildrenPerNode = 128;
const maximumTraversalDurationMs = 350;
const maximumHitPointTraversalDurationMs = 750;
const maximumCandidates = 24;
const maximumHitCount = 24;
const closedStrokeSampleAnchors = 5;
const corridorStrokeSampleAnchors = 8;
const interiorGridDivisions = 4;
const maximumHitPoints = 24;
const callTimeoutMs = 100;
const excludedRoles = new Set([
	"application",
	"desktop frame",
	"frame",
	"password text",
	"window",
]);

interface Candidate {
	centerHit: boolean;
	geometry: Geometry;
	hitCount: number;
	name?: string;
	role: string;
	url?: string;
}

interface HitPoint {
	centerHit: boolean;
	x: number;
	y: number;
}

interface CandidateCollection {
	candidates: Candidate[];
	complete: boolean;
}

interface TraversalItem {
	accessible: Atspi.Accessible;
	depth: number;
}

interface AccessiblePathItem {
	accessible: Atspi.Accessible;
	role: string;
}

interface Timing {
	durationMs: number;
	startMs: number;
}

interface HelperTimings {
	initialization: Timing;
	applicationDiscovery: Timing;
	windowMatching: Timing;
	hitTesting: Timing;
	ancestorTraversal: Timing;
	candidateInspection: Timing;
	serialization: Timing;
}

function nowMs(): number {
	return GLib.get_monotonic_time() / 1000;
}

function initialTimings(): HelperTimings {
	const startMs = nowMs();
	const empty = (): Timing => ({ startMs, durationMs: 0 });
	return {
		initialization: empty(),
		applicationDiscovery: empty(),
		windowMatching: empty(),
		hitTesting: empty(),
		ancestorTraversal: empty(),
		candidateInspection: empty(),
		serialization: empty(),
	};
}

function measure<T>(timing: Timing, operation: () => T): T {
	const startMs = nowMs();
	if (timing.durationMs === 0) timing.startMs = startMs;
	try {
		return operation();
	} finally {
		timing.durationMs += nowMs() - startMs;
	}
}

function hitPoints(input: HelperInput, region: StrokeSelectionRegion): HitPoint[] {
	const { selection, stroke, windowWidth, windowHeight } = input;
	const center = {
		x: Math.round(selection.x + selection.width / 2),
		y: Math.round(selection.y + selection.height / 2),
	};
	const points: HitPoint[] = pointInStrokeRegion(region, center)
		? [{ ...center, centerHit: true }]
		: [];
	const anchors = representativeStrokePoints(
		stroke.points,
		region.kind === "closed" ? closedStrokeSampleAnchors : corridorStrokeSampleAnchors,
	);
	for (let index = 0; index < anchors.length; index += 1) {
		const point = anchors[index];
		const previous = anchors[Math.max(0, index - 1)];
		const next = anchors[Math.min(anchors.length - 1, index + 1)];
		const tangentX = next.x - previous.x;
		const tangentY = next.y - previous.y;
		const tangentLength = Math.hypot(tangentX, tangentY);
		points.push({ centerHit: false, x: Math.round(point.x), y: Math.round(point.y) });
		if (tangentLength === 0) continue;
		const normalX = (-tangentY / tangentLength) * stroke.radius;
		const normalY = (tangentX / tangentLength) * stroke.radius;
		points.push(
			{ centerHit: false, x: Math.round(point.x + normalX), y: Math.round(point.y + normalY) },
			{ centerHit: false, x: Math.round(point.x - normalX), y: Math.round(point.y - normalY) },
		);
	}
	if (region.kind === "closed") {
		for (let row = 0; row < interiorGridDivisions; row += 1) {
			for (let column = 0; column < interiorGridDivisions; column += 1) {
				const point = {
					x: Math.round(
						selection.x + selection.width * ((column + 0.5) / interiorGridDivisions),
					),
					y: Math.round(
						selection.y + selection.height * ((row + 0.5) / interiorGridDivisions),
					),
				};
				if (pointInStrokeRegion(region, point)) points.push({ ...point, centerHit: false });
			}
		}
	}

	const uniquePoints = new Map<string, HitPoint>();
	for (const point of points) {
		if (point.x < 0 || point.x >= windowWidth || point.y < 0 || point.y >= windowHeight)
			continue;
		if (pointInStrokeRegion(region, point) === false) continue;
		const key = `${point.x},${point.y}`;
		const existing = uniquePoints.get(key);
		if (existing) existing.centerHit ||= point.centerHit;
		else if (uniquePoints.size < maximumHitPoints) uniquePoints.set(key, point);
	}
	return [...uniquePoints.values()];
}

function collectCandidates(
	window: Atspi.Accessible,
	input: HelperInput,
	timings: HelperTimings,
): CandidateCollection {
	const candidates = new Map<string, Candidate>();
	const region = strokeSelectionRegion(input.stroke.points, input.stroke.radius);
	let component: Atspi.Component;
	try {
		component = window.get_component_iface();
	} catch {
		return { candidates: [], complete: false };
	}
	if (!component) return { candidates: [], complete: false };

	const unresolvedPoints: HitPoint[] = [];
	for (const point of hitPoints(input, region)) {
		const countedPathCandidates = new Set<string>();
		let accessible: Atspi.Accessible | null;
		try {
			accessible = measure(timings.hitTesting, () =>
				component.get_accessible_at_point(point.x, point.y, Atspi.CoordType.WINDOW)
			);
		} catch {
			return { candidates: [...candidates.values()], complete: false };
		}
		if (!accessible) continue;
		const path: AccessiblePathItem[] = [];
		let pathComplete = false;
		measure(timings.ancestorTraversal, () => {
			for (let depth = 0; accessible && depth < maximumAncestorDepth; depth += 1) {
				if (accessible === window || matchesInputWindow(accessible, input)) {
					pathComplete = true;
					break;
				}
				path.push({ accessible, role: roleName(accessible) });
				try {
					accessible = accessible.get_parent();
				} catch {
					return;
				}
			}
		});
		if (pathComplete === false)
			return { candidates: [...candidates.values()], complete: false };
		if (path.some(({ role }) => !role))
			return { candidates: [...candidates.values()], complete: false };
		if (path.some((item) => item.role === "password text"))
			return { candidates: [], complete: true };
		let foundCandidate = false;
		const complete = measure(timings.candidateInspection, () => {
			for (const item of path) {
				if (visible(item.accessible) === false) continue;
				const geometry = rectangle(item.accessible);
				if (
					!geometry ||
					insideWindow(geometry, input) === false ||
					intersects(geometry, input.selection) === false
				)
					continue;
				if (isEligibleAccessibilityRole(item.role)) foundCandidate = true;
				const key = candidateKey(item.role, geometry);
				if (countedPathCandidates.has(key)) continue;
				countedPathCandidates.add(key);
				if (
					addCandidate(candidates, item.accessible, item.role, geometry, point.centerHit, true) ===
					false
				)
					return false;
			}
			return true;
		});
		if (complete === false)
			return { candidates: [...candidates.values()], complete: false };
		if (foundCandidate === false) unresolvedPoints.push(point);
	}
	if (unresolvedPoints.length > 0) {
		const traversal = collectHitPointCandidates(window, input, unresolvedPoints, candidates, timings);
		if (traversal.blocked) return { candidates: [], complete: true };
		if (traversal.complete === false)
			return { candidates: [...candidates.values()], complete: false };
	}
	if (region.kind === "closed") {
		const traversal = collectClosedRegionCandidates(window, input, region, candidates, timings);
		if (traversal.blocked) return { candidates: [], complete: true };
		if (traversal.complete === false)
			return { candidates: [...candidates.values()], complete: false };
	}
	return {
		candidates: [...candidates.values()].sort((left, right) => right.hitCount - left.hitCount),
		complete: true,
	};
}

function matchesInputWindow(accessible: Atspi.Accessible, input: HelperInput): boolean {
	return matchesInputWindowFrame(roleName(accessible), rectangle(accessible), {
		width: input.windowWidth,
		height: input.windowHeight,
	});
}

function collectHitPointCandidates(
	window: Atspi.Accessible,
	input: HelperInput,
	points: HitPoint[],
	candidates: Map<string, Candidate>,
	timings: HelperTimings,
): { blocked: boolean; complete: boolean } {
	const queue: TraversalItem[] = [];
	const countedHits = new Set<string>();
	if (enqueuePointChildren(window, 1, queue, points) === false)
		return { blocked: false, complete: false };
	const startMs = nowMs();
	let inspected = 0;
	while (queue.length > 0) {
		if (
			inspected >= maximumTraversalNodes ||
			nowMs() - startMs > maximumHitPointTraversalDurationMs
		)
			return { blocked: false, complete: false };
		const item = queue.shift()!;
		inspected += 1;
		const role = measure(timings.ancestorTraversal, () => roleName(item.accessible));
		if (!role) return { blocked: false, complete: false };
		const geometry = measure(timings.candidateInspection, () => rectangle(item.accessible));
		const matchingPoints = geometry
			? points.filter((point) => containsPoint(geometry, point))
			: [];
		if (role === "password text" && matchingPoints.length > 0)
			return { blocked: true, complete: true };
		if (
			visible(item.accessible) &&
			geometry &&
			insideWindow(geometry, input) &&
			matchingPoints.length > 0
		) {
			for (const point of matchingPoints) {
				const hitKey = `${candidateKey(role, geometry!)}:${point.x},${point.y}`;
				if (countedHits.has(hitKey)) continue;
				countedHits.add(hitKey);
				if (
					addCandidate(candidates, item.accessible, role, geometry!, point.centerHit, true) ===
					false
				)
					return { blocked: false, complete: false };
			}
		}
		if (geometry && matchingPoints.length === 0) continue;
		if (item.depth >= maximumTraversalDepth) {
			let childCount = 0;
			try {
				childCount = item.accessible.get_child_count();
			} catch {
				return { blocked: false, complete: false };
			}
			if (childCount > 0) return { blocked: false, complete: false };
			continue;
		}
		if (enqueuePointChildren(item.accessible, item.depth + 1, queue, points) === false)
			return { blocked: false, complete: false };
	}
	return { blocked: false, complete: true };
}

function addCandidate(
	candidates: Map<string, Candidate>,
	accessible: Atspi.Accessible,
	role: string,
	geometry: Geometry,
	centerHit: boolean,
	incrementHit: boolean,
): boolean {
	if (
		!role ||
		excludedRoles.has(role) ||
		isEligibleAccessibilityRole(role) === false
	)
		return true;
	const key = candidateKey(role, geometry);
	const existing = candidates.get(key);
	if (existing) {
		existing.centerHit ||= centerHit;
		if (incrementHit) existing.hitCount = Math.min(existing.hitCount + 1, maximumHitCount);
		return true;
	}
	if (candidates.size >= maximumCandidates) return false;
	candidates.set(key, {
		centerHit,
		geometry,
		hitCount: 1,
		role,
		name: boundedName(accessible),
		url: boundedUrl(accessible, role),
	});
	return true;
}

function candidateKey(role: string, geometry: Geometry): string {
	return `${geometry.x},${geometry.y}:${geometry.width}x${geometry.height}:${role}`;
}

function collectClosedRegionCandidates(
	window: Atspi.Accessible,
	input: HelperInput,
	region: StrokeSelectionRegion,
	candidates: Map<string, Candidate>,
	timings: HelperTimings,
): { blocked: boolean; complete: boolean } {
	const queue: TraversalItem[] = [];
	if (enqueueChildren(window, 1, queue) === false) return { blocked: false, complete: false };
	const startMs = nowMs();
	let inspected = 0;
	while (queue.length > 0) {
		if (
			inspected >= maximumTraversalNodes ||
			nowMs() - startMs > maximumTraversalDurationMs
		)
			return { blocked: false, complete: false };
		const item = queue.shift()!;
		inspected += 1;
		if (visible(item.accessible) === false) continue;
		const role = measure(timings.ancestorTraversal, () => roleName(item.accessible));
		if (!role) return { blocked: false, complete: false };
		if (role === "password text") return { blocked: true, complete: true };
		const geometry = measure(timings.candidateInspection, () => rectangle(item.accessible));
		if (
			geometry &&
			insideWindow(geometry, input) &&
			intersects(geometry, input.selection)
		) {
			if (
				strokeRegionContainsGeometry(region, geometry) &&
				addCandidate(candidates, item.accessible, role, geometry, false, false) === false
			)
				return { blocked: false, complete: false };
		}
		if (item.depth >= maximumTraversalDepth) {
			let childCount = 0;
			try {
				childCount = item.accessible.get_child_count();
			} catch {
				return { blocked: false, complete: false };
			}
			if (childCount > 0) return { blocked: false, complete: false };
			continue;
		}
		if (enqueueChildren(item.accessible, item.depth + 1, queue) === false)
			return { blocked: false, complete: false };
	}
	return { blocked: false, complete: true };
}

function enqueueChildren(
	accessible: Atspi.Accessible,
	depth: number,
	queue: TraversalItem[],
): boolean {
	let childCount: number;
	try {
		childCount = accessible.get_child_count();
	} catch {
		return false;
	}
	if (childCount < 0 || childCount > maximumChildrenPerNode) return false;
	for (let index = 0; index < childCount; index += 1) {
		try {
			const child = accessible.get_child_at_index(index);
			if (!child) return false;
			queue.push({ accessible: child, depth });
		} catch {
			return false;
		}
	}
	return true;
}

function enqueuePointChildren(
	accessible: Atspi.Accessible,
	depth: number,
	queue: TraversalItem[],
	points: HitPoint[],
): boolean {
	let childCount: number;
	try {
		childCount = accessible.get_child_count();
	} catch {
		return false;
	}
	if (childCount < 0 || childCount > maximumTraversalNodes) return false;
	for (let index = 0; index < childCount; index += 1) {
		let child: Atspi.Accessible | null;
		try {
			child = accessible.get_child_at_index(index);
		} catch {
			return false;
		}
		if (!child) return false;
		let geometry: Geometry | null = null;
		try {
			geometry = rectangle(child);
		} catch {
			// Missing geometry cannot safely prune a subtree.
		}
		if (!geometry || points.some((point) => containsPoint(geometry!, point)))
			queue.push({ accessible: child, depth });
	}
	return true;
}

function containsPoint(geometry: Geometry, point: HitPoint): boolean {
	return (
		point.x >= geometry.x &&
		point.x < geometry.x + geometry.width &&
		point.y >= geometry.y &&
		point.y < geometry.y + geometry.height
	);
}

const decodedInput = ARGV.length === 1 ? decodeAccessibilityHelperArgument(ARGV[0]) : null;
const input = parseAccessibilityHelperInput(decodedInput === null ? [] : [decodedInput]);
const timings = initialTimings();
let initialized = false;
let candidates: Candidate[] = [];
let complete = false;
try {
	if (input) {
		const result = measure(timings.initialization, () => Atspi.init());
		initialized = result === 0 || result === 1;
		if (initialized) {
			complete = true;
			Atspi.set_timeout(callTimeoutMs, 0);
			const desktop = Atspi.get_desktop(0);
			const window = matchingWindow(desktop, input, timings);
			if (window) {
				const collection = collectCandidates(window, input, timings);
				candidates = collection.candidates;
				complete = collection.complete;
			}
		}
	}
} catch {
	candidates = [];
	complete = false;
} finally {
	if (initialized) Atspi.exit();
}

const serializedCandidates = measure(timings.serialization, () => JSON.stringify(candidates));
print(
	`{"protocolVersion":${protocolVersion},"coordinateSpace":"${coordinateSpace}","complete":${complete},"candidates":${serializedCandidates},"timings":${JSON.stringify(timings)}}`,
);
