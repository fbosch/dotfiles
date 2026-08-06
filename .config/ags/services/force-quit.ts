import GLib from "gi://GLib?version=2.0";
import type Gtk from "gi://Gtk?version=4.0";
import {
	getFallbackLetter,
	getIconForWindow,
	type IconRef,
	type IconWindowInfo,
	resolveDesktopApplication,
} from "./app-icons";
import { queryHyprlandJson } from "./hyprland-ipc";

export interface ForceQuitWindow extends IconWindowInfo {
	address: string;
	pid: number;
}

export interface ForceQuitApplication {
	id: string;
	name: string;
	icon: IconRef | null;
	fallbackLetter: string;
	pids: number[];
	windows: ForceQuitWindow[];
}

export interface ForceQuitMetrics {
	cpuPercent: number | null;
	residentMemoryBytes: number;
}

interface ForceQuitApplicationGroup {
	id: string;
	name: string;
	icon: IconRef | null;
	fallbackLetter: string;
	pids: Set<number>;
	windows: ForceQuitWindow[];
}

const protectedIdentities = new Set([
	"about-this-pc",
	"ags",
	"ags-about-this-pc",
	"ags-bundled",
	"ags-force-quit",
	"ags-start-menu",
	"force-quit",
	"hyprland",
	"hyprlock",
	"start-menu",
	"waybar",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeIdentity(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/\.desktop$/, "");
}

function isProtectedIdentity(value: string): boolean {
	const identity = normalizeIdentity(value);
	return (
		protectedIdentities.has(identity) ||
		identity.startsWith("xdg-desktop-portal")
	);
}

function readProcessMetadata(pid: number): string[] {
	const values: string[] = [];
	for (const filename of ["comm", "cmdline"]) {
		try {
			const [success, contents] = GLib.file_get_contents(
				`/proc/${pid}/${filename}`,
			);
			if (!success || !contents) continue;

			const decoded = new TextDecoder().decode(contents).trim();
			if (filename === "cmdline") {
				const executable = decoded.split("\0").find(Boolean);
				if (executable) values.push(executable);
			} else if (decoded) {
				values.push(decoded);
			}
		} catch {
			// Processes can exit while the client snapshot is being grouped.
		}
	}
	return values;
}

function processIdentity(value: string): string {
	return normalizeIdentity(GLib.path_get_basename(value));
}

function isProtectedProcess(window: ForceQuitWindow): boolean {
	const identities = [window.class, window.initialClass].filter(
		(value): value is string => Boolean(value),
	);
	if (identities.some(isProtectedIdentity)) return true;

	return readProcessMetadata(window.pid).some((value) => {
		const identity = processIdentity(value);
		return isProtectedIdentity(identity) || identity === "config-bundled.tsx";
	});
}

interface ProcessSample {
	ticks: number;
	sampledAtUs: number;
}

const processSamples = new Map<number, ProcessSample>();
const clockTicksPerSecond = 100;
const pageSizeBytes = 4096;

function readProcessStat(
	pid: number,
): { ticks: number; residentMemoryBytes: number } | null {
	try {
		const [success, contents] = GLib.file_get_contents(`/proc/${pid}/stat`);
		if (!success || !contents) return null;

		const stat = new TextDecoder().decode(contents).trim();
		const processNameEnd = stat.lastIndexOf(")");
		if (processNameEnd === -1) return null;
		const fields = stat.slice(processNameEnd + 2).split(" ");
		if (!fields || fields.length < 22) return null;

		const userTicks = Number.parseInt(fields[11], 10);
		const systemTicks = Number.parseInt(fields[12], 10);
		const residentPages = Number.parseInt(fields[21], 10);
		if (
			Number.isFinite(userTicks) === false ||
			Number.isFinite(systemTicks) === false ||
			Number.isFinite(residentPages) === false
		) {
			return null;
		}

		return {
			ticks: userTicks + systemTicks,
			residentMemoryBytes: residentPages * pageSizeBytes,
		};
	} catch {
		return null;
	}
}

export function getForceQuitMetrics(
	applications: ForceQuitApplication[],
): Map<string, ForceQuitMetrics> {
	const sampledAtUs = GLib.get_monotonic_time();
	const activePids = new Set<number>();
	const metrics = new Map<string, ForceQuitMetrics>();

	for (const application of applications) {
		let cpuPercent = 0;
		let hasCpuSample = false;
		let residentMemoryBytes = 0;
		for (const pid of application.pids) {
			activePids.add(pid);
			const stat = readProcessStat(pid);
			if (!stat) continue;

			residentMemoryBytes += stat.residentMemoryBytes;
			const previous = processSamples.get(pid);
			if (previous) {
				const elapsedUs = sampledAtUs - previous.sampledAtUs;
				if (elapsedUs > 0) {
					cpuPercent +=
						((stat.ticks - previous.ticks) * 1_000_000 * 100) /
						(elapsedUs * clockTicksPerSecond);
					hasCpuSample = true;
				}
			}
			processSamples.set(pid, { ticks: stat.ticks, sampledAtUs });
		}

		metrics.set(application.id, {
			cpuPercent: hasCpuSample ? Math.max(0, cpuPercent) : null,
			residentMemoryBytes,
		});
	}

	for (const pid of processSamples.keys()) {
		if (activePids.has(pid) === false) processSamples.delete(pid);
	}

	return metrics;
}

export function clearForceQuitMetricSamples(): void {
	processSamples.clear();
}

function parseWindow(value: unknown): ForceQuitWindow | null {
	if (!isRecord(value) || value.mapped !== true) return null;

	const address = value.address;
	const pid = value.pid;
	const appClass = value.class;
	const initialClass = value.initialClass;
	if (
		typeof address !== "string" ||
		/^0x[0-9a-f]+$/i.test(address) === false ||
		typeof pid !== "number" ||
		Number.isSafeInteger(pid) === false ||
		pid <= 0 ||
		(typeof appClass !== "string" && typeof initialClass !== "string")
	) {
		return null;
	}

	return {
		address,
		pid,
		class: typeof appClass === "string" ? appClass : undefined,
		initialClass: typeof initialClass === "string" ? initialClass : undefined,
		title: typeof value.title === "string" ? value.title : undefined,
		initialTitle:
			typeof value.initialTitle === "string" ? value.initialTitle : undefined,
	};
}

function fallbackApplicationName(window: ForceQuitWindow): string {
	const appClass = window.class || window.initialClass || "Application";
	const segment = appClass.split(".").filter(Boolean).at(-1) ?? appClass;
	const words = segment
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[-_]+/g, " ")
		.trim();
	if (!words) return "Application";

	return words.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function getForceQuitApplications(
	iconTheme?: Gtk.IconTheme | null,
): ForceQuitApplication[] | null {
	const response = queryHyprlandJson<unknown>("j/clients", {
		component: "force-quit",
		metric: "hyprSocketClients",
	});
	if (!Array.isArray(response)) return null;

	const groups = new Map<string, ForceQuitApplicationGroup>();
	for (const value of response) {
		const window = parseWindow(value);
		if (!window || isProtectedProcess(window)) continue;

		const resolved = resolveDesktopApplication(window, iconTheme);
		const fallbackClass = window.class || window.initialClass || "application";
		const id =
			resolved?.desktopId ?? `class:${normalizeIdentity(fallbackClass)}`;
		const existing = groups.get(id);
		if (existing) {
			existing.pids.add(window.pid);
			if (
				existing.windows.some(
					(candidate) => candidate.address === window.address,
				) === false
			) {
				existing.windows.push(window);
			}
			continue;
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

	return Array.from(groups.values()).map((group) => ({
		id: group.id,
		name: group.name,
		icon: group.icon,
		fallbackLetter: group.fallbackLetter,
		pids: Array.from(group.pids).sort((left, right) => left - right),
		windows: group.windows,
	}));
}
