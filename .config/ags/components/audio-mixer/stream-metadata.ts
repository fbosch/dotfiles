import Gdk from "gi://Gdk?version=4.0";
import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import { resolveAppIcon, type IconRef } from "../../services/app-icons";
import { queryHyprlandJson } from "../../services/hyprland-ipc";
import { perf } from "../../services/performance-monitor";
import { displayName, getNumber, getText } from "./model";

interface HyprlandClient {
	class?: string;
	initialClass?: string;
	title?: string;
	initialTitle?: string;
	pid?: number;
}
const dynamicCacheTtlMs = 2000;
const inspectionCacheTtlMs = 30 * 1000;
let iconTheme: Gtk.IconTheme | null = null;
let hyprClients: { timestampMs: number; clients: HyprlandClient[] } | null =
	null;
let wpctlStatus: {
	timestampMs: number;
	streams: Array<{ id: number; name: string }>;
} | null = null;
const inspections = new Map<
	number,
	{ timestampMs: number; properties: Record<string, string> | null }
>();
const now = () => GLib.get_monotonic_time() / 1000;

function inspect(id: number): Record<string, string> | null {
	const cached = inspections.get(id);
	const nowMs = now();
	if (cached && nowMs - cached.timestampMs < inspectionCacheTtlMs)
		return cached.properties;
	for (const [cachedId, entry] of inspections)
		if (nowMs - entry.timestampMs >= inspectionCacheTtlMs)
			inspections.delete(cachedId);
	const mark = perf.start("audio-mixer-widget", "wpctlInspect");
	let ok = true;
	let error: string | undefined;
	try {
		const [, stdout] = GLib.spawn_command_line_sync(`wpctl inspect ${id}`);
		if (!stdout) return null;
		const properties: Record<string, string> = {};
		for (const line of new TextDecoder().decode(stdout).split("\n")) {
			const match = line.match(/^\s*\*?\s*([a-zA-Z0-9_.-]+)\s*=\s*"(.*)"\s*$/);
			if (match) properties[match[1]] = match[2];
		}
		inspections.set(id, { timestampMs: nowMs, properties });
		return properties;
	} catch (cause) {
		ok = false;
		error = String(cause);
		inspections.set(id, { timestampMs: nowMs, properties: null });
		return null;
	} finally {
		mark.end(ok, error);
	}
}

