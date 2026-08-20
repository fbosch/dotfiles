import Atspi from "gi://Atspi?version=2.0";
import GLib from "gi://GLib?version=2.0";
import {
	accessibilityCoordinateSpace as coordinateSpace,
	accessibilityProtocolVersion as protocolVersion,
} from "./accessibility-helper-protocol";
import {
	parseAccessibilityHelperInput,
	type AccessibilityHelperInput as HelperInput,
	type HelperGeometry as Geometry,
} from "./accessibility-helper-input";
import { isEligibleAccessibilityRole } from "./accessibility-target-roles";
import {
	chooseAccessibilityWindow,
	type AccessibilityWindowCandidate,
} from "./accessibility-window-policy";
import {
	pointInStrokeRegion,
	representativeStrokePoints,
	strokeRegionContainsGeometry,
	strokeSelectionRegion,
	type StrokeSelectionRegion,
} from "./stroke";

const maximumApplications = 32;
const maximumWindows = 32;
const maximumAncestorDepth = 32;
const maximumTraversalDepth = 16;
const maximumTraversalNodes = 512;
const maximumChildrenPerNode = 128;
const maximumTraversalDurationMs = 350;
const maximumCandidates = 24;
const maximumHitCount = 24;
const maximumUrlLength = 512;
const strokeSampleAnchors = 9;
const interiorGridDivisions = 4;
const maximumHitPoints = 40;
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

function validInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value);
}

function visible(accessible: Atspi.Accessible): boolean {
	const states = accessible.get_state_set();
	return (
		states.contains(Atspi.StateType.VISIBLE) &&
		states.contains(Atspi.StateType.SHOWING) &&
		states.contains(Atspi.StateType.DEFUNCT) === false &&
		states.contains(Atspi.StateType.STALE) === false
	);
}

function active(accessible: Atspi.Accessible): boolean {
	try {
		const states = accessible.get_state_set();
		return states.contains(Atspi.StateType.ACTIVE) || states.contains(Atspi.StateType.FOCUSED);
	} catch {
		return false;
	}
}

function rectangle(accessible: Atspi.Accessible): Geometry | null {
	const component = accessible.get_component_iface();
	if (!component) return null;
	const extents = component.get_extents(Atspi.CoordType.WINDOW);
	const geometry = {
		x: Math.round(extents.x),
		y: Math.round(extents.y),
		width: Math.round(extents.width),
		height: Math.round(extents.height),
	};
	if (
		validInteger(geometry.x) === false ||
		validInteger(geometry.y) === false ||
		validInteger(geometry.width) === false ||
		validInteger(geometry.height) === false ||
		geometry.width <= 0 ||
		geometry.height <= 0
	)
		return null;
	return geometry;
}

function intersects(left: Geometry, right: Geometry): boolean {
	return (
		Math.min(left.x + left.width, right.x + right.width) > Math.max(left.x, right.x) &&
		Math.min(left.y + left.height, right.y + right.height) > Math.max(left.y, right.y)
	);
}

function matchingWindow(
	desktop: Atspi.Accessible,
	input: HelperInput,
	timings: HelperTimings,
): Atspi.Accessible | null {
	const applications = measure(timings.applicationDiscovery, () => {
		let childCount: number;
		try {
			childCount = desktop.get_child_count();
		} catch {
			return null;
		}
		if (childCount < 0 || childCount > maximumApplications) return null;
		const discovered: Array<{ accessible: Atspi.Accessible; exactPid: boolean }> = [];
		for (let index = 0; index < childCount; index += 1) {
			try {
				const application = desktop.get_child_at_index(index);
				if (!application) return null;
				let exactPid = false;
				try {
					exactPid = application.get_process_id() === input.pid;
				} catch {
					// PID-less applications remain eligible for the conservative fallback.
				}
				discovered.push({ accessible: application, exactPid });
			} catch {
				return null;
			}
		}
		return discovered;
	});
	if (!applications) return null;
	return measure(timings.windowMatching, () => {
		const candidates: AccessibilityWindowCandidate<Atspi.Accessible>[] = [];
		for (const { accessible, exactPid } of applications) {
			const matches = matchingApplicationWindows(accessible, input);
			if (!matches) return null;
			candidates.push(...matches.map((candidate) => ({ ...candidate, exactPid })));
		}
		return chooseAccessibilityWindow(candidates);
	});
}

