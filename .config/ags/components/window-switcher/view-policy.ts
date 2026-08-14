import type { WindowInfo } from "./machine";

const buttonSpacing = 8;

export function truncateWindowTitle(
	title: string,
	availableWidth: number,
): string {
	const maxChars = Math.floor((availableWidth - 12) / 6);
	if (maxChars <= 0) return "…";
	return title.length <= maxChars ? title : `${title.substring(0, maxChars)}…`;
}

export function splitWindowRows(
	windows: WindowInfo[],
	widths: number[],
	maxWidth: number,
): WindowInfo[][] {
	const rows: WindowInfo[][] = [];
	let row: WindowInfo[] = [];
	let rowWidth = 0;
	windows.forEach((window, index) => {
		const width = widths[index];
		const nextWidth = rowWidth > 0 ? width + buttonSpacing : width;
		if (rowWidth + nextWidth <= maxWidth) {
			row.push(window);
			rowWidth += nextWidth;
			return;
		}
		if (row.length > 0) rows.push(row);
		row = [window];
		rowWidth = width;
	});
	if (row.length > 0) rows.push(row);
	return rows;
}
