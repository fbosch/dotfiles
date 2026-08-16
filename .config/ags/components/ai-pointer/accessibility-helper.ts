import Atspi from "gi://Atspi?version=2.0";

const maximumApplications = 32;
const maximumWindows = 32;
const maximumAncestorDepth = 10;
const maximumCandidates = 24;
const maximumHitCount = 9;
const callTimeoutMs = 100;
const protocolVersion = 1;
const coordinateSpace = "window";
const excludedRoles = new Set([
	"application",
	"desktop frame",
	"frame",
	"password text",
	"window",
]);

interface Geometry {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface HelperInput {
	protocolVersion: typeof protocolVersion;
	coordinateSpace: typeof coordinateSpace;
	pid: number;
	windowWidth: number;
	windowHeight: number;
	selection: Geometry;
}

interface Candidate {
	geometry: Geometry;
	hitCount: number;
	name?: string;
	role: string;
}

interface AccessiblePathItem {
	accessible: Atspi.Accessible;
	role: string;
}

function validInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value);
}

function parseInput(): HelperInput | null {
	if (ARGV.length !== 1) return null;
	try {
		const input: unknown = JSON.parse(ARGV[0]);
		if (!isRecord(input) || !isRecord(input.selection)) return null;
		if (
			input.protocolVersion !== protocolVersion ||
			input.coordinateSpace !== coordinateSpace ||
			validInteger(input.pid) === false ||
			input.pid <= 0 ||
			validInteger(input.windowWidth) === false ||
			validInteger(input.windowHeight) === false ||
			input.windowWidth <= 0 ||
			input.windowHeight <= 0 ||
			validInteger(input.selection.x) === false ||
			validInteger(input.selection.y) === false ||
			validInteger(input.selection.width) === false ||
			validInteger(input.selection.height) === false ||
			input.selection.width <= 0 ||
			input.selection.height <= 0
		)
			return null;
		return {
			protocolVersion,
			coordinateSpace,
			pid: input.pid,
			windowWidth: input.windowWidth,
			windowHeight: input.windowHeight,
			selection: {
				x: input.selection.x,
				y: input.selection.y,
				width: input.selection.width,
				height: input.selection.height,
			},
		};
	} catch {
		return null;
	}
}

function visible(accessible: Atspi.Accessible): boolean {
	try {
		const states = accessible.get_state_set();
		return (
			states.contains(Atspi.StateType.VISIBLE) &&
			states.contains(Atspi.StateType.SHOWING) &&
			states.contains(Atspi.StateType.DEFUNCT) === false &&
			states.contains(Atspi.StateType.STALE) === false
		);
	} catch {
		return false;
	}
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
	try {
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
	} catch {
		return null;
	}
}

function intersects(left: Geometry, right: Geometry): boolean {
	return (
		Math.min(left.x + left.width, right.x + right.width) > Math.max(left.x, right.x) &&
		Math.min(left.y + left.height, right.y + right.height) > Math.max(left.y, right.y)
	);
}

function matchingWindow(desktop: Atspi.Accessible, input: HelperInput): Atspi.Accessible | null {
	let childCount: number;
	try {
		childCount = desktop.get_child_count();
	} catch {
		return null;
	}
	const exactMatches: Atspi.Accessible[] = [];
	const activeMatches: Atspi.Accessible[] = [];
	for (let index = 0; index < Math.min(Math.max(childCount, 0), maximumApplications); index += 1) {
		try {
			const application = desktop.get_child_at_index(index);
			if (!application) continue;
			const matches = matchingApplicationWindows(application, input);
			activeMatches.push(...matches);
			if (application.get_process_id() === input.pid) exactMatches.push(...matches);
		} catch {
			// Applications can disappear between registry calls.
		}
	}
	if (exactMatches.length > 0) return exactMatches.length === 1 ? exactMatches[0] : null;
	return activeMatches.length === 1 ? activeMatches[0] : null;
}

