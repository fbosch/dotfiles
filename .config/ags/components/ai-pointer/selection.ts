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

export const maximumSelectionPixels = 32_000_000;

export function selectionFromPoints(
	start: PointerPosition,
	end: PointerPosition,
): SelectionGeometry | null {
	const x = Math.min(start.x, end.x);
	const y = Math.min(start.y, end.y);
	const width = Math.abs(end.x - start.x);
	const height = Math.abs(end.y - start.y);
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

export function grimGeometry({ x, y, width, height }: SelectionGeometry): string {
	return `${x},${y} ${width}x${height}`;
}
