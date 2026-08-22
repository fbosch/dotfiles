import Gdk from "gi://Gdk?version=4.0";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import type { SelectionGeometry } from "./selection";

export type HorizontalGrowth = "left" | "right";
export type VerticalGrowth = "up" | "down";

export interface ResponseGrowth {
	horizontal: HorizontalGrowth;
	vertical: VerticalGrowth;
}

export function applyResponseGrowth(
	panel: Gtk.Box,
	prompt: Gtk.Widget,
	answer: Gtk.Widget,
	error: Gtk.Widget,
	growth: ResponseGrowth,
): void {
	const alignment = growth.horizontal === "right" ? Gtk.Align.START : Gtk.Align.END;
	prompt.set_halign(alignment);
	answer.set_halign(alignment);
	error.set_halign(alignment);
	panel.set_valign(growth.vertical === "down" ? Gtk.Align.START : Gtk.Align.END);
	if (growth.vertical === "down") {
		panel.reorder_child_after(prompt, null);
		panel.reorder_child_after(answer, prompt);
		panel.reorder_child_after(error, answer);
		return;
	}
	panel.reorder_child_after(answer, null);
	panel.reorder_child_after(error, answer);
	panel.reorder_child_after(prompt, error);
}

export function resetResponseGrowth(
	panel: Gtk.Box,
	prompt: Gtk.Widget,
	answer: Gtk.Widget,
	error: Gtk.Widget,
): void {
	applyResponseGrowth(panel, prompt, answer, error, { horizontal: "right", vertical: "down" });
}

export function responseGrowth(
	selection: SelectionGeometry,
	prompt: { x: number; y: number; width: number; height: number },
	preferredSize: { width: number; height: number },
): ResponseGrowth | null {
	const monitors = Gdk.Display.get_default()?.get_monitors();
	const centerX = selection.x + selection.width / 2;
	const centerY = selection.y + selection.height / 2;
	for (let index = 0; monitors && index < monitors.get_n_items(); index += 1) {
		const monitor = monitors.get_item(index) as Gdk.Monitor | null;
		if (!monitor) continue;
		const bounds = monitor.get_geometry();
		if (
			centerX < bounds.x ||
			centerX >= bounds.x + bounds.width ||
			centerY < bounds.y ||
			centerY >= bounds.y + bounds.height
		)
			continue;

		const left = bounds.x + 16;
		const top = bounds.y + 16;
		const right = bounds.x + bounds.width - 16;
		const bottom = bounds.y + bounds.height - 16;
		const rightSpace = right - prompt.x;
		const leftSpace = prompt.x + prompt.width - left;
		const downSpace = bottom - prompt.y;
		const upSpace = prompt.y + prompt.height - top;
		return {
			horizontal: rightSpace >= preferredSize.width || rightSpace >= leftSpace ? "right" : "left",
			vertical: downSpace >= preferredSize.height || downSpace >= upSpace ? "down" : "up",
		};
	}
	return null;
}

export function queueFollowLatest(scroller: Gtk.ScrolledWindow, onComplete: () => void): number {
	return GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
		onComplete();
		const adjustment = scroller.get_vadjustment();
		adjustment.set_value(
			Math.max(adjustment.get_lower(), adjustment.get_upper() - adjustment.get_page_size()),
		);
		return GLib.SOURCE_REMOVE;
	});
}

export function clearFollowLatest(sourceId: number): void {
	if (sourceId !== 0) GLib.source_remove(sourceId);
}
