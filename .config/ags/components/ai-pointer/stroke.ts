import {
	type PointerPosition,
	type SelectionGeometry,
	paddedSelectionGeometry,
	validatedSelectionGeometry,
} from "./selection";

export const maximumStrokePoints = 1_024;
export const minimumStrokePointDistance = 2;
export const minimumStrokeSpan = 8;
export const strokeBrushRadius = 32;
export const strokeCapturePadding = strokeBrushRadius;
const displayPointSpacing = 28;
const maximumDisplayStrokePoints = 4_096;

export interface PointerStroke {
	points: PointerPosition[];
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export interface CubicStrokeSegment {
	control1: PointerPosition;
	control2: PointerPosition;
	end: PointerPosition;
	start: PointerPosition;
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

export function resampledStrokePoints(
	points: PointerPosition[],
	spacing = displayPointSpacing,
): PointerPosition[] {
	if (points.length < 2 || spacing <= 0) return [...points];

	let pathLength = 0;
	for (let index = 1; index < points.length; index += 1)
		pathLength += Math.hypot(
			points[index].x - points[index - 1].x,
			points[index].y - points[index - 1].y,
		);
	const effectiveSpacing = Math.max(
		spacing,
		pathLength / (maximumDisplayStrokePoints - 1),
	);
	const resampled = [points[0]];
	let distanceToNext = effectiveSpacing;

	for (let index = 1; index < points.length; index += 1) {
		const endpoint = points[index];
		let start = points[index - 1];
		let segmentLength = Math.hypot(endpoint.x - start.x, endpoint.y - start.y);
		while (segmentLength >= distanceToNext && resampled.length < maximumDisplayStrokePoints - 1) {
			const ratio = distanceToNext / segmentLength;
			start = {
				x: start.x + (endpoint.x - start.x) * ratio,
				y: start.y + (endpoint.y - start.y) * ratio,
			};
			resampled.push(start);
			segmentLength -= distanceToNext;
			distanceToNext = effectiveSpacing;
		}
		distanceToNext -= segmentLength;
	}

	const endpoint = points.at(-1);
	const last = resampled.at(-1);
	if (endpoint && last && (endpoint.x !== last.x || endpoint.y !== last.y)) resampled.push(endpoint);
	return resampled;
}

export function representativeStrokePoints(
	points: PointerPosition[],
	maximumPoints: number,
): PointerPosition[] {
	if (points.length <= maximumPoints || maximumPoints < 2) return [...points];

	const cumulativeLengths = [0];
	for (let index = 1; index < points.length; index += 1)
		cumulativeLengths.push(
			cumulativeLengths[index - 1] +
				Math.hypot(
					points[index].x - points[index - 1].x,
					points[index].y - points[index - 1].y,
				),
		);
	const pathLength = cumulativeLengths.at(-1) ?? 0;
	if (pathLength === 0) return [points[0]];

	const representatives: PointerPosition[] = [];
	let segmentIndex = 1;
	for (let index = 0; index < maximumPoints; index += 1) {
		const targetLength = (pathLength * index) / (maximumPoints - 1);
		while (
			segmentIndex < cumulativeLengths.length - 1 &&
			cumulativeLengths[segmentIndex] < targetLength
		)
			segmentIndex += 1;
		const startLength = cumulativeLengths[segmentIndex - 1];
		const endLength = cumulativeLengths[segmentIndex];
		const ratio = endLength === startLength
			? 0
			: (targetLength - startLength) / (endLength - startLength);
		const start = points[segmentIndex - 1];
		const end = points[segmentIndex];
		representatives.push({
			x: start.x + (end.x - start.x) * ratio,
			y: start.y + (end.y - start.y) * ratio,
		});
	}
	return representatives;
}

export function bsplineStrokeSegments(points: PointerPosition[]): CubicStrokeSegment[] {
	if (points.length < 2) return [];
	const controls = [points[0], points[0], ...points, points.at(-1)!, points.at(-1)!];
	const segments: CubicStrokeSegment[] = [];
	for (let index = 0; index < controls.length - 3; index += 1) {
		const [p0, p1, p2, p3] = controls.slice(index, index + 4);
		segments.push({
			start: weightedPoint(p0, 1, p1, 4, p2, 1),
			control1: weightedPoint(p1, 4, p2, 2),
			control2: weightedPoint(p1, 2, p2, 4),
			end: weightedPoint(p1, 1, p2, 4, p3, 1),
		});
	}
	return segments;
}

export function subdivideStrokeSegments(
	segments: CubicStrokeSegment[],
	depth = 2,
): CubicStrokeSegment[] {
	let subdivided = segments;
	for (let pass = 0; pass < depth; pass += 1)
		subdivided = subdivided.flatMap((segment) => splitCubicSegment(segment));
	return subdivided;
}

export function temporalTrailFade(ageMs: number, lifetimeMs: number): number {
	if (lifetimeMs <= 0 || ageMs >= lifetimeMs) return 0;
	if (ageMs <= 0) return 1;
	const remaining = 1 - ageMs / lifetimeMs;
	return remaining * remaining * (3 - 2 * remaining);
}

function splitCubicSegment(segment: CubicStrokeSegment): CubicStrokeSegment[] {
	const startControl = midpoint(segment.start, segment.control1);
	const centerControl = midpoint(segment.control1, segment.control2);
	const endControl = midpoint(segment.control2, segment.end);
	const leftControl = midpoint(startControl, centerControl);
	const rightControl = midpoint(centerControl, endControl);
	const center = midpoint(leftControl, rightControl);
	return [
		{
			start: segment.start,
			control1: startControl,
			control2: leftControl,
			end: center,
		},
		{
			start: center,
			control1: rightControl,
			control2: endControl,
			end: segment.end,
		},
	];
}

function midpoint(left: PointerPosition, right: PointerPosition): PointerPosition {
	return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

function weightedPoint(
	first: PointerPosition,
	firstWeight: number,
	second: PointerPosition,
	secondWeight: number,
	third?: PointerPosition,
	thirdWeight = 0,
): PointerPosition {
	const totalWeight = firstWeight + secondWeight + thirdWeight;
	return {
		x: (first.x * firstWeight + second.x * secondWeight + (third?.x ?? 0) * thirdWeight) / totalWeight,
		y: (first.y * firstWeight + second.y * secondWeight + (third?.y ?? 0) * thirdWeight) / totalWeight,
	};
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
