import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { isGenericWrapperClass } from "./app-icons";
import { getHyprlandSocketPath } from "./hyprland-ipc";

export interface RecentApplicationFocus {
	identity: string;
	class: string;
	title: string;
}

const eventSocketName = ".socket2.sock";
const activeWindowEvent = "activewindow";
const historyLimit = 32;
const reconnectDelayMs = 1000;

let history: RecentApplicationFocus[] = [];
let running = false;
let reconnectSource: number | null = null;
let activeCancellable: Gio.Cancellable | null = null;
let activeConnection: Gio.SocketConnection | null = null;
let connectionErrorReported = false;

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

function scheduleReconnect(): void {
	if (!running || reconnectSource !== null) return;

	reconnectSource = GLib.timeout_add(
		GLib.PRIORITY_DEFAULT,
		reconnectDelayMs,
		() => {
			reconnectSource = null;
			void listenForHyprlandEvents();
			return GLib.SOURCE_REMOVE;
		},
	);
}

async function listenForHyprlandEvents(): Promise<void> {
	if (!running || activeCancellable !== null) return;

	const socketPath = getHyprlandSocketPath(eventSocketName);
	if (!socketPath) {
		scheduleReconnect();
		return;
	}

	const cancellable = new Gio.Cancellable();
	activeCancellable = cancellable;
	let input: Gio.DataInputStream | null = null;

	try {
		const socketClient = new Gio.SocketClient();
		const address = Gio.UnixSocketAddress.new(socketPath);
		const connection = await socketClient.connect_async(address, cancellable);
		if (!running || activeCancellable !== cancellable) {
			connection.close(null);
			return;
		}

		activeConnection = connection;
		input = Gio.DataInputStream.new(connection.get_input_stream());
		connectionErrorReported = false;

		while (running && activeCancellable === cancellable) {
			const [line] = await input.read_line_async(
				GLib.PRIORITY_DEFAULT,
				cancellable,
			);
			if (line === null) break;
			handleHyprlandEvent(new TextDecoder().decode(line));
		}
	} catch (error) {
		if (running && !cancellable.is_cancelled() && !connectionErrorReported) {
			connectionErrorReported = true;
			console.error("Failed to monitor Hyprland application focus:", error);
		}
	} finally {
		try {
			input?.close(null);
			activeConnection?.close(null);
		} catch {
			// The stream may already be closed after compositor shutdown.
		}

		if (activeCancellable === cancellable) {
			activeCancellable = null;
			activeConnection = null;
		}
		if (running) {
			if (cancellable.is_cancelled()) {
				void listenForHyprlandEvents();
			} else {
				scheduleReconnect();
			}
		}
	}
}

export function startRecentApplicationFocusHistory(): () => void {
	if (running) return stopRecentApplicationFocusHistory;

	running = true;
	void listenForHyprlandEvents();
	return stopRecentApplicationFocusHistory;
}

export function stopRecentApplicationFocusHistory(): void {
	running = false;
	if (reconnectSource !== null) {
		GLib.source_remove(reconnectSource);
		reconnectSource = null;
	}
	activeCancellable?.cancel();
	try {
		activeConnection?.close(null);
	} catch {
		// The connection may already be closed.
	}
	activeConnection = null;
}

export function getRecentApplicationFocusHistory(): RecentApplicationFocus[] {
	return history.map((entry) => ({ ...entry }));
}

export function clearRecentApplicationFocusHistory(): void {
	history = [];
}
