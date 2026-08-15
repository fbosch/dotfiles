import GLib from "gi://GLib?version=2.0";
import type Gtk from "gi://Gtk?version=4.0";
import {
	getFallbackLetter,
	getIconForWindow,
	resolveDesktopApplication,
} from "../../services/app-icons";
import { queryHyprlandJson } from "../../services/hyprland-ipc";
import {
	fallbackApplicationName,
	type ForceQuitApplication,
	type ForceQuitWindow,
	isProtectedWindow,
	normalizeIdentity,
	parseForceQuitWindow,
	processIdentity,
} from "./model";

interface ApplicationGroup extends Omit<ForceQuitApplication, "pids"> {
	pids: Set<number>;
}

interface ProcessMetadata {
	identities: string[];
	startTime: number;
}

function readProcessMetadata(pid: number): ProcessMetadata | null {
	const values: string[] = [];
	for (const filename of ["comm", "cmdline"]) {
		try {
			const [success, contents] = GLib.file_get_contents(`/proc/${pid}/${filename}`);
			if (!success || !contents) continue;
			const decoded = new TextDecoder().decode(contents).trim();
			if (filename === "cmdline") {
				const executable = decoded.split("\0").find(Boolean);
				if (executable) values.push(executable);
			} else if (decoded) values.push(decoded);
		} catch {
			// Processes can exit while the client snapshot is being grouped.
		}
	}
	const startTime = readProcessStartTime(pid);
	if (values.length === 0 || startTime === null) return null;
	return { identities: values, startTime };
}

export function readProcessStartTime(pid: number): number | null {
	try {
		const [success, contents] = GLib.file_get_contents(`/proc/${pid}/stat`);
		if (!success || !contents) return null;
		const stat = new TextDecoder().decode(contents).trim();
		const processNameEnd = stat.lastIndexOf(")");
		if (processNameEnd === -1) return null;
		const fields = stat.slice(processNameEnd + 2).split(" ");
		const startTime = Number.parseInt(fields[19], 10);
		return Number.isSafeInteger(startTime) && startTime >= 0 ? startTime : null;
	} catch {
		return null;
	}
}

export function getForceQuitApplications(
	iconTheme?: Gtk.IconTheme | null,
): ForceQuitApplication[] | null {
	const response = queryHyprlandJson<unknown>("j/clients", {
		component: "force-quit",
		metric: "hyprSocketClients",
	});
	if (!Array.isArray(response)) return null;

	const windows: Array<{ window: ForceQuitWindow; metadata: ProcessMetadata | null }> = [];
	const protectedPids = new Set<number>();
	for (const value of response) {
		const window = parseForceQuitWindow(value);
		if (!window) continue;
		const metadata = readProcessMetadata(window.pid);
		windows.push({ window, metadata });
		if (isProtectedWindow(window, metadata?.identities ?? null))
			protectedPids.add(window.pid);
	}

	const groups = new Map<string, ApplicationGroup>();
	for (const { window, metadata } of windows) {
		if (protectedPids.has(window.pid) || !metadata) continue;
		window.processExecutable = metadata.identities.map(processIdentity).find(Boolean);
		window.processStartTime = metadata.startTime;
		addWindow(groups, window, iconTheme);
	}

	return Array.from(groups.values()).map((group) => ({
		...group,
		pids: Array.from(group.pids).sort((left, right) => left - right),
	}));
}

function addWindow(
	groups: Map<string, ApplicationGroup>,
	window: ForceQuitWindow,
	iconTheme?: Gtk.IconTheme | null,
): void {
	const resolved = resolveDesktopApplication(window, iconTheme);
	const fallbackClass = window.class || window.initialClass || "application";
	const id = resolved?.desktopId ?? `class:${normalizeIdentity(fallbackClass)}`;
	const existing = groups.get(id);
	if (existing) {
		existing.pids.add(window.pid);
		if (
			existing.windows.some((candidate) => candidate.address === window.address) ===
			false
		)
			existing.windows.push(window);
		return;
	}
	groups.set(id, {
		id,
		name: resolved?.name ?? fallbackApplicationName(window),
		icon: resolved?.icon ?? getIconForWindow(window, iconTheme),
		fallbackLetter: getFallbackLetter(window),
		pids: new Set([window.pid]),
		windows: [window],
	});
}
