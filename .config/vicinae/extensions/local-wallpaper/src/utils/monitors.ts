import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export type Monitor = {
	id: number;
	name: string;
	width: number;
	height: number;
	x: number;
	y: number;
	scale: number;
	refreshRate: number;
	activeWorkspace: {
		id: number;
		name: string;
	};
	focused: boolean;
	dpmsStatus: boolean;
	transform: number;
};

/**
 * Gets the list of connected monitors from Hyprland
 */
export async function getConnectedMonitors(): Promise<Monitor[]> {
	try {
		const { stdout } = await execAsync("hyprctl monitors -j");
		const monitors = JSON.parse(stdout) as Monitor[];
		return monitors;
	} catch (error) {
		console.error("Error getting monitors:", error);
		// Return empty array if hyprctl is not available or fails
		return [];
	}
}

/**
 * Gets a monitor by name
 */
export async function getMonitorByName(
	name: string,
): Promise<Monitor | undefined> {
	const monitors = await getConnectedMonitors();
	return monitors.find((m) => m.name === name);
}

/**
 * Gets the currently focused monitor
 */
export async function getFocusedMonitor(): Promise<Monitor | undefined> {
	const monitors = await getConnectedMonitors();
	return monitors.find((m) => m.focused);
}

/**
 * Formats monitor display name with resolution
 */
export function formatMonitorName(monitor: Monitor): string {
	return `${monitor.name} (${monitor.width}x${monitor.height}${monitor.scale !== 1 ? ` @${monitor.scale}x` : ""})`;
}
