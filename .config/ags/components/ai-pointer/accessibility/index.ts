import Gio from "gi://Gio?version=2.0";
import { queryHyprlandJson } from "@/services/hyprland-ipc";
import {
	type AccessibilityEvaluation,
	type AccessibilityResolution,
	type ProgramMetadata,
	evaluateAccessibleSnap,
} from "./policy";
import { evaluateAccessibleClick } from "../click-policy";
import {
	containsSelectionCenter,
	clickFallbackGeometry,
	containsPoint,
	type PointerPosition,
	type SelectionGeometry,
	validatedSelectionGeometry,
} from "../selection";
import type { PointerStroke } from "../stroke";
import { chooseProgramsForSelection, type ProgramWindow } from "../program-policy";
import type { ProcessObserver } from "../owned-process";
import type { AccessibilityDebugState, AccessibilityRegionKind } from "./debug-state";
import { selectionBoxRegion } from "./box-region";
import {
	queryAccessibilityHelper,
	type AccessibilityHelperClient,
} from "./helper-client";

export type { AccessibilityDebugState } from "./debug-state";
export { queryAccessibilityHelper, readBoundedHelperOutput } from "./helper-client";
export type { AccessibilityHelperClient } from "./helper-client";

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

export type AccessibilityLookupMode = "click" | "stroke";

export async function resolveAccessibleSelection(
	selection: SelectionGeometry,
	stroke: PointerStroke,
	cancellable: Gio.Cancellable,
	onProcess: ProcessObserver,
	onDebugState: (state: AccessibilityDebugState) => void = () => {},
	mode: AccessibilityLookupMode = "stroke",
): Promise<AccessibilityResolution | null> {
	const clickPoint = mode === "click" ? stroke.points.at(-1) : undefined;
	const region = clickPoint ? null : selectionBoxRegion(selection);
	const regionKind: AccessibilityRegionKind = clickPoint ? "click" : "box";
	onDebugState({ kind: "pending", regionKind });
	const lookupSelection = clickPoint
		? validatedSelectionGeometry(clickPoint.x, clickPoint.y, 1, 1)
		: selection;
	if (!lookupSelection) {
		onDebugState({ kind: "unavailable", regionKind, reason: "invalid selection" });
		return null;
	}
	const client = activeClientForSelection(lookupSelection);
	if (!client) {
		onDebugState({ kind: "unavailable", regionKind, reason: "no active client" });
		return null;
	}
	const helperResult = await queryAccessibilityHelper(
		client,
		lookupSelection,
		stroke,
		cancellable,
		onProcess,
	);
	if (cancellable.is_cancelled()) return null;
	if (helperResult.kind === "unavailable") {
		onDebugState({ kind: "unavailable", regionKind, reason: helperResult.reason });
		return null;
	}
	const freshClient = activeClientForSelection(lookupSelection);
	if (!freshClient || sameClient(client, freshClient) === false) {
		onDebugState({ kind: "unavailable", regionKind, reason: "active client changed" });
		return null;
	}
	const monitor = clickPoint ? monitorGeometryForPoint(clickPoint) : null;
	let evaluation: AccessibilityEvaluation;
	if (clickPoint) {
		if (!monitor) {
			onDebugState({ kind: "unavailable", regionKind, reason: "monitor unavailable" });
			return null;
		}
		evaluation = evaluateAccessibleClick(
			clickPoint,
			helperResult.candidates,
			freshClient.geometry,
			monitor,
		);
	} else {
		evaluation = evaluateAccessibleSnap(
			selection,
			helperResult.candidates,
			freshClient.geometry,
			region!,
		);
	}
	if (helperResult.candidates.length === 0) onDebugState({ kind: "empty", regionKind });
	else
		onDebugState({
			kind: "evaluated",
			regionKind,
			candidateCount: helperResult.candidates.length,
			diagnostics: evaluation.diagnostics,
			partial: helperResult.partial,
		});
	// Incomplete traversal is useful for diagnostics but cannot safely change capture bounds.
	if (helperResult.partial) return null;
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

function activeClientForSelection(selection: SelectionGeometry): AccessibilityHelperClient | null {
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

function validatedClient(client: ActiveClient | null): AccessibilityHelperClient | null {
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

function programMetadata(client: AccessibilityHelperClient): ProgramMetadata {
	return {
		class: client.class,
		geometry: client.geometry,
		pid: client.pid,
		title: client.title,
	};
}

function programWindow(client: AccessibilityHelperClient, focusHistoryId: unknown): ProgramWindow {
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
function sameClient(left: AccessibilityHelperClient, right: AccessibilityHelperClient): boolean {
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
