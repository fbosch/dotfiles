import type { IconRef, IconWindowInfo } from "@/services/app-icons";

export interface ForceQuitWindow extends IconWindowInfo {
	address: string;
	pid: number;
	processStartTime?: number;
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
	"io.astal.ags-bundled",
	"start-menu",
	"waybar",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeIdentity(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/\.desktop$/, "");
}

export function processIdentity(value: string): string {
	return normalizeIdentity(value.split("/").at(-1) ?? value);
}

function isProtectedIdentity(value: string): boolean {
	const identity = normalizeIdentity(value);
	return (
		protectedIdentities.has(identity) ||
		identity.startsWith("xdg-desktop-portal")
	);
}

export function isProtectedWindow(
	window: ForceQuitWindow,
	processMetadata: string[] | null,
): boolean {
	if (processMetadata === null) return true;
	const identities = [window.class, window.initialClass].filter(
		(value): value is string => Boolean(value),
	);
	if (identities.some(isProtectedIdentity)) return true;

	return processMetadata.some((value) => {
		const identity = processIdentity(value);
		return isProtectedIdentity(identity) || identity === "config-bundled.tsx";
	});
}

export function parseForceQuitWindow(value: unknown): ForceQuitWindow | null {
	if (!isRecord(value) || value.mapped !== true) return null;
	const { address, pid, class: appClass, initialClass } = value;
	if (
		typeof address !== "string" ||
		/^0x[0-9a-f]+$/i.test(address) === false ||
		typeof pid !== "number" ||
		Number.isSafeInteger(pid) === false ||
		pid <= 0 ||
		(typeof appClass !== "string" && typeof initialClass !== "string")
	)
		return null;

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

export function fallbackApplicationName(window: ForceQuitWindow): string {
	const appClass = window.class || window.initialClass || "Application";
	const segment = appClass.split(".").filter(Boolean).at(-1) ?? appClass;
	const words = segment
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[-_]+/g, " ")
		.trim();
	if (!words) return "Application";
	return words.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function revalidatedWindows(
	application: ForceQuitApplication,
	applications: ForceQuitApplication[],
): ForceQuitWindow[] {
	const current = applications.find(
		(candidate) => candidate.id === application.id,
	);
	if (!current) return [];
	const originalWindows = new Map(
		application.windows.map((window) => [window.address, window]),
	);
	return current.windows.filter(
		(window) => {
			const original = originalWindows.get(window.address);
			if (!original || original.pid !== window.pid) return false;
			if (
				typeof original.processStartTime === "number" &&
				original.processStartTime !== window.processStartTime
			)
				return false;
			return true;
		},
	);
}

export function applicationTopologyMatches(
	left: ForceQuitApplication[] | null,
	right: ForceQuitApplication[] | null,
): boolean {
	if (!left || !right) return left === right;
	if (left.length !== right.length) return false;
	const rightById = new Map(right.map((application) => [application.id, application]));
	return left.every((application) => {
		const candidate = rightById.get(application.id);
		if (!candidate || application.pids.join(",") !== candidate.pids.join(","))
			return false;
		const windows = application.windows
			.map((window) => `${window.address}:${window.pid}`)
			.sort()
			.join(",");
		const candidateWindows = candidate.windows
			.map((window) => `${window.address}:${window.pid}`)
			.sort()
			.join(",");
		return windows === candidateWindows;
	});
}

export function formatForceQuitMetrics(
	metric: ForceQuitMetrics | undefined,
): string {
	if (!metric) return "-- · --";
	const cpu =
		metric.cpuPercent === null ? "--" : `${metric.cpuPercent.toFixed(1)}%`;
	const bytes = metric.residentMemoryBytes;
	const memory =
		bytes >= 1024 * 1024 * 1024
			? `${(bytes / 1024 ** 3).toFixed(1)} GB`
			: `${Math.round(bytes / 1024 ** 2)} MB`;
	return `${cpu} · ${memory}`;
}
