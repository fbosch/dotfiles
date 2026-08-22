import type { PointerPosition, SelectionGeometry } from "../selection";
import { strokeSelectionRegion, type StrokeSelectionRegion } from "../stroke";

interface AccessibilityStroke {
	points: PointerPosition[];
	radius: number;
}

export function accessibilitySelectionRegion(
	selection: SelectionGeometry,
	stroke: AccessibilityStroke,
): StrokeSelectionRegion {
	if (selection.width === 1 && selection.height === 1)
		return strokeSelectionRegion(stroke.points, stroke.radius);
	return selectionBoxRegion(selection);
}

export function selectionBoxRegion(selection: SelectionGeometry): StrokeSelectionRegion {
	const right = selection.x + selection.width;
	const bottom = selection.y + selection.height;
	return {
		kind: "closed",
		points: [
			{ x: selection.x, y: selection.y },
			{ x: right, y: selection.y },
			{ x: right, y: bottom },
			{ x: selection.x, y: bottom },
		],
		radius: 0,
		bounds: {
			left: selection.x,
			top: selection.y,
			right,
			bottom,
		},
	};
}
