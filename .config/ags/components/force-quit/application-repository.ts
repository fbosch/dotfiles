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

function readProcessMetadata(pid: number): string[] {
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
	return values;
}

export function getForceQuitApplications(
	iconTheme?: Gtk.IconTheme | null,
): ForceQuitApplication[] | null {
	const response = queryHyprlandJson<unknown>("j/clients", {
		component: "force-quit",
		metric: "hyprSocketClients",
	});
	if (!Array.isArray(response)) return null;

	const groups = new Map<string, ApplicationGroup>();
	for (const value of response) {
		const window = parseForceQuitWindow(value);
		if (!window) continue;
		const metadata = readProcessMetadata(window.pid);
		if (isProtectedWindow(window, metadata)) continue;
		window.processExecutable = metadata.map(processIdentity).find(Boolean);
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
