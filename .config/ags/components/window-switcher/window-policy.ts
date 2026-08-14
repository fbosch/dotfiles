import type { WindowInfo } from "./machine";

export type HyprlandClient = {
	address: string;
	stableId?: string;
	class: string;
	initialClass?: string;
	title: string;
	initialTitle?: string;
	focused?: boolean;
	workspace: { id: number; name: string };
	at?: [number, number];
	size?: [number, number];
};

export function buildWindowList(
	clients: HyprlandClient[],
	sortMode: "ALPHABETICAL" | "RECENCY",
	focusHistory: string[],
): WindowInfo[] {
	const windows = clients
		.filter((client) => {
			const workspaceName = client.workspace.name || "";
			return (
				workspaceName === "special:minimized" ||
				workspaceName.startsWith("special:") === false
			);
		})
		.map(toWindowInfo);
	windows.sort((left, right) =>
		sortMode === "RECENCY"
			? compareByRecency(left, right, focusHistory)
			: compareAlphabetically(left, right),
	);
	return windows;
}

export function updateFocusHistory(
	history: string[],
	address: string,
	limit = 50,
): string[] {
	if (!address) return history;
	return [address, ...history.filter((entry) => entry !== address)].slice(0, limit);
}

function toWindowInfo(client: HyprlandClient): WindowInfo {
	return {
		address: client.address,
		stableId: client.stableId,
		class: client.class || "",
		initialClass: client.initialClass || undefined,
		title: client.title || "",
		initialTitle: client.initialTitle || undefined,
		workspace: client.workspace.name || client.workspace.id.toString(),
		size: client.size
			? { width: client.size[0], height: client.size[1] }
			: undefined,
		position: client.at ? { x: client.at[0], y: client.at[1] } : undefined,
	};
}

function compareByRecency(
	left: WindowInfo,
	right: WindowInfo,
	focusHistory: string[],
): number {
	const leftIndex = focusHistory.indexOf(left.address);
	const rightIndex = focusHistory.indexOf(right.address);
	if (leftIndex !== -1 && rightIndex !== -1) return leftIndex - rightIndex;
	if (leftIndex !== -1) return -1;
	if (rightIndex !== -1) return 1;
	return compareAlphabetically(left, right);
}

function compareAlphabetically(left: WindowInfo, right: WindowInfo): number {
	return left.class !== right.class
		? left.class.localeCompare(right.class)
		: left.title !== right.title
			? left.title.localeCompare(right.title)
			: left.address.localeCompare(right.address);
}
