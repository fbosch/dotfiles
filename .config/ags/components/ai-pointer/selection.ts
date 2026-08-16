export interface SelectionGeometry {
	x: number;
	y: number;
	width: number;
	height: number;
}

export const maximumSelectionPixels = 32_000_000;

export function parseSelectionGeometry(output: string): SelectionGeometry | null {
	const match = output.match(/^(-?\d+),(-?\d+) (\d+)x(\d+)\n?$/);
	if (!match) return null;

	const [x, y, width, height] = match.slice(1).map(Number);
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