function matchingApplicationWindows(
	application: Atspi.Accessible,
	input: HelperInput,
): Array<{ active: boolean; titleMatch: boolean; value: Atspi.Accessible }> | null {
	let childCount: number;
	try {
		childCount = application.get_child_count();
	} catch {
		return null;
	}
	if (childCount < 0 || childCount > maximumWindows) return null;
	const tolerance = Math.max(32, Math.round(Math.max(input.windowWidth, input.windowHeight) * 0.05));
	const matches: Array<{ active: boolean; titleMatch: boolean; value: Atspi.Accessible }> = [];
	for (let index = 0; index < childCount; index += 1) {
		try {
			const window = application.get_child_at_index(index);
			if (!window) return null;
			if (visible(window) === false) continue;
			const geometry = rectangle(window);
			if (!geometry) continue;
			if (
				Math.abs(geometry.width - input.windowWidth) <= tolerance &&
				Math.abs(geometry.height - input.windowHeight) <= tolerance
			)
				matches.push({
					active: active(window),
					titleMatch: input.windowTitle !== undefined && boundedName(window) === input.windowTitle,
					value: window,
				});
		} catch {
			return null;
		}
	}
	return matches;
}

function hitPoints(input: HelperInput): HitPoint[] {
	const { selection, stroke, windowWidth, windowHeight } = input;
	const region = strokeSelectionRegion(stroke.points, stroke.radius);
	const center = {
		x: Math.round(selection.x + selection.width / 2),
		y: Math.round(selection.y + selection.height / 2),
	};
	const points: HitPoint[] = pointInStrokeRegion(region, center)
		? [{ ...center, centerHit: true }]
		: [];
	const anchors = representativeStrokePoints(stroke.points, strokeSampleAnchors);
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

function boundedName(accessible: Atspi.Accessible): string | undefined {
	try {
		const name = accessible.get_name();
		if (!name) return undefined;
		return String(name)
			.slice(0, 512)
			.replace(/[\u0000-\u001f\u007f]/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 160) || undefined;
	} catch {
		return undefined;
	}
}

function boundedUrl(accessible: Atspi.Accessible, role: string): string | undefined {
	if (role !== "link") return undefined;
	try {
		const hyperlink = accessible.get_hyperlink();
		if (!hyperlink || hyperlink.is_valid() === false || hyperlink.get_n_anchors() < 1)
			return undefined;
		const url = hyperlink.get_uri(0).trim();
		if (
			url.length === 0 ||
			url.length > maximumUrlLength ||
			/[\u0000-\u0020\u007f]/.test(url) ||
			/^https?:\/\//i.test(url) === false
		)
			return undefined;
		return url;
	} catch {
		return undefined;
	}
}

function insideWindow(geometry: Geometry, input: HelperInput): boolean {
	return (
		geometry.x >= 0 &&
		geometry.y >= 0 &&
		geometry.x + geometry.width <= input.windowWidth &&
		geometry.y + geometry.height <= input.windowHeight
	);
}

function roleName(accessible: Atspi.Accessible): string {
	try {
		return accessible.get_role_name().trim().toLowerCase();
	} catch {
		return "";
	}
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

	for (const point of hitPoints(input)) {
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
				if (accessible === window) {
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
				if (
					addCandidate(candidates, item.accessible, item.role, geometry, point.centerHit, true) ===
					false
				)
					return false;
			}
			return true;
		});
		if (complete === false) return { candidates: [...candidates.values()], complete: false };
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
	const key = `${geometry.x},${geometry.y}:${geometry.width}x${geometry.height}:${role}`;
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

const input = parseAccessibilityHelperInput(ARGV);
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