function streams(): Array<{ id: number; name: string }> {
	if (wpctlStatus && now() - wpctlStatus.timestampMs < dynamicCacheTtlMs)
		return wpctlStatus.streams;
	const mark = perf.start("audio-mixer-widget", "wpctlStatus");
	let ok = true;
	let error: string | undefined;
	try {
		const [, stdout] = GLib.spawn_command_line_sync("wpctl status");
		if (!stdout) return [];
		const result: Array<{ id: number; name: string }> = [];
		let inStreams = false;
		for (const line of new TextDecoder().decode(stdout).split("\n")) {
			if (line.includes("Streams:")) {
				inStreams = true;
				continue;
			}
			if (inStreams && /^\S/.test(line)) break;
			const match = inStreams
				? line.match(/^\s*(\d+)\.\s+([^<>\[]+?)\s*$/)
				: null;
			if (match && Number.isFinite(Number(match[1])) && match[2].trim())
				result.push({ id: Number(match[1]), name: match[2].trim() });
		}
		wpctlStatus = { timestampMs: now(), streams: result };
		return result;
	} catch (cause) {
		ok = false;
		error = String(cause);
		return wpctlStatus?.streams ?? [];
	} finally {
		mark.end(ok, error);
	}
}

function propertiesFor(object: any): Record<string, string> | null {
	for (const id of ["id", "node_id", "bound_id"].map((key) =>
		getNumber(object, [key]),
	))
		if (id !== undefined) {
			const result = inspect(Math.round(id));
			if (result) return result;
		}
	const names = new Set(
		[
			displayName(object, ""),
			getText(object, ["name", "node.name", "application.name"]) ?? "",
		]
			.map((name) => name.trim())
			.filter(Boolean),
	);
	for (const stream of streams())
		if (names.has(stream.name)) {
			const result = inspect(stream.id);
			if (result) return result;
		}
	return null;
}

function processId(object: any): number | undefined {
	const direct = getNumber(object, [
		"application.process.id",
		"application_process_id",
		"process_id",
		"pid",
	]);
	if (direct !== undefined) return Math.round(direct);
	const properties = propertiesFor(object);
	const pid = Number(properties?.["application.process.id"]);
	if (Number.isFinite(pid)) return Math.round(pid);
	const clientId = Number(properties?.["client.id"]);
	const clientPid = Number.isFinite(clientId)
		? Number(inspect(Math.round(clientId))?.["application.process.id"])
		: Number.NaN;
	return Number.isFinite(clientPid) ? Math.round(clientPid) : undefined;
}

function clients(): HyprlandClient[] {
	if (hyprClients && now() - hyprClients.timestampMs < dynamicCacheTtlMs)
		return hyprClients.clients;
	const socket = queryHyprlandJson<HyprlandClient[]>("j/clients", {
		component: "audio-mixer-widget",
		metric: "hyprSocketClients",
	});
	if (socket) {
		hyprClients = { timestampMs: now(), clients: socket };
		return socket;
	}
	const mark = perf.start("audio-mixer-widget", "hyprctlClients");
	let ok = true;
	let error: string | undefined;
	try {
		const [, stdout] = GLib.spawn_command_line_sync("hyprctl clients -j");
		if (!stdout) return [];
		const result = JSON.parse(
			new TextDecoder().decode(stdout),
		) as HyprlandClient[];
		hyprClients = { timestampMs: now(), clients: result };
		return result;
	} catch (cause) {
		ok = false;
		error = String(cause);
		console.error("Failed to read Hyprland clients for audio mixer:", cause);
		return hyprClients?.clients ?? [];
	} finally {
		mark.end(ok, error);
	}
}

function ancestors(pid: number): Set<number> {
	const result = new Set<number>();
	let current: number | null = pid;
	for (let depth = 0; current !== null && depth < 32; depth += 1) {
		if (result.has(current)) break;
		result.add(current);
		try {
			const [, contents] = Gio.File.new_for_path(
				`/proc/${current}/stat`,
			).load_contents(null);
			const text = contents ? new TextDecoder().decode(contents) : "";
			const end = text.lastIndexOf(")");
			const parent = Number(
				end < 0 ? Number.NaN : text.slice(end + 2).split(" ")[1],
			);
			current =
				Number.isFinite(parent) && parent > 0 ? Math.round(parent) : null;
		} catch {
			current = null;
		}
	}
	return result;
}

export function resolveStreamIcon(object: any): {
	icon: IconRef | null;
	title?: string;
} {
	const pid = processId(object);
	let client: HyprlandClient | null = null;
	if (pid !== undefined) {
		const allClients = clients();
		client = allClients.find((candidate) => candidate.pid === pid) ?? null;
		if (!client) {
			const ancestorPids = ancestors(pid);
			client =
				allClients.find(
					(candidate) =>
						candidate.pid !== undefined && ancestorPids.has(candidate.pid),
				) ?? null;
		}
	}
	const mark = perf.start("audio-mixer-widget", "resolveAudioIcon");
	let ok = true;
	let error: string | undefined;
	try {
		if (!iconTheme) {
			const display = Gdk.Display.get_default();
			iconTheme = display ? Gtk.IconTheme.get_for_display(display) : null;
		}
		const properties = propertiesFor(object);
		const candidates = Array.from(
			new Set(
				[
					client?.title,
					client?.initialTitle,
					client?.class,
					client?.initialClass,
					properties?.["application.process.binary"],
					properties?.["pipewire.access.portal.app_id"],
					properties?.["application.name"],
					properties?.["node.name"],
					getText(object, [
						"application_id",
						"app_id",
						"application_process_binary",
						"binary",
					]),
					getText(object, ["application.process.binary"]),
					getText(object, [
						"application_name",
						"app_name",
						"name",
						"media_name",
						"description",
					]),
					properties?.["media.name"],
					getText(object, ["application.name", "media.name", "node.name"]),
				].filter((value): value is string => Boolean(value?.trim())),
			),
		);
		return {
			icon: resolveAppIcon({
				candidates,
				directIcon: getText(object, [
					"icon_name",
					"icon",
					"application_icon_name",
				]),
				iconTheme,
			}),
			title: client?.title?.trim(),
		};
	} catch (cause) {
		ok = false;
		error = String(cause);
		throw cause;
	} finally {
		mark.end(ok, error);
	}
}
