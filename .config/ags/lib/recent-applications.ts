import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { Context, Data, Effect, Fiber, Scheduler } from "effect";
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

const scheduler = new Scheduler.MixedScheduler("async", (runBatch) => {
	let sourceId: number | null = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
		sourceId = null;
		runBatch();
		return GLib.SOURCE_REMOVE;
	});
	return () => {
		if (sourceId === null) return;
		GLib.source_remove(sourceId);
		sourceId = null;
	};
});
const runEffectFork = Effect.runForkWith(
	Context.make(Scheduler.Scheduler, scheduler),
);

let history: RecentApplicationFocus[] = [];
let connectionErrorReported = false;
let listenerFiber: Fiber.Fiber<never, never> | null = null;

class FocusListenerError extends Data.TaggedError("FocusListenerError")<{
	readonly cause: unknown;
	readonly report: boolean;
}> {}

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

const reconnectDelay = Effect.callback<void>((resume) => {
	let sourceId: number | null = GLib.timeout_add(
		GLib.PRIORITY_DEFAULT,
		reconnectDelayMs,
		() => {
			sourceId = null;
			resume(Effect.succeed(undefined));
			return GLib.SOURCE_REMOVE;
		},
	);

	return Effect.sync(() => {
		if (sourceId === null) return;
		GLib.source_remove(sourceId);
		sourceId = null;
	});
});

const listenForHyprlandEvents = Effect.callback<never, FocusListenerError>(
	(resume) => {
		const cancellable = new Gio.Cancellable();
		let connection: Gio.SocketConnection | null = null;
		let input: Gio.DataInputStream | null = null;
		let finished = false;

		const closeNativeResources = () => {
			if (finished) return;
			finished = true;
			cancellable.cancel();
			try {
				input?.close(null);
				connection?.close(null);
			} catch {
				// The stream may already be closed after compositor shutdown.
			}
		};

		const fail = (cause: unknown, report: boolean) => {
			if (finished) return;
			closeNativeResources();
			resume(Effect.fail(new FocusListenerError({ cause, report })));
		};

		const readNextLine = (stream: Gio.DataInputStream) => {
			stream.read_line_async(
				GLib.PRIORITY_DEFAULT,
				cancellable,
				(_source, result) => {
					if (finished) return;

					try {
						const [line] = stream.read_line_finish(result);
						if (line === null) {
							fail("Hyprland event socket closed", true);
							return;
						}
						handleHyprlandEvent(new TextDecoder().decode(line));
						readNextLine(stream);
					} catch (error) {
						if (!cancellable.is_cancelled()) fail(error, true);
					}
				},
			);
		};

		const socketPath = getHyprlandSocketPath(eventSocketName);
		if (!socketPath) {
			fail("Hyprland event socket is unavailable", false);
		} else {
			const socketClient = new Gio.SocketClient();
			const address = Gio.UnixSocketAddress.new(socketPath);
			socketClient.connect_async(address, cancellable, (_source, result) => {
				if (finished) return;

				try {
					connection = socketClient.connect_finish(result);
					input = Gio.DataInputStream.new(connection.get_input_stream());
					connectionErrorReported = false;
					readNextLine(input);
				} catch (error) {
					if (!cancellable.is_cancelled()) fail(error, true);
				}
			});
		}

		return Effect.sync(closeNativeResources);
	},
);

const listenerProgram = Effect.forever(
	listenForHyprlandEvents.pipe(
		Effect.catch((error) =>
			Effect.sync(() => {
				if (!error.report || connectionErrorReported) return;
				connectionErrorReported = true;
				console.error(
					"Failed to monitor Hyprland application focus:",
					error.cause,
				);
			}).pipe(Effect.andThen(reconnectDelay)),
		),
	),
);

export function startRecentApplicationFocusHistory(): () => void {
	if (listenerFiber !== null) return stopRecentApplicationFocusHistory;

	listenerFiber = runEffectFork(listenerProgram);
	return stopRecentApplicationFocusHistory;
}

export function stopRecentApplicationFocusHistory(): void {
	const fiber = listenerFiber;
	listenerFiber = null;
	if (fiber !== null) {
		runEffectFork(Fiber.interrupt(fiber));
	}
}

export function getRecentApplicationFocusHistory(): RecentApplicationFocus[] {
	return history.map((entry) => ({ ...entry }));
}

export function clearRecentApplicationFocusHistory(): void {
	history = [];
}
