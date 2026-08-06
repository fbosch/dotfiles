import Gio from "gi://Gio?version=2.0";
import GioUnix from "gi://GioUnix?version=2.0";
import GLib from "gi://GLib?version=2.0";
import type { IconRef } from "./app-icons";
import { isGenericWrapperClass, resolveDesktopApplication } from "./app-icons";
import { getHyprlandSocketPath } from "./hyprland-ipc";

interface RecentApplicationFocus {
	identity: string;
	class: string;
	title: string;
}

export interface RecentApplication {
	desktopId: string;
	name: string;
	icon: IconRef | null;
}

const eventSocketName = ".socket2.sock";
const activeWindowEvent = "activewindow";
const historyLimit = 32;
const reconnectDelayMs = 1000;

interface FocusListener {
	stopped: boolean;
	connectionErrorReported: boolean;
	reconnectSource: number | null;
	cancellable: Gio.Cancellable | null;
	connection: Gio.SocketConnection | null;
	input: Gio.DataInputStream | null;
}

let history: RecentApplicationFocus[] = [];
let listener: FocusListener | null = null;

function applicationIdentity(className: string, title: string): string {
	const normalizedClass = className.toLowerCase();
	if (normalizedClass.startsWith("steam_app_")) return normalizedClass;
	if (isGenericWrapperClass(normalizedClass) && title) {
		return `${normalizedClass}:${title.toLowerCase()}`;
	}
	return normalizedClass;
}

function recordFocusedApplication(className: string, title: string): void {
	const identity = applicationIdentity(className, title);
	if (!identity) return;

	const entry: RecentApplicationFocus = {
		identity,
		class: className,
		title,
	};
	history = [
		entry,
		...history.filter((item) => item.identity !== identity),
	].slice(0, historyLimit);
}

function handleHyprlandEvent(line: string): void {
	const separatorIndex = line.indexOf(">>");
	if (separatorIndex === -1) return;
	if (line.slice(0, separatorIndex) !== activeWindowEvent) return;

	const payload = line.slice(separatorIndex + 2);
	const classSeparatorIndex = payload.indexOf(",");
	const className = (
		classSeparatorIndex === -1 ? payload : payload.slice(0, classSeparatorIndex)
	).trim();
	const title = (
		classSeparatorIndex === -1 ? "" : payload.slice(classSeparatorIndex + 1)
	).trim();
	recordFocusedApplication(className, title);
}

function closeNativeResources(state: FocusListener): void {
	state.cancellable?.cancel();
	try {
		state.input?.close(null);
	} catch {
		// The stream may already be closed after compositor shutdown.
	}
	try {
		state.connection?.close(null);
	} catch {
		// The connection may already be closed after compositor shutdown.
	}
	state.cancellable = null;
	state.input = null;
	state.connection = null;
}

function scheduleReconnect(
	state: FocusListener,
	cause: unknown,
	report: boolean,
): void {
	if (state.stopped) return;
	closeNativeResources(state);

	if (report && !state.connectionErrorReported) {
		state.connectionErrorReported = true;
		console.error("Failed to monitor Hyprland application focus:", cause);
	}
	if (state.reconnectSource !== null) return;

	state.reconnectSource = GLib.timeout_add(
		GLib.PRIORITY_DEFAULT,
		reconnectDelayMs,
		() => {
			state.reconnectSource = null;
			connectToHyprlandEvents(state);
			return GLib.SOURCE_REMOVE;
		},
	);
}

function readNextLine(
	state: FocusListener,
	stream: Gio.DataInputStream,
	cancellable: Gio.Cancellable,
): void {
	stream.read_line_async(
		GLib.PRIORITY_DEFAULT,
		cancellable,
		(_source, result) => {
			try {
				const [line] = stream.read_line_finish(result);
				if (state.stopped || state.cancellable !== cancellable) return;
				if (line === null) {
					scheduleReconnect(state, "Hyprland event socket closed", true);
					return;
				}
				state.connectionErrorReported = false;
				handleHyprlandEvent(new TextDecoder().decode(line));
				readNextLine(state, stream, cancellable);
			} catch (error) {
				if (state.stopped || state.cancellable !== cancellable) return;
				if (!cancellable.is_cancelled()) scheduleReconnect(state, error, true);
			}
		},
	);
}

function connectToHyprlandEvents(state: FocusListener): void {
	if (state.stopped) return;

	try {
		const socketPath = getHyprlandSocketPath(eventSocketName);
		if (!socketPath) {
			scheduleReconnect(state, "Hyprland event socket is unavailable", false);
			return;
		}

		const cancellable = new Gio.Cancellable();
		const socketClient = new Gio.SocketClient();
		const address = Gio.UnixSocketAddress.new(socketPath);
		state.cancellable = cancellable;
		socketClient.connect_async(address, cancellable, (_source, result) => {
			try {
				const connection = socketClient.connect_finish(result);
				if (state.stopped || state.cancellable !== cancellable) {
					connection.close(null);
					return;
				}
				state.connection = connection;
				state.input = Gio.DataInputStream.new(connection.get_input_stream());
				readNextLine(state, state.input, cancellable);
			} catch (error) {
				if (state.stopped || state.cancellable !== cancellable) return;
				if (!cancellable.is_cancelled()) scheduleReconnect(state, error, true);
			}
		});
	} catch (error) {
		scheduleReconnect(state, error, true);
	}
}

function stopListener(state: FocusListener): void {
	if (state.stopped) return;
	state.stopped = true;
	if (listener === state) listener = null;
	if (state.reconnectSource !== null) {
		GLib.source_remove(state.reconnectSource);
		state.reconnectSource = null;
	}
	closeNativeResources(state);
}

export function startRecentApplicationFocusHistory(): () => void {
	if (listener !== null) return () => {};

	const state: FocusListener = {
		stopped: false,
		connectionErrorReported: false,
		reconnectSource: null,
		cancellable: null,
		connection: null,
		input: null,
	};
	listener = state;
	connectToHyprlandEvents(state);
	return () => {
		if (listener !== state) return;
		stopListener(state);
	};
}

export function getRecentApplications(limit = 8): RecentApplication[] {
	const boundedLimit = Number.isFinite(limit)
		? Math.min(8, Math.max(0, Math.trunc(limit)))
		: 8;
	if (boundedLimit === 0) return [];

	const applications: RecentApplication[] = [];
	const seenDesktopIds = new Set<string>();

	for (const entry of history) {
		const application = resolveDesktopApplication({
			class: entry.class,
			title: entry.title,
		});
		if (!application) continue;

		if (seenDesktopIds.has(application.desktopId)) continue;

		seenDesktopIds.add(application.desktopId);
		applications.push(application);
		if (applications.length >= boundedLimit) break;
	}

	return applications;
}

export function launchRecentApplication(desktopId: string): boolean {
	if (!desktopId) return false;

	try {
		const appInfo = GioUnix.DesktopAppInfo.new(desktopId);
		if (!appInfo || appInfo.get_is_hidden()) return false;
		return appInfo.launch(null, null);
	} catch (error) {
		console.error(`Failed to launch recent application ${desktopId}:`, error);
		return false;
	}
}

export function clearRecentApplicationFocusHistory(): void {
	history = [];
}
