export interface SelectionGeometry {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface PointerPosition {
	x: number;
	y: number;
}

export interface PromptDimensions {
	height: number;
	width: number;
}

export function selectionEquals(
	left: SelectionGeometry | null,
	right: SelectionGeometry,
): boolean {
	return (
		left?.x === right.x &&
		left.y === right.y &&
		left.width === right.width &&
		left.height === right.height
	);
}

export const maximumSelectionPixels = 32_000_000;
export const clickFallbackSize = 256;
export const clickTargetMaximumSize = 384;
export const clickTargetPadding = 24;
const promptSelectionGap = 24;

export function validatedSelectionGeometry(
	x: number,
	y: number,
	width: number,
	height: number,
): SelectionGeometry | null {
	if (
		Number.isSafeInteger(x) === false ||
		Number.isSafeInteger(y) === false ||
		Number.isSafeInteger(width) === false ||
		Number.isSafeInteger(height) === false ||
		width <= 0 ||
		height <= 0 ||
		width * height > maximumSelectionPixels
	)
		return null;

	return { x, y, width, height };
}

export function paddedSelectionGeometry(
	geometry: SelectionGeometry,
	padding: number,
): SelectionGeometry | null {
	return validatedSelectionGeometry(
		geometry.x - padding,
		geometry.y - padding,
		geometry.width + padding * 2,
		geometry.height + padding * 2,
	);
}

export function containsSelectionCenter(
	container: SelectionGeometry,
	selection: SelectionGeometry,
	tolerance = 0,
): boolean {
	const centerX = selection.x + selection.width / 2;
	const centerY = selection.y + selection.height / 2;
	return (
		centerX >= container.x - tolerance &&
		centerX < container.x + container.width + tolerance &&
		centerY >= container.y - tolerance &&
		centerY < container.y + container.height + tolerance
	);
}

export function selectionFromPoints(
	start: PointerPosition,
	end: PointerPosition,
): SelectionGeometry | null {
	const x = Math.min(start.x, end.x);
	const y = Math.min(start.y, end.y);
	const width = Math.abs(end.x - start.x);
	const height = Math.abs(end.y - start.y);
	return validatedSelectionGeometry(x, y, width, height);
}

export function clickFallbackGeometry(
	point: PointerPosition,
	monitor: SelectionGeometry,
): SelectionGeometry | null {
	return boundedGeometryAroundPoint(
		point,
		{
			x: point.x - clickFallbackSize / 2,
			y: point.y - clickFallbackSize / 2,
			width: clickFallbackSize,
			height: clickFallbackSize,
		},
		monitor,
		clickFallbackSize,
	);
}

export function clickTargetGeometry(
	point: PointerPosition,
	target: SelectionGeometry,
	monitor: SelectionGeometry,
): SelectionGeometry | null {
	const padded = paddedSelectionGeometry(target, clickTargetPadding);
	if (!padded) return null;
	return boundedGeometryAroundPoint(point, padded, monitor, clickTargetMaximumSize);
}

function boundedGeometryAroundPoint(
	point: PointerPosition,
	desired: SelectionGeometry,
	bounds: SelectionGeometry,
	maximumSize: number,
): SelectionGeometry | null {
	if (containsPoint(bounds, point) === false) return null;
	const width = Math.min(desired.width, maximumSize, bounds.width);
	const height = Math.min(desired.height, maximumSize, bounds.height);
	const desiredX = desired.width > width ? point.x - Math.floor(width / 2) : desired.x;
	const desiredY = desired.height > height ? point.y - Math.floor(height / 2) : desired.y;
	const x = Math.min(Math.max(desiredX, bounds.x), bounds.x + bounds.width - width);
	const y = Math.min(Math.max(desiredY, bounds.y), bounds.y + bounds.height - height);
	return validatedSelectionGeometry(x, y, width, height);
}

export function containsPoint(geometry: SelectionGeometry, point: PointerPosition): boolean {
	return (
		point.x >= geometry.x &&
		point.x < geometry.x + geometry.width &&
		point.y >= geometry.y &&
		point.y < geometry.y + geometry.height
	);
}

export function promptPosition(
	selection: SelectionGeometry,
	monitor: SelectionGeometry,
	prompt: PromptDimensions,
): PointerPosition {
	const edgePadding = 16;
	const centerX = selection.x + selection.width / 2;
	const centerY = selection.y + selection.height / 2;
	const left = monitor.x + edgePadding;
	const top = monitor.y + edgePadding;
	const right = monitor.x + monitor.width - edgePadding;
	const bottom = monitor.y + monitor.height - edgePadding;
	const centeredX = clamp(centerX - prompt.width / 2, left, right - prompt.width);
	const centeredY = clamp(centerY - prompt.height / 2, top, bottom - prompt.height);
	const aboveY = selection.y - promptSelectionGap - prompt.height;
	if (aboveY >= top) return { x: centeredX, y: aboveY };

	const belowY = selection.y + selection.height + promptSelectionGap;
	if (belowY + prompt.height <= bottom) return { x: centeredX, y: belowY };

	const rightX = selection.x + selection.width + promptSelectionGap;
	if (rightX + prompt.width <= right) return { x: rightX, y: centeredY };

	const leftX = selection.x - promptSelectionGap - prompt.width;
	if (leftX >= left) return { x: leftX, y: centeredY };

	return { x: centeredX, y: top };
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function grimGeometry({ x, y, width, height }: SelectionGeometry): string {
	return `${x},${y} ${width}x${height}`;
}
