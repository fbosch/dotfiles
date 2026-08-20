import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { queryHyprlandJson } from "@/services/hyprland-ipc";
import { perf } from "@/services/performance-monitor";
import {
	accessibilityCoordinateSpace,
	accessibilityProtocolVersion,
	type AccessibilityCandidateDiagnostic,
	type AccessibilityEvaluation,
	type AccessibilityHelperOutput,
	type AccessibilityResolution,
	type AccessibleCandidate,
	type ProgramMetadata,
	evaluateAccessibleSnap,
	parseAccessibilityHelperOutput,
} from "./accessibility-policy";
import { evaluateAccessibleClick } from "./click-policy";
import {
	containsSelectionCenter,
	clickFallbackGeometry,
	containsPoint,
	type PointerPosition,
	type SelectionGeometry,
	validatedSelectionGeometry,
} from "./selection";
import { strokeBrushRadius, strokeSelectionRegion, type PointerStroke } from "./stroke";
import { chooseProgramsForSelection, type ProgramWindow } from "./program-policy";
import {
	accessibilityHelperTimingMetrics,
	aiPointerPerformanceMetrics,
} from "./performance-metrics";

Gio._promisify(Gio.InputStream.prototype, "read_bytes_async", "read_bytes_finish");
Gio._promisify(Gio.Subprocess.prototype, "wait_async", "wait_finish");

const lookupTimeoutMs = 900;
const maximumHelperOutputBytes = 32_768;
const helperExecutableName = "ags-ai-pointer-accessibility-helper";

interface ActiveClient {
	address?: unknown;
	at?: unknown;
	class?: unknown;
	focusHistoryID?: unknown;
	hidden?: unknown;
	mapped?: unknown;
	pid?: unknown;
	size?: unknown;
	stableId?: unknown;
	title?: unknown;
	visible?: unknown;
}

interface HyprlandMonitor {
	disabled?: unknown;
	height?: unknown;
	width?: unknown;
	x?: unknown;
	y?: unknown;
}

interface AccessibleHelperInput {
	coordinateSpace: typeof accessibilityCoordinateSpace;
	pid: number;
	protocolVersion: typeof accessibilityProtocolVersion;
	selection: SelectionGeometry;
	stroke: {
		points: PointerPosition[];
		radius: number;
	};
	windowHeight: number;
	windowTitle?: string;
	windowWidth: number;
}

interface ValidatedClient {
	address: string;
	class?: string;
	geometry: SelectionGeometry;
	pid: number;
	stableId?: string;
	title?: string;
}

type ProcessObserver = (process: Gio.Subprocess | null) => void;
export type AccessibilityLookupMode = "click" | "stroke";

export async function resolveAccessibleSelection(
	selection: SelectionGeometry,
	stroke: PointerStroke,
	cancellable: Gio.Cancellable,
	onProcess: ProcessObserver,
	onDiagnostics: (diagnostics: AccessibilityCandidateDiagnostic[]) => void = () => {},
	mode: AccessibilityLookupMode = "stroke",
): Promise<AccessibilityResolution | null> {
	const clickPoint = mode === "click" ? stroke.points.at(-1) : undefined;
	const lookupSelection = clickPoint
		? validatedSelectionGeometry(clickPoint.x, clickPoint.y, 1, 1)
		: selection;
	if (!lookupSelection) return null;
	const client = activeClientForSelection(lookupSelection);
	if (!client) return null;
	const candidates = await queryHelper(client, lookupSelection, stroke, cancellable, onProcess);
	if (!candidates || cancellable.is_cancelled()) return null;
	const freshClient = activeClientForSelection(lookupSelection);
	if (!freshClient || sameClient(client, freshClient) === false) return null;
	const monitor = clickPoint ? monitorGeometryForPoint(clickPoint) : null;
	let evaluation: AccessibilityEvaluation;
	if (clickPoint) {
		if (!monitor) return null;
		evaluation = evaluateAccessibleClick(clickPoint, candidates, freshClient.geometry, monitor);
	} else {
		evaluation = evaluateAccessibleSnap(
			selection,
			candidates,
			freshClient.geometry,
			strokeSelectionRegion(stroke.points, strokeBrushRadius),
		);
	}
	onDiagnostics(evaluation.diagnostics);
	const { resolution } = evaluation;
	if (!resolution) return null;
	return {
		...resolution,
		metadata: {
			...resolution.metadata,
			program: {
				class: freshClient.class,
				geometry: freshClient.geometry,
				pid: freshClient.pid,
				title: freshClient.title,
			},
		},
	};
}

