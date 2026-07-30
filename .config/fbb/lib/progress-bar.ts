const filledCell = "━";
const partialCell = "╸";
const emptyCell = "─";

export type ProgressBarSegments = {
	fullCells: number;
	partialCell: string;
	emptyCells: number;
};

export function renderProgressBar(
	percent: number,
	width = 14,
): ProgressBarSegments {
	const clampedPercent = Math.max(0, Math.min(100, percent));
	const cells = (clampedPercent / 100) * width;
	const fullCells = Math.floor(cells);
	const partial = cells - fullCells >= 0.5 ? partialCell : "";
	return {
		fullCells,
		partialCell: partial,
		emptyCells: width - fullCells - Number(partial !== ""),
	};
}

export function filledProgressCells(count: number): string {
	return filledCell.repeat(count);
}

export function emptyProgressCells(count: number): string {
	return emptyCell.repeat(count);
}
