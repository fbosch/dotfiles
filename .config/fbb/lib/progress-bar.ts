const partialBlocks = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];

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
	const units = Math.round((clampedPercent / 100) * width * 8);
	const fullCells = Math.floor(units / 8);
	const partialCell = partialBlocks[units % 8];
	return {
		fullCells,
		partialCell,
		emptyCells: width - fullCells - Number(partialCell !== ""),
	};
}
