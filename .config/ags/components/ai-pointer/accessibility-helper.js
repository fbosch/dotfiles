import Atspi from "gi://Atspi?version=2.0";

const maximumApplications = 32;
const maximumWindows = 32;
const maximumAncestorDepth = 10;
const maximumCandidates = 24;
const callTimeoutMs = 100;
const protocolVersion = 1;
const coordinateSpace = "window";
const excludedRoles = new Set(["application", "desktop frame", "frame", "password text", "window"]);

function validInteger(value) {
	return Number.isSafeInteger(value);
}

function parseInput() {
	if (ARGV.length !== 1) return null;
	try {
		const input = JSON.parse(ARGV[0]);
		if (
			typeof input !== "object" ||
			input === null ||
			input.protocolVersion !== protocolVersion ||
			input.coordinateSpace !== coordinateSpace ||
			validInteger(input.pid) === false ||
			input.pid <= 0 ||
			validInteger(input.windowWidth) === false ||
			validInteger(input.windowHeight) === false ||
			input.windowWidth <= 0 ||
			input.windowHeight <= 0 ||
			typeof input.selection !== "object" ||
			input.selection === null ||
			["x", "y", "width", "height"].some(
				(key) => validInteger(input.selection[key]) === false,
			) ||
			input.selection.width <= 0 ||
			input.selection.height <= 0
		)
			return null;
		return input;
	} catch {
		return null;
	}
}

function visible(accessible) {
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

function active(accessible) {
	try {
		const states = accessible.get_state_set();
		return states.contains(Atspi.StateType.ACTIVE) || states.contains(Atspi.StateType.FOCUSED);
	} catch {
		return false;
	}
}

function rectangle(accessible) {
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

function intersects(left, right) {
	return (
		Math.min(left.x + left.width, right.x + right.width) > Math.max(left.x, right.x) &&
		Math.min(left.y + left.height, right.y + right.height) > Math.max(left.y, right.y)
	);
}

function matchingWindow(desktop, input) {
	let childCount;
	try {
		childCount = desktop.get_child_count();
	} catch {
		return null;
	}
	const exactMatches = [];
	const activeMatches = [];
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

function matchingApplicationWindows(application, input) {
	let childCount;
	try {
		childCount = application.get_child_count();
	} catch {
		return [];
	}
	const tolerance = Math.max(32, Math.round(Math.max(input.windowWidth, input.windowHeight) * 0.05));
	const matches = [];
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

function hitPoints(selection, windowWidth, windowHeight) {
	const fractions = [
		[0.5, 0.5],
		[0.25, 0.25],
		[0.75, 0.25],
		[0.25, 0.75],
		[0.75, 0.75],
	];
	return fractions
		.map(([xFraction, yFraction]) => ({
			x: Math.round(selection.x + selection.width * xFraction),
			y: Math.round(selection.y + selection.height * yFraction),
		}))
		.filter((point) => point.x >= 0 && point.x < windowWidth && point.y >= 0 && point.y < windowHeight);
}

function boundedName(accessible) {
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

function insideWindow(geometry, input) {
	return (
		geometry.x >= 0 &&
		geometry.y >= 0 &&
		geometry.x + geometry.width <= input.windowWidth &&
		geometry.y + geometry.height <= input.windowHeight
	);
}

function roleName(accessible) {
	try {
		return accessible.get_role_name().trim().toLowerCase();
	} catch {
		return "";
	}
}

function collectCandidates(window, input) {
	const candidates = [];
	const seen = new Set();
	let component;
	try {
		component = window.get_component_iface();
	} catch {
		return candidates;
	}
	if (!component) return candidates;

	for (const point of hitPoints(input.selection, input.windowWidth, input.windowHeight)) {
		let accessible;
		try {
			accessible = component.get_accessible_at_point(point.x, point.y, Atspi.CoordType.WINDOW);
		} catch {
			continue;
		}
		const path = [];
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
			if (!item.role || excludedRoles.has(item.role) || seen.has(key)) continue;
			seen.add(key);
			candidates.push({ geometry, role: item.role, name: boundedName(item.accessible) });
			if (candidates.length >= maximumCandidates) return candidates;
		}
	}
	return candidates;
}

const input = parseInput();
let initialized = false;
let candidates = [];
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
