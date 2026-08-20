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
export const minimumClosedStrokeSpan = strokeBrushRadius * 2;
export const minimumStrokeClosureGap = 56;
export const maximumStrokeClosureGap = 96;
const displayPointSpacing = 18;
const maximumDisplayStrokePoints = 4_096;
const closedStrokeGapRatio = 0.15;
const minimumClosedPathRatio = 2;
const geometryCoverageSamples = 7;
const polygonBoundaryEpsilon = 0.5;

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

export type StrokeSelectionRegion =
	| {
		kind: "closed";
		points: PointerPosition[];
		radius: number;
		bounds: StrokeRegionBounds;
	}
	| {
		kind: "corridor";
		points: PointerPosition[];
		radius: number;
		bounds: StrokeRegionBounds;
	};

interface StrokeRegionBounds {
	bottom: number;
	left: number;
	right: number;
	top: number;
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

export function isClosedStroke(points: PointerPosition[]): boolean {
	if (points.length < 4) return false;
	const normalized = normalizedStrokePoints(points);
	if (normalized.length < 3) return false;
	const span = strokeSpan(normalized);
	return (
		span >= minimumClosedStrokeSpan &&
		strokePathLength(normalized) >= span * minimumClosedPathRatio &&
		pointDistance(points[0], points.at(-1)!) <= strokeClosureGap(normalized) &&
		strokeSelfIntersects(normalized) === false
	);
}

export function strokeSelectionRegion(
	points: PointerPosition[],
	radius = strokeBrushRadius,
): StrokeSelectionRegion {
	const regionPoints = normalizedStrokePoints(points);
	return {
		kind: isClosedStroke(points) ? "closed" : "corridor",
		points: regionPoints,
		radius,
		bounds: strokeRegionBounds(regionPoints),
	};
}

export function pointInStrokeRegion(
	region: StrokeSelectionRegion,
	point: PointerPosition,
): boolean {
	if (region.points.length === 0) return false;
	const padding = region.kind === "corridor" ? region.radius : polygonBoundaryEpsilon;
	if (
		point.x < region.bounds.left - padding ||
		point.x > region.bounds.right + padding ||
		point.y < region.bounds.top - padding ||
		point.y > region.bounds.bottom + padding
	)
		return false;
	if (region.kind === "closed" && pointInPolygon(region.points, point)) return true;
	const segmentCount = region.kind === "closed" ? region.points.length : region.points.length - 1;
	const maximumDistance = region.kind === "closed" ? polygonBoundaryEpsilon : region.radius;
	for (let index = 0; index < segmentCount; index += 1) {
		const start = region.points[index];
		const end = region.points[(index + 1) % region.points.length];
		if (pointToSegmentDistanceSquared(point, start, end) <= maximumDistance * maximumDistance)
			return true;
	}
	return region.points.length === 1 && pointDistance(point, region.points[0]) <= region.radius;
}

export function strokeRegionGeometryCoverage(
	region: StrokeSelectionRegion,
	geometry: SelectionGeometry,
): number {
	let included = 0;
	for (let row = 0; row < geometryCoverageSamples; row += 1) {
		for (let column = 0; column < geometryCoverageSamples; column += 1) {
			if (
				pointInStrokeRegion(region, {
					x: geometry.x + (geometry.width * column) / (geometryCoverageSamples - 1),
					y: geometry.y + (geometry.height * row) / (geometryCoverageSamples - 1),
				})
			)
				included += 1;
		}
	}
	return included / (geometryCoverageSamples * geometryCoverageSamples);
}

export function strokeRegionContainsGeometry(
	region: StrokeSelectionRegion,
	geometry: SelectionGeometry,
): boolean {
	return (
		pointInStrokeRegion(region, {
			x: geometry.x + geometry.width / 2,
			y: geometry.y + geometry.height / 2,
		}) || strokeRegionGeometryCoverage(region, geometry) >= 0.5
	);
}

function strokeClosureGap(points: PointerPosition[]): number {
	return Math.min(
		maximumStrokeClosureGap,
		Math.max(minimumStrokeClosureGap, strokeSpan(points) * closedStrokeGapRatio),
	);
}

function strokeSpan(points: PointerPosition[]): number {
	const width = Math.max(...points.map(({ x }) => x)) - Math.min(...points.map(({ x }) => x));
	const height = Math.max(...points.map(({ y }) => y)) - Math.min(...points.map(({ y }) => y));
	return Math.max(width, height);
}

function strokePathLength(points: PointerPosition[]): number {
	let length = 0;
	for (let index = 1; index < points.length; index += 1)
		length += pointDistance(points[index - 1], points[index]);
	return length;
}

function strokeSelfIntersects(points: PointerPosition[]): boolean {
	for (let first = 0; first < points.length; first += 1) {
		for (let second = first + 1; second < points.length; second += 1) {
			const adjacent = second === first + 1 || (first === 0 && second === points.length - 1);
			if (adjacent) continue;
			if (
				segmentsIntersect(
					points[first],
					points[(first + 1) % points.length],
					points[second],
					points[(second + 1) % points.length],
				)
			)
				return true;
		}
	}
	return false;
}

function segmentsIntersect(
	firstStart: PointerPosition,
	firstEnd: PointerPosition,
	secondStart: PointerPosition,
	secondEnd: PointerPosition,
): boolean {
	const firstOrientation = Math.sign(segmentOrientation(firstStart, firstEnd, secondStart));
	const secondOrientation = Math.sign(segmentOrientation(firstStart, firstEnd, secondEnd));
	const thirdOrientation = Math.sign(segmentOrientation(secondStart, secondEnd, firstStart));
	const fourthOrientation = Math.sign(segmentOrientation(secondStart, secondEnd, firstEnd));
	if (
		firstOrientation !== 0 &&
		secondOrientation !== 0 &&
		thirdOrientation !== 0 &&
		fourthOrientation !== 0 &&
		firstOrientation !== secondOrientation &&
		thirdOrientation !== fourthOrientation
	)
		return true;
	return (
		(firstOrientation === 0 && pointOnSegment(secondStart, firstStart, firstEnd)) ||
		(secondOrientation === 0 && pointOnSegment(secondEnd, firstStart, firstEnd)) ||
		(thirdOrientation === 0 && pointOnSegment(firstStart, secondStart, secondEnd)) ||
		(fourthOrientation === 0 && pointOnSegment(firstEnd, secondStart, secondEnd))
	);
}

function segmentOrientation(
	start: PointerPosition,
	end: PointerPosition,
	point: PointerPosition,
): number {
	return (
		(end.x - start.x) * (point.y - start.y) -
		(end.y - start.y) * (point.x - start.x)
	);
}

function pointOnSegment(
	point: PointerPosition,
	start: PointerPosition,
	end: PointerPosition,
): boolean {
	return (
		point.x >= Math.min(start.x, end.x) &&
		point.x <= Math.max(start.x, end.x) &&
		point.y >= Math.min(start.y, end.y) &&
		point.y <= Math.max(start.y, end.y)
	);
}

function strokeRegionBounds(points: PointerPosition[]): StrokeRegionBounds {
	return {
		bottom: Math.max(...points.map(({ y }) => y)),
		left: Math.min(...points.map(({ x }) => x)),
		right: Math.max(...points.map(({ x }) => x)),
		top: Math.min(...points.map(({ y }) => y)),
	};
}

function normalizedStrokePoints(points: PointerPosition[]): PointerPosition[] {
	const normalized: PointerPosition[] = [];
	for (const point of points) {
		const previous = normalized.at(-1);
		if (!previous || previous.x !== point.x || previous.y !== point.y) normalized.push(point);
	}
	const first = normalized[0];
	const last = normalized.at(-1);
	if (
		normalized.length > 1 &&
		first &&
		last &&
		first.x === last.x &&
		first.y === last.y
	)
		normalized.pop();
	return normalized;
}

function pointInPolygon(points: PointerPosition[], point: PointerPosition): boolean {
	let inside = false;
	for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
		const currentPoint = points[index];
		const previousPoint = points[previous];
		if (
			(currentPoint.y > point.y) !== (previousPoint.y > point.y) &&
			point.x <
				((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
					(previousPoint.y - currentPoint.y) +
					currentPoint.x
		)
			inside = !inside;
	}
	return inside;
}

function pointToSegmentDistanceSquared(
	point: PointerPosition,
	start: PointerPosition,
	end: PointerPosition,
): number {
	const segmentX = end.x - start.x;
	const segmentY = end.y - start.y;
	if (segmentX === 0 && segmentY === 0) return pointDistanceSquared(point, start);
	const ratio = Math.max(
		0,
		Math.min(
			1,
			((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) /
				(segmentX * segmentX + segmentY * segmentY),
		),
	);
	return pointDistanceSquared(point, {
		x: start.x + ratio * segmentX,
		y: start.y + ratio * segmentY,
	});
}

function pointDistanceSquared(left: PointerPosition, right: PointerPosition): number {
	const x = right.x - left.x;
	const y = right.y - left.y;
	return x * x + y * y;
}

function pointDistance(left: PointerPosition, right: PointerPosition): number {
	return Math.hypot(right.x - left.x, right.y - left.y);
}

export function closedBsplineStrokeSegments(points: PointerPosition[]): CubicStrokeSegment[] {
	if (points.length < 4) return [];
	const controls = points.slice(0, -1);
	if (controls.length < 3) return [];
	const segments: CubicStrokeSegment[] = [];
	for (let index = 0; index < controls.length; index += 1) {
		const p0 = controls[(index - 1 + controls.length) % controls.length];
		const p1 = controls[index];
		const p2 = controls[(index + 1) % controls.length];
		const p3 = controls[(index + 2) % controls.length];
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