export function clickFallbackForPoint(point: PointerPosition): SelectionGeometry | null {
	const monitor = monitorGeometryForPoint(point);
	return monitor ? clickFallbackGeometry(point, monitor) : null;
}

export function programsForSelection(selection: SelectionGeometry): ProgramMetadata[] {
	const active = queryHyprlandJson<ActiveClient>("j/activewindow", {
		component: "ai-pointer",
		metric: "programAtSelection",
	});
	const activeClient = validatedClient(active);
	const clients = queryHyprlandJson<ActiveClient[]>("j/clients", {
		component: "ai-pointer",
		metric: "programsAtSelection",
	});
	const windows = new Map<string, ProgramWindow>();
	for (const client of clients ?? []) {
		if (client.visible === false) continue;
		const validated = validatedClient(client);
		if (!validated) continue;
		windows.set(validated.address, programWindow(validated, client.focusHistoryID));
	}
	if (activeClient && !windows.has(activeClient.address))
		windows.set(activeClient.address, programWindow(activeClient, 0));
	return chooseProgramsForSelection(selection, [...windows.values()], activeClient?.address);
}

function activeClientForSelection(selection: SelectionGeometry): ValidatedClient | null {
	const active = queryHyprlandJson<ActiveClient>("j/activewindow", {
		component: "ai-pointer",
		metric: "accessibleActiveWindow",
	});
	const client = validatedClient(active);
	return client && containsSelectionCenter(client.geometry, selection) ? client : null;
}

function monitorGeometryForPoint(point: PointerPosition): SelectionGeometry | null {
	const monitors = queryHyprlandJson<HyprlandMonitor[]>("j/monitors", {
		component: "ai-pointer",
		metric: "monitorAtClick",
	});
	for (const monitor of monitors ?? []) {
		if (
			monitor.disabled === true ||
			typeof monitor.x !== "number" ||
			typeof monitor.y !== "number" ||
			typeof monitor.width !== "number" ||
			typeof monitor.height !== "number"
		)
			continue;
		const geometry = validatedSelectionGeometry(
			monitor.x,
			monitor.y,
			monitor.width,
			monitor.height,
		);
		if (geometry && containsPoint(geometry, point)) return geometry;
	}
	return null;
}

function validatedClient(client: ActiveClient | null): ValidatedClient | null {
	if (
		!client ||
		client.mapped === false ||
		client.hidden === true ||
		typeof client.address !== "string" ||
		client.address.length === 0 ||
		Array.isArray(client.at) === false ||
		Array.isArray(client.size) === false ||
		client.at.length !== 2 ||
		client.size.length !== 2 ||
		typeof client.pid !== "number" ||
		Number.isSafeInteger(client.pid) === false ||
		client.pid <= 0
	)
		return null;
	const geometry = validatedSelectionGeometry(
		client.at[0],
		client.at[1],
		client.size[0],
		client.size[1],
	);
	if (!geometry) return null;
	return {
		address: client.address,
		class: boundedClientText(client.class, 80),
		geometry,
		pid: client.pid,
		stableId: typeof client.stableId === "string" ? client.stableId : undefined,
		title: boundedClientText(client.title, 160),
	};
}

function programMetadata(client: ValidatedClient): ProgramMetadata {
	return {
		class: client.class,
		geometry: client.geometry,
		pid: client.pid,
		title: client.title,
	};
}

function programWindow(client: ValidatedClient, focusHistoryId: unknown): ProgramWindow {
	return {
		address: client.address,
		class: client.class,
		focusHistoryId:
			typeof focusHistoryId === "number" && Number.isSafeInteger(focusHistoryId)
				? focusHistoryId
				: Number.MAX_SAFE_INTEGER,
		geometry: client.geometry,
		pid: client.pid,
		title: client.title,
	};
}

function boundedClientText(value: unknown, maximumLength: number): string | undefined {
	if (typeof value !== "string") return undefined;
	return value
		.slice(0, maximumLength)
		.replace(/[\u0000-\u001f\u007f]/g, " ")
		.replace(/\s+/g, " ")
		.trim() || undefined;
}

