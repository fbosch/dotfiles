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

export function grimGeometry({ x, y, width, height }: SelectionGeometry): string {
	return `${x},${y} ${width}x${height}`;
}