function matchingApplicationWindows(
	application: Atspi.Accessible,
	input: HelperInput,
): Atspi.Accessible[] {
	let childCount: number;
	try {
		childCount = application.get_child_count();
	} catch {
		return [];
	}
	const tolerance = Math.max(32, Math.round(Math.max(input.windowWidth, input.windowHeight) * 0.05));
	const matches: Atspi.Accessible[] = [];
	for (let index = 0; index < Math.min(Math.max(childCount, 0), maximumWindows); index += 1) {
		try {
			const window = application.get_child_at_index(index);
			if (!window || visible(window) === false) continue;
			const geometry = rectangle(window);
			if (!geometry) continue;
			if (
				Math.abs(geometry.width - input.windowWidth) <= tolerance &&
				Math.abs(geometry.height - input.windowHeight) <= tolerance &&
				active(window)
			)
				matches.push(window);
		} catch {
			// A volatile top-level is not a usable coordinate reference.
		}
	}
	return matches;
}

function hitPoints(selection: Geometry, windowWidth: number, windowHeight: number): Geometry[] {
	const fractions = [0.2, 0.5, 0.8];
	return fractions
		.flatMap((yFraction) =>
			fractions.map((xFraction) => ({
				x: Math.round(selection.x + selection.width * xFraction),
				y: Math.round(selection.y + selection.height * yFraction),
				width: 1,
				height: 1,
			})),
		)
		.filter((point) => point.x >= 0 && point.x < windowWidth && point.y >= 0 && point.y < windowHeight);
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

function collectCandidates(window: Atspi.Accessible, input: HelperInput): Candidate[] {
	const candidates = new Map<string, Candidate>();
	let component: Atspi.Component;
	try {
		component = window.get_component_iface();
	} catch {
		return [];
	}
	if (!component) return [];

	for (const point of hitPoints(input.selection, input.windowWidth, input.windowHeight)) {
		let accessible: Atspi.Accessible | null;
		try {
			accessible = component.get_accessible_at_point(point.x, point.y, Atspi.CoordType.WINDOW);
		} catch {
			continue;
		}
		const path: AccessiblePathItem[] = [];
		for (let depth = 0; accessible && depth < maximumAncestorDepth; depth += 1) {
			if (accessible === window) break;
			path.push({ accessible, role: roleName(accessible) });
			try {
				accessible = accessible.get_parent();
			} catch {
				break;
			}
		}
		if (path.some((item) => item.role === "password text")) return [];
		for (const item of path) {
			if (visible(item.accessible) === false) continue;
			const geometry = rectangle(item.accessible);
			if (!geometry || insideWindow(geometry, input) === false || intersects(geometry, input.selection) === false)
				continue;
			const key = `${geometry.x},${geometry.y}:${geometry.width}x${geometry.height}:${item.role}`;
			if (!item.role || excludedRoles.has(item.role)) continue;
			const existing = candidates.get(key);
			if (existing) {
				existing.hitCount = Math.min(existing.hitCount + 1, maximumHitCount);
				continue;
			}
			if (candidates.size >= maximumCandidates) continue;
			candidates.set(key, {
				geometry,
				hitCount: 1,
				role: item.role,
				name: boundedName(item.accessible),
			});
		}
	}
	return [...candidates.values()].sort((left, right) => right.hitCount - left.hitCount);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

const input = parseInput();
let initialized = false;
let candidates: Candidate[] = [];
try {
	if (input) {
		const result = Atspi.init();
		initialized = result === 0 || result === 1;
		if (initialized) {
			Atspi.set_timeout(callTimeoutMs, 0);
			const desktop = Atspi.get_desktop(0);
			const window = matchingWindow(desktop, input);
			if (window) candidates = collectCandidates(window, input);
		}
	}
} catch {
	candidates = [];
} finally {
	if (initialized) Atspi.exit();
}

print(JSON.stringify({ protocolVersion, coordinateSpace, candidates }));