async function queryHelper(
	client: ValidatedClient,
	selection: SelectionGeometry,
	stroke: PointerStroke,
	parentCancellable: Gio.Cancellable,
	onProcess: ProcessObserver,
): Promise<AccessibleCandidate[] | null> {
	const runtimeDirectory = GLib.getenv("XDG_RUNTIME_DIR");
	if (!runtimeDirectory) return null;
	const helperExecutable = GLib.build_filenamev([runtimeDirectory, helperExecutableName]);
	const input: AccessibleHelperInput = {
		coordinateSpace: accessibilityCoordinateSpace,
		pid: client.pid,
		protocolVersion: accessibilityProtocolVersion,
		selection: {
			x: selection.x - client.geometry.x,
			y: selection.y - client.geometry.y,
			width: selection.width,
			height: selection.height,
		},
		stroke: {
			points: stroke.points.map((point) => ({
				x: point.x - client.geometry.x,
				y: point.y - client.geometry.y,
			})),
			radius: strokeBrushRadius,
		},
		windowHeight: client.geometry.height,
		windowTitle: client.title,
		windowWidth: client.geometry.width,
	};

	let process: Gio.Subprocess;
	const spawnMark = perf.isEnabled()
		? perf.start("ai-pointer", aiPointerPerformanceMetrics.accessibilityHelperSpawn)
		: null;
	try {
		process = Gio.Subprocess.new(
			[helperExecutable, JSON.stringify(input)],
			Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
		);
		spawnMark?.end();
	} catch {
		spawnMark?.end(false, "failed");
		return null;
	}

	onProcess(process);
	const cancellable = new Gio.Cancellable();
	const cancellationId = parentCancellable.connect(() => {
		cancellable.cancel();
		process.force_exit();
	});
	if (parentCancellable.is_cancelled()) {
		cancellable.cancel();
		process.force_exit();
	}
	let timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, lookupTimeoutMs, () => {
		timeoutId = 0;
		cancellable.cancel();
		process.force_exit();
		return GLib.SOURCE_REMOVE;
	});

	const responseMark = perf.isEnabled()
		? perf.start("ai-pointer", aiPointerPerformanceMetrics.accessibilityHelperResponse)
		: null;
	let responseSucceeded = false;
	let helperTimings: AccessibilityHelperOutput["timings"] | null = null;
	try {
		const stdout = await readBoundedHelperOutput(process, cancellable);
		if (!stdout || process.get_successful() === false) return null;
		const helperOutput = parseAccessibilityHelperOutput(stdout);
		if (!helperOutput || helperOutput.complete === false) return null;
		const translated = helperOutput.candidates.map((candidate) => ({
			...candidate,
			geometry: {
				x: candidate.geometry.x + client.geometry.x,
				y: candidate.geometry.y + client.geometry.y,
				width: candidate.geometry.width,
				height: candidate.geometry.height,
			},
		}));
		helperTimings = helperOutput.timings;
		responseSucceeded = true;
		return translated;
	} catch {
		return null;
	} finally {
		responseMark?.end(responseSucceeded, responseSucceeded ? undefined : "failed");
		if (responseSucceeded && helperTimings)
			perf.record(
				"ai-pointer",
				Object.entries(helperTimings).map(([name, timing]) => ({
					durationMs: timing.durationMs,
					name: accessibilityHelperTimingMetrics[
						name as keyof typeof accessibilityHelperTimingMetrics
					],
					startMs: timing.startMs,
				})),
			);
		if (timeoutId !== 0) GLib.source_remove(timeoutId);
		try {
			parentCancellable.disconnect(cancellationId);
		} catch {
			// Cancellation may disconnect its handlers while unwinding.
		}
		onProcess(null);
	}
}

export async function readBoundedHelperOutput(
	process: Gio.Subprocess,
	cancellable: Gio.Cancellable,
): Promise<string | null> {
	const stream = process.get_stdout_pipe();
	if (!stream) return null;
	const chunks: Uint8Array[] = [];
	let byteCount = 0;
	while (true) {
		const bytes = await stream.read_bytes_async(4_096, GLib.PRIORITY_DEFAULT, cancellable);
		const data = bytes.get_data();
		if (!data || data.length === 0) break;
		byteCount += data.length;
		if (byteCount > maximumHelperOutputBytes) {
			process.force_exit();
			try {
				await process.wait_async(null);
			} catch {
				// The process may have exited between the oversized read and termination.
			}
			return null;
		}
		chunks.push(data.slice());
	}
	await process.wait_async(cancellable);
	const output = new Uint8Array(byteCount);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.length;
	}
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(output);
	} catch {
		return null;
	}
}

function sameClient(left: ValidatedClient, right: ValidatedClient): boolean {
	return (
		left.address === right.address &&
		left.pid === right.pid &&
		left.stableId === right.stableId &&
		left.geometry.x === right.geometry.x &&
		left.geometry.y === right.geometry.y &&
		left.geometry.width === right.geometry.width &&
		left.geometry.height === right.geometry.height
	);
}
