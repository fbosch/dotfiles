import Atspi from "gi://Atspi?version=2.0";
import type {
	AccessibilityHelperInput,
	HelperGeometry,
} from "./helper-input";

const maximumUrlLength = 512;

export function visible(accessible: Atspi.Accessible): boolean {
	const states = accessible.get_state_set();
	return (
		states.contains(Atspi.StateType.VISIBLE) &&
		states.contains(Atspi.StateType.SHOWING) &&
		states.contains(Atspi.StateType.DEFUNCT) === false &&
		states.contains(Atspi.StateType.STALE) === false
	);
}

export function rectangle(accessible: Atspi.Accessible): HelperGeometry | null {
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
		Number.isSafeInteger(geometry.x) === false ||
		Number.isSafeInteger(geometry.y) === false ||
		Number.isSafeInteger(geometry.width) === false ||
		Number.isSafeInteger(geometry.height) === false ||
		geometry.width <= 0 ||
		geometry.height <= 0
	)
		return null;
	return geometry;
}

export function intersects(left: HelperGeometry, right: HelperGeometry): boolean {
	return (
		Math.min(left.x + left.width, right.x + right.width) > Math.max(left.x, right.x) &&
		Math.min(left.y + left.height, right.y + right.height) > Math.max(left.y, right.y)
	);
}

export function boundedName(accessible: Atspi.Accessible): string | undefined {
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

export function boundedUrl(accessible: Atspi.Accessible, role: string): string | undefined {
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

export function insideWindow(
	geometry: HelperGeometry,
	input: AccessibilityHelperInput,
): boolean {
	return (
		geometry.x >= 0 &&
		geometry.y >= 0 &&
		geometry.x + geometry.width <= input.windowWidth &&
		geometry.y + geometry.height <= input.windowHeight
	);
}

export function roleName(accessible: Atspi.Accessible): string {
	try {
		return accessible.get_role_name().trim().toLowerCase();
	} catch {
		return "";
	}
}
