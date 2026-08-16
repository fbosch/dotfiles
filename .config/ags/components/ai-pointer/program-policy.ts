import type { ProgramMetadata } from "./accessibility-policy";
import type { SelectionGeometry } from "./selection";

const maximumPrograms = 8;
const minimumSelectionCoverage = 0.05;

export interface ProgramWindow extends ProgramMetadata {
	address: string;
	focusHistoryId: number;
}

export function chooseProgramsForSelection(
	selection: SelectionGeometry,
	windows: ProgramWindow[],
	activeAddress?: string,
): ProgramMetadata[] {
	const selectionArea = selection.width * selection.height;
	const candidates = windows
		.map((window) => {
			const overlap = intersectionGeometry(selection, window.geometry);
			return {
				active: window.address === activeAddress,
				overlap,
				window,
				coverage: overlap ? overlap.width * overlap.height / selectionArea : 0,
			};
		})
		.filter(({ active, coverage, overlap }) =>
			overlap !== null && (active || coverage >= minimumSelectionCoverage),
		)
		.sort((left, right) =>
			Number(right.active) - Number(left.active) ||
			left.window.focusHistoryId - right.window.focusHistoryId ||
			right.coverage - left.coverage,
		);
	const selected: typeof candidates = [];
	for (const candidate of candidates) {
		if (
			candidate.overlap &&
			selected.some(({ window }) => containsGeometry(window.geometry, candidate.overlap!))
		)
			continue;
		selected.push(candidate);
		if (selected.length >= maximumPrograms) break;
	}
	return selected.map(({ coverage, window }) => ({
		class: window.class,
		coverage,
		geometry: window.geometry,
		pid: window.pid,
		title: window.title,
	}));
}

function intersectionGeometry(
	left: SelectionGeometry,
	right: SelectionGeometry,
): SelectionGeometry | null {
	const x = Math.max(left.x, right.x);
	const y = Math.max(left.y, right.y);
	const rightEdge = Math.min(left.x + left.width, right.x + right.width);
	const bottomEdge = Math.min(left.y + left.height, right.y + right.height);
	if (rightEdge <= x || bottomEdge <= y) return null;
	return { x, y, width: rightEdge - x, height: bottomEdge - y };
}

function containsGeometry(container: SelectionGeometry, target: SelectionGeometry): boolean {
	return (
		target.x >= container.x &&
		target.y >= container.y &&
		target.x + target.width <= container.x + container.width &&
		target.y + target.height <= container.y + container.height
	);
}
