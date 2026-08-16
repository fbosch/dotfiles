import {
	type PointerPosition,
	type SelectionGeometry,
	paddedSelectionGeometry,
	validatedSelectionGeometry,
} from "./selection";

export const maximumStrokePoints = 1_024;
export const minimumStrokePointDistance = 2;
export const minimumStrokeSpan = 8;
export const strokeCapturePadding = 24;

export interface PointerStroke {
	points: PointerPosition[];
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export function createPointerStroke(point: PointerPosition): PointerStroke {
	return {
		points: [point],
		minX: point.x,
		minY: point.y,
		maxX: point.x,
		maxY: point.y,
	};
}

export function appendStrokePoint(
	stroke: PointerStroke,
	point: PointerPosition,
	force = false,
): PointerStroke {
	if (Number.isSafeInteger(point.x) === false || Number.isSafeInteger(point.y) === false)
		return stroke;

	const minX = Math.min(stroke.minX, point.x);
	const minY = Math.min(stroke.minY, point.y);
	const maxX = Math.max(stroke.maxX, point.x);
	const maxY = Math.max(stroke.maxY, point.y);
	const previous = stroke.points.at(-1);
	const distance = previous ? Math.hypot(point.x - previous.x, point.y - previous.y) : 0;
	if (force === false && distance < minimumStrokePointDistance)
		return { ...stroke, minX, minY, maxX, maxY };

	let points = stroke.points;
	if (points.length >= maximumStrokePoints) {
		points = points.filter(
			(_retainedPoint, index) =>
				index === 0 || index === points.length - 1 || index % 2 === 0,
		);
	}

	return { points: [...points, point], minX, minY, maxX, maxY };
}

export function selectionFromStroke(stroke: PointerStroke): SelectionGeometry | null {
	const strokeWidth = stroke.maxX - stroke.minX;
	const strokeHeight = stroke.maxY - stroke.minY;
	if (Math.max(strokeWidth, strokeHeight) < minimumStrokeSpan) return null;
	const width = Math.max(strokeWidth, minimumStrokeSpan);
	const height = Math.max(strokeHeight, minimumStrokeSpan);
	const x = stroke.minX - Math.floor((width - strokeWidth) / 2);
	const y = stroke.minY - Math.floor((height - strokeHeight) / 2);

	const geometry = validatedSelectionGeometry(x, y, width, height);
	return geometry ? paddedSelectionGeometry(geometry, strokeCapturePadding) : null;
}
