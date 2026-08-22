import { queryHyprlandJson, queryHyprlandText } from "@/services/hyprland-ipc";
import {
	selectionContextFromSnapshots,
	type RawClient,
	type RawLayer,
	type RawMonitor,
	type SelectionContext,
} from "./context";
import type { SelectionGeometry } from "./selection";

export function querySelectionContext(selection: SelectionGeometry): SelectionContext {
	const options = { component: "ai-pointer", metric: "selectionContext" };
	const lockedText = queryHyprlandText("locked", options)?.trim();
	return selectionContextFromSnapshots(selection, {
		clients: queryHyprlandJson<RawClient[]>("j/clients", options) ?? [],
		layers: queryHyprlandJson<Record<string, RawLayer[]>>("j/layers", options) ?? {},
		monitors: queryHyprlandJson<RawMonitor[]>("j/monitors", options) ?? [],
		activeWindow: queryHyprlandJson<{ address?: unknown }>("j/activewindow", options),
		locked: lockedText === "true" ? true : lockedText === "false" ? false : null,
		snapshotAt: new Date().toISOString(),
	});
}
