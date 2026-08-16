import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { perf } from "@/services/performance-monitor";
import {
	asArray,
	buildRangeQuery,
	componentToEvent,
	sourceColor,
	sourceDisplayName,
	sourceUid,
} from "./eds-event";
import {
	gridRangeKey,
	type BackendStatus,
	type CalendarBackendSnapshot,
	type CalendarEventPreview,
	type CalendarRange,
} from "./model";

interface BackendModules {
	ECal: any;
	EDataServer: any;
}

interface EventViewConnection {
	view: any;
	signalIds: number[];
}

interface SerializedEvent {
	id: string;
	title: string;
	start: string;
	end: string;
	allDay?: boolean;
	calendarName?: string;
	color?: string;
	location?: string;
}

interface SerializedCacheEntry {
	events: SerializedEvent[];
	status: BackendStatus;
	message: string;
}

export interface CalendarBackend {
	init(): void;
	refresh(): boolean;
	stop(): void;
	cooldown(): void;
}

export interface CalendarBackendOptions {
	readRange(): CalendarRange;
	isVisible(): boolean;
	applySnapshot(snapshot: CalendarBackendSnapshot): void;
}

const edsConnectWaitSeconds = 1;
const runtimeDir = GLib.getenv("XDG_RUNTIME_DIR") || GLib.get_tmp_dir();
const eventCachePath = `${runtimeDir}/ags-calendar-widget-events.json`;

function serializeEvent(event: CalendarEventPreview): SerializedEvent {
	return {
		...event,
		start: event.start.toISOString(),
		end: event.end.toISOString(),
	};
}

function deserializeEvent(event: SerializedEvent): CalendarEventPreview | null {
	const start = new Date(event.start);
	const end = new Date(event.end);
	if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
	return { ...event, start, end };
}

