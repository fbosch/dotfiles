import { Astal } from "ags/gtk4";
import app from "ags/gtk4/app";
import Cairo from "cairo";
import Gdk from "gi://Gdk?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import GLib from "gi://GLib?version=2.0";
import tokens from "../../../../design-system/tokens.json";
import type { SelectionGeometry } from "./selection";
import type { PointerStroke } from "./stroke";

interface StrokeSurface {
	window: Astal.Window;
	drawing: Gtk.DrawingArea;
}

const allEdges =
	Astal.WindowAnchor.TOP |
	Astal.WindowAnchor.BOTTOM |
	Astal.WindowAnchor.LEFT |
	Astal.WindowAnchor.RIGHT;
const unmapTimeoutMs = 250;
const compositorFrameDelayMs = 34;
const selectionPreviewDurationMs = 220;
const selectionPreviewRadius = 14;
const curveTension = 0.14;

export class StrokeOverlay {
	#surfaces: StrokeSurface[] = [];
	#stroke: PointerStroke | null = null;
	#selection: SelectionGeometry | null = null;
	#previewTimeoutId = 0;
	#resolvePreview: (() => void) | null = null;

	show(stroke: PointerStroke, onCancel: () => void): boolean {
		this.hide();
		const display = Gdk.Display.get_default();
		if (!display) return false;

		const monitors = display.get_monitors();
		for (let index = 0; index < monitors.get_n_items(); index += 1) {
			const monitor = monitors.get_item(index) as Gdk.Monitor | null;
			if (!monitor) continue;
			this.#surfaces.push(this.#createSurface(monitor, index, onCancel));
		}
		if (this.#surfaces.length === 0) return false;

		this.update(stroke);
		for (const surface of this.#surfaces) surface.window.set_visible(true);
		return true;
	}

	update(stroke: PointerStroke): void {
		this.#stroke = stroke;
		for (const surface of this.#surfaces) surface.drawing.queue_draw();
	}

	hide(): void {
		this.#finishPreviewWait();
		for (const surface of this.#surfaces) surface.window.destroy();
		this.#surfaces = [];
		this.#stroke = null;
		this.#selection = null;
	}

	async previewBeforeCapture(selection: SelectionGeometry): Promise<boolean> {
		if (this.#surfaces.length === 0) return false;
		this.#stroke = null;
		this.#selection = selection;
		for (const surface of this.#surfaces) surface.drawing.queue_draw();
		await new Promise<void>((resolve) => {
			this.#resolvePreview = resolve;
			this.#previewTimeoutId = GLib.timeout_add(
				GLib.PRIORITY_DEFAULT,
				selectionPreviewDurationMs,
				() => {
					this.#previewTimeoutId = 0;
					this.#finishPreviewWait();
					return GLib.SOURCE_REMOVE;
				},
			);
		});
		return this.#hideBeforeCapture();
	}

	#finishPreviewWait(): void {
		if (this.#previewTimeoutId !== 0) GLib.source_remove(this.#previewTimeoutId);
		this.#previewTimeoutId = 0;
		const resolve = this.#resolvePreview;
		this.#resolvePreview = null;
		resolve?.();
	}

	async #hideBeforeCapture(): Promise<boolean> {
		const surfaces = this.#surfaces;
		this.#surfaces = [];
		this.#stroke = null;
		this.#selection = null;
		const unmapped = await Promise.all(
			surfaces.map(({ window }) => this.#waitForUnmap(window)),
		);
		Gdk.Display.get_default()?.sync();
		await new Promise<void>((resolve) => {
			GLib.timeout_add(GLib.PRIORITY_DEFAULT, compositorFrameDelayMs, () => {
				resolve();
				return GLib.SOURCE_REMOVE;
			});
		});
		for (const { window } of surfaces) window.destroy();
		return unmapped.every(Boolean);
	}

	#createSurface(
		monitor: Gdk.Monitor,
		index: number,
		onCancel: () => void,
	): StrokeSurface {
		const geometry = monitor.get_geometry();
		const drawing = new Gtk.DrawingArea({ hexpand: true, vexpand: true });
		drawing.add_css_class("ai-pointer-stroke-canvas");
		drawing.set_draw_func((_area, cr: any, width, height) => {
			const selection = this.#selection;
			if (selection) {
				this.#drawSelectionPreview(cr, geometry.x, geometry.y, selection);
				return;
			}
			const stroke = this.#stroke;
			if (!stroke || stroke.points.length < 2) return;
			const color = new Gdk.RGBA();
			color.parse(tokens.colors.accent.primary.value);
			cr.setLineCap(Cairo.LineCap.ROUND);
			cr.setLineJoin(Cairo.LineJoin.ROUND);
			for (const [width, alpha] of [
				[23, 0.05],
				[13.8, 0.12],
				[6.9, 0.55],
				[3.45, 0.96],
			] as const) {
				cr.setSourceRGBA(color.red, color.green, color.blue, alpha);
				cr.setLineWidth(width);
				this.#tracePath(cr, geometry.x, geometry.y);
				cr.stroke();
			}
			const endpoint = stroke.points.at(-1);
			if (!endpoint) return;
			cr.setSourceRGBA(color.red, color.green, color.blue, 0.06);
			cr.arc(endpoint.x - geometry.x, endpoint.y - geometry.y, 20, 0, Math.PI * 2);
			cr.fill();
			cr.setSourceRGBA(color.red, color.green, color.blue, 0.14);
			cr.arc(endpoint.x - geometry.x, endpoint.y - geometry.y, 11, 0, Math.PI * 2);
			cr.fill();
		});

		const window = new Astal.Window({
			application: app,
			name: `ai-pointer-stroke-${index}`,
			namespace: "ags-ai-pointer-drawing",
			visible: false,
		});
		window.add_css_class("ai-pointer");
		window.add_css_class("ai-pointer-stroke");
		window.set_anchor(allEdges);
		window.set_layer(Astal.Layer.OVERLAY);
		window.set_exclusivity(Astal.Exclusivity.IGNORE);
		window.set_keymode(index === 0 ? Astal.Keymode.EXCLUSIVE : Astal.Keymode.NONE);
		window.set_gdkmonitor(monitor);
		window.set_child(drawing);
		window.connect("realize", () => {
			const region = new Cairo.Region();
			window.get_surface()?.set_input_region(region);
		});
		const keyController = new Gtk.EventControllerKey();
		keyController.connect("key-pressed", (_controller, keyval: number) => {
			if (keyval !== Gdk.KEY_Escape) return false;
			onCancel();
			return true;
		});
		window.add_controller(keyController);

		return { window, drawing };
	}

	#drawSelectionPreview(
		cr: any,
		originX: number,
		originY: number,
		selection: SelectionGeometry,
	): void {
		const color = new Gdk.RGBA();
		color.parse(tokens.colors.accent.primary.value);
		const x = selection.x - originX;
		const y = selection.y - originY;
		for (const [width, alpha] of [
			[20, 0.04],
			[10, 0.1],
			[4, 0.18],
		] as const) {
			cr.setSourceRGBA(color.red, color.green, color.blue, alpha);
			cr.setLineWidth(width);
			this.#roundedRectangle(cr, x, y, selection.width, selection.height);
			cr.stroke();
		}
		cr.setSourceRGBA(color.red, color.green, color.blue, 0.16);
		this.#roundedRectangle(cr, x, y, selection.width, selection.height);
		cr.fill();
		cr.setSourceRGBA(color.red, color.green, color.blue, 0.96);
		cr.setLineWidth(2);
		this.#roundedRectangle(cr, x, y, selection.width, selection.height);
		cr.stroke();
	}

	#roundedRectangle(cr: any, x: number, y: number, width: number, height: number): void {
		const radius = Math.min(selectionPreviewRadius, width / 2, height / 2);
		cr.newSubPath();
		cr.arc(x + width - radius, y + radius, radius, -Math.PI / 2, 0);
		cr.arc(x + width - radius, y + height - radius, radius, 0, Math.PI / 2);
		cr.arc(x + radius, y + height - radius, radius, Math.PI / 2, Math.PI);
		cr.arc(x + radius, y + radius, radius, Math.PI, (Math.PI * 3) / 2);
		cr.closePath();
	}

	#tracePath(cr: any, originX: number, originY: number): void {
		const points = this.#stroke?.points;
		if (!points || points.length === 0) return;
		cr.moveTo(points[0].x - originX, points[0].y - originY);
		if (points.length < 3) {
			const endpoint = points.at(-1);
			if (endpoint) cr.lineTo(endpoint.x - originX, endpoint.y - originY);
			return;
		}

		for (let index = 0; index < points.length - 1; index += 1) {
			const previous = points[Math.max(0, index - 1)];
			const current = points[index];
			const next = points[index + 1];
			const following = points[Math.min(points.length - 1, index + 2)];
			cr.curveTo(
				current.x + (next.x - previous.x) * curveTension - originX,
				current.y + (next.y - previous.y) * curveTension - originY,
				next.x - (following.x - current.x) * curveTension - originX,
				next.y - (following.y - current.y) * curveTension - originY,
				next.x - originX,
				next.y - originY,
			);
		}
	}

	#waitForUnmap(window: Astal.Window): Promise<boolean> {
		return new Promise((resolve) => {
			let signalId = 0;
			let timeoutId = 0;
			let settled = false;
			const finish = (unmapped: boolean) => {
				if (settled) return;
				settled = true;
				if (signalId !== 0) window.disconnect(signalId);
				if (timeoutId !== 0) GLib.source_remove(timeoutId);
				signalId = 0;
				timeoutId = 0;
				resolve(unmapped);
			};
			signalId = window.connect("notify::mapped", () => {
				if (window.get_mapped() === false) finish(true);
			});
			timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, unmapTimeoutMs, () => {
				timeoutId = 0;
				finish(window.get_mapped() === false);
				return GLib.SOURCE_REMOVE;
			});
			window.set_visible(false);
			if (window.get_mapped() === false) finish(true);
		});
	}
}