export function createCalendarBackend(
	options: CalendarBackendOptions,
): CalendarBackend {
	let loadVersion = 0;
	let modules: BackendModules | null = null;
	let registry: any | null = null;
	let registrySignalIds: number[] = [];
	let refreshSource = 0;
	let loadSource = 0;
	let activeCancellable: Gio.Cancellable | null = null;
	let eventViewConnections: EventViewConnection[] = [];
	let eventCache = new Map<string, CalendarBackendSnapshot>();
	let clientCache = new Map<string, Promise<any>>();
	let sourceInfoCache = new Map<
		string,
		{ name?: string; color?: string }
	>();

	async function loadModules(): Promise<BackendModules> {
		if (modules) return modules;
		const [{ default: ECal }, { default: EDataServer }] = await Promise.all([
			import("gi://ECal?version=2.0"),
			import("gi://EDataServer?version=1.2"),
		]);
		modules = { ECal, EDataServer };
		return modules;
	}

	function sourceInfo(
		source: any,
		EDataServer: any,
	): { name?: string; color?: string } {
		const uid = sourceUid(source);
		const cached = sourceInfoCache.get(uid);
		if (cached) return cached;
		const info = {
			name: sourceDisplayName(source),
			color: sourceColor(source, EDataServer),
		};
		sourceInfoCache.set(uid, info);
		return info;
	}

	function loadSourceRegistry(
		EDataServer: any,
		cancellable: Gio.Cancellable,
	): Promise<any> {
		return new Promise((resolve, reject) => {
			EDataServer.SourceRegistry.new(
				cancellable,
				(_registry: unknown, result: Gio.AsyncResult) => {
					try {
						resolve(EDataServer.SourceRegistry.new_finish(result));
					} catch (error) {
						reject(error);
					}
				},
			);
		});
	}

	function connectSourceClient(
		source: any,
		ECal: any,
		cancellable: Gio.Cancellable,
	): Promise<any> {
		return new Promise((resolve, reject) => {
			ECal.Client.connect(
				source,
				ECal.ClientSourceType.EVENTS,
				edsConnectWaitSeconds,
				cancellable,
				(_client: unknown, result: Gio.AsyncResult) => {
					try {
						resolve(ECal.Client.connect_finish(result));
					} catch (error) {
						reject(error);
					}
				},
			);
		});
	}

	function querySourceEvents(
		client: any,
		sexp: string,
		cancellable: Gio.Cancellable,
	): Promise<unknown[]> {
		return new Promise((resolve, reject) => {
			client.get_object_list_as_comps(
				sexp,
				cancellable,
				(_client: unknown, result: Gio.AsyncResult) => {
					try {
						const response = client.get_object_list_as_comps_finish(result);
						if (Array.isArray(response)) {
							const [ok, components] = response;
							resolve(ok ? asArray<unknown>(components) : []);
							return;
						}
						resolve(asArray<unknown>(response));
					} catch (error) {
						reject(error);
					}
				},
			);
		});
	}

	function getClient(
		source: any,
		ECal: any,
		cancellable: Gio.Cancellable,
	): Promise<any> {
		const uid = sourceUid(source);
		const cached = clientCache.get(uid);
		if (cached) return cached;
		const mark = perf.start("calendar-widget", "connectSourceClient");
		const client = connectSourceClient(source, ECal, cancellable)
			.catch((error) => {
				clientCache.delete(uid);
				throw error;
			})
			.finally(() => mark.end());
		clientCache.set(uid, client);
		return client;
	}

	function createEventView(
		client: any,
		sexp: string,
		cancellable: Gio.Cancellable,
	): Promise<any> {
		return new Promise((resolve, reject) => {
			client.get_view(
				sexp,
				cancellable,
				(_client: unknown, result: Gio.AsyncResult) => {
					try {
						const response = client.get_view_finish(result);
						if (Array.isArray(response)) {
							const [ok, view] = response;
							if (!ok || !view) throw new Error("EDS returned no client view");
							resolve(view);
							return;
						}
						if (!response) throw new Error("EDS returned no client view");
						resolve(response);
					} catch (error) {
						reject(error);
					}
				},
			);
		});
	}

	function stopEventViews(): void {
		for (const { view, signalIds } of eventViewConnections) {
			for (const signalId of signalIds)
				try {
					view.disconnect(signalId);
				} catch {
					// EDS may already have released a disconnected client view.
				}
			try {
				view.stop();
			} catch {
				// A stopped EDS client view does not require further cleanup.
			}
		}
		eventViewConnections = [];
	}

	async function startEventViews(
		clients: any[],
		sexp: string,
		ECal: any,
		cancellable: Gio.Cancellable,
		currentLoadVersion: number,
	): Promise<void> {
		const viewResults = await Promise.all(
			clients.map(async (client) => {
				try {
					return await createEventView(client, sexp, cancellable);
				} catch (error) {
					if (
						currentLoadVersion === loadVersion &&
						cancellable.is_cancelled() === false
					)
						console.error("Failed to watch EDS calendar source:", error);
					return null;
				}
			}),
		);
		const views = viewResults.filter((view) => view !== null);
		if (
			currentLoadVersion !== loadVersion ||
			cancellable.is_cancelled() ||
			options.isVisible() === false
		) {
			for (const view of views)
				try {
					view.stop();
				} catch {
					// A cancelled view may never have entered its running state.
				}
			return;
		}
		const nextConnections: EventViewConnection[] = [];
		try {
			for (const view of views) {
				view.set_flags(ECal.ClientViewFlags.NONE);
				const signalIds = [
					view.connect("objects-added", scheduleBackendRefresh),
					view.connect("objects-modified", scheduleBackendRefresh),
					view.connect("objects-removed", scheduleBackendRefresh),
					view.connect("complete", (_view: unknown, error: unknown) => {
						if (error) console.error("EDS calendar watch failed:", error);
					}),
				];
				nextConnections.push({ view, signalIds });
				view.start();
			}
			eventViewConnections = nextConnections;
		} catch (error) {
			for (const { view, signalIds } of nextConnections) {
				for (const signalId of signalIds) view.disconnect(signalId);
			}
			for (const view of views) {
				try {
					view.stop();
				} catch {
					// A failed client view may not have entered its running state.
				}
			}
			console.error("Failed to start EDS calendar watches:", error);
		}
	}

	function loadCacheFromTmpfs(): void {
		try {
			if (!Gio.File.new_for_path(eventCachePath).query_exists(null)) return;
			const [ok, contents] = GLib.file_get_contents(eventCachePath);
			if (!ok || !contents) return;
			const parsed = JSON.parse(
				new TextDecoder("utf-8").decode(contents),
			) as Record<string, SerializedCacheEntry>;
			for (const [cacheKey, entry] of Object.entries(parsed)) {
				eventCache.set(cacheKey, {
					events: entry.events
						.map(deserializeEvent)
						.filter((event): event is CalendarEventPreview => event !== null),
					status: entry.status,
					message: entry.message,
				});
			}
		} catch (error) {
			console.error("Failed to read calendar event cache:", error);
		}
	}

	function writeCacheEntryToTmpfs(
		cacheKey: string,
		entry: CalendarBackendSnapshot,
	): void {
		try {
			const serialized: Record<string, SerializedCacheEntry> = {
				[cacheKey]: {
					events: entry.events.map(serializeEvent),
					status: entry.status,
					message: entry.message,
				},
			};
			GLib.file_set_contents(eventCachePath, JSON.stringify(serialized));
		} catch (error) {
			console.error("Failed to write calendar event cache:", error);
		}
	}

	function applyVisibleGridCache(): boolean {
		const { start, end } = options.readRange();
		const cached = eventCache.get(gridRangeKey(start, end));
		if (!cached) return false;
		options.applySnapshot(cached);
		return true;
	}

	function invalidate(): void {
		eventCache = new Map();
		clientCache = new Map();
		sourceInfoCache = new Map();
		try {
			GLib.unlink(eventCachePath);
		} catch {
			// A missing runtime cache does not require cleanup.
		}
	}

	async function loadEventsForVisibleGrid(showLoading = true): Promise<void> {
		const mark = perf.start("calendar-widget", "loadEventsForVisibleGrid");
		let ok = true;
		let errorMessage: string | undefined;
		activeCancellable?.cancel();
		stopEventViews();
		const cancellable = new Gio.Cancellable();
		activeCancellable = cancellable;
		const currentLoadVersion = ++loadVersion;
		const isCurrent = () =>
			currentLoadVersion === loadVersion &&
			cancellable.is_cancelled() === false &&
			options.isVisible();
		const range = options.readRange();
		const cacheKey = gridRangeKey(range.start, range.end);
		try {
			if (!eventCache.has(cacheKey) && showLoading)
				options.applySnapshot({
					events: [],
					status: "loading",
					message: "Loading events...",
				});
			const { ECal, EDataServer } = await loadModules();
			if (!isCurrent()) return;
			if (!registry) {
				const registryMark = perf.start(
					"calendar-widget",
					"loadSourceRegistry",
				);
				try {
					const loadedRegistry = await loadSourceRegistry(
						EDataServer,
						cancellable,
					);
					if (!isCurrent()) return;
					registry = loadedRegistry;
				} finally {
					registryMark.end();
				}
			}
			const sources = asArray<any>(
				registry.list_enabled?.(EDataServer.SOURCE_EXTENSION_CALENDAR) ??
					registry.list_sources?.(EDataServer.SOURCE_EXTENSION_CALENDAR),
			);
			if (sources.length === 0) {
				const snapshot = {
					events: [],
					status: "unavailable" as BackendStatus,
					message: "No visible EDS calendars",
				};
				eventCache.set(cacheKey, snapshot);
				writeCacheEntryToTmpfs(cacheKey, snapshot);
				options.applySnapshot(snapshot);
				return;
			}
			const sexp = buildRangeQuery(range);
			const clientResults = await Promise.all(
				sources.map(async (source) => {
					try {
						const client = await getClient(source, ECal, cancellable);
						if (!isCurrent()) return null;
						return { client, source };
					} catch (error) {
						if (!isCurrent()) return null;
						console.error("Failed to read EDS calendar source:", error);
						return null;
					}
				}),
			);
			if (!isCurrent()) return;
			const loadedClients = clientResults.filter((result) => result !== null);
			await startEventViews(
				loadedClients.map(({ client }) => client),
				sexp,
				ECal,
				cancellable,
				currentLoadVersion,
			);
			if (!isCurrent()) return;
			const loadedSources = await Promise.all(
				loadedClients.map(async ({ client, source }) => {
					const queryMark = perf.start(
						"calendar-widget",
						"querySourceEvents",
					);
					try {
						const components = await querySourceEvents(
							client,
							sexp,
							cancellable,
						);
						const info = sourceInfo(source, EDataServer);
						return components.flatMap((component, index) => {
							const event = componentToEvent(component, source, info, index);
							return event ? [event] : [];
						});
					} catch (error) {
						if (isCurrent())
							console.error("Failed to read EDS calendar source:", error);
						return [];
					} finally {
						queryMark.end();
					}
				}),
			);
			if (!isCurrent()) return;
			const snapshot = {
				events: loadedSources
					.flat()
					.sort((a, b) => a.start.getTime() - b.start.getTime()),
				status: "ready" as BackendStatus,
				message: "",
			};
			eventCache.set(cacheKey, snapshot);
			writeCacheEntryToTmpfs(cacheKey, snapshot);
			options.applySnapshot(snapshot);
		} catch (error) {
			if (!isCurrent()) return;
			ok = false;
			errorMessage = String(error);
			const snapshot = {
				events: [],
				status: "unavailable" as BackendStatus,
				message: "Calendar events unavailable",
			};
			eventCache.set(cacheKey, snapshot);
			writeCacheEntryToTmpfs(cacheKey, snapshot);
			console.error("EDS calendar backend unavailable:", error);
			options.applySnapshot(snapshot);
		} finally {
			if (activeCancellable === cancellable) activeCancellable = null;
			mark.end(ok, errorMessage);
		}
	}

	function scheduleBackendRefresh(): void {
		if (!options.isVisible() || refreshSource !== 0) return;
		refreshSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
			refreshSource = 0;
			invalidate();
			void loadEventsForVisibleGrid();
			return GLib.SOURCE_REMOVE;
		});
	}

	function startBackendWatch(): void {
		if (!registry || registrySignalIds.length > 0 || !options.isVisible()) return;
		for (const signal of [
			"source-added",
			"source-changed",
			"source-disabled",
			"source-enabled",
			"source-removed",
		])
			registrySignalIds.push(registry.connect(signal, scheduleBackendRefresh));
	}

	function stop(): void {
		loadVersion += 1;
		activeCancellable?.cancel();
		activeCancellable = null;
		stopEventViews();
		if (loadSource !== 0) {
			GLib.source_remove(loadSource);
			loadSource = 0;
		}
		if (refreshSource !== 0) {
			GLib.source_remove(refreshSource);
			refreshSource = 0;
		}
		if (registry)
			for (const signalId of registrySignalIds) registry.disconnect(signalId);
		registrySignalIds = [];
	}

	return {
		init: loadCacheFromTmpfs,
		refresh(): boolean {
			if (!options.isVisible()) return false;
			const appliedCache = applyVisibleGridCache();
			if (!appliedCache)
				options.applySnapshot({ events: [], status: "loading", message: "" });
			if (loadSource !== 0) return appliedCache;
			loadSource = GLib.timeout_add(GLib.PRIORITY_LOW, 100, () => {
				loadSource = 0;
				if (options.isVisible())
					void loadEventsForVisibleGrid(!appliedCache).then(() => {
						if (options.isVisible()) startBackendWatch();
					});
				return GLib.SOURCE_REMOVE;
			});
			return appliedCache;
		},
		stop,
		cooldown(): void {
			stop();
			registry = null;
			clientCache = new Map();
			sourceInfoCache = new Map();
		},
	};
}
