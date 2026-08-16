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
const selectionPreviewRadius = 14;
const selectionPreviewGlow = 20;
const curveTension = 0.14;

export class StrokeOverlay {
	#surfaces: StrokeSurface[] = [];
	#stroke: PointerStroke | null = null;

	show(stroke: PointerStroke, onCancel: () => void): boolean {
		this.hide();
		const display = Gdk.Display.get_default();
		if (!display) return false;

		const monitors = display.get_monitors();
		for (let index = 0; index < monitors.get_n_items(); index += 1) {
			const monitor = monitors.get_item(index) as Gdk.Monitor | null;
			if (!monitor) continue;
			this.#surfaces.push(
				this.#createSurface(monitor, index, onCancel, true, "ags-ai-pointer-drawing"),
			);
		}
		if (this.#surfaces.length === 0) return false;

		this.update(stroke);
		for (const surface of this.#surfaces) surface.window.set_visible(true);
		return true;
	}

	showSelection(selection: SelectionGeometry): boolean {
		this.hide();
		const display = Gdk.Display.get_default();
		if (!display) return false;

		const monitors = display.get_monitors();
		for (let index = 0; index < monitors.get_n_items(); index += 1) {
			const monitor = monitors.get_item(index) as Gdk.Monitor | null;
			if (!monitor) continue;
			const surface = this.#createSelectionSurface(monitor, index, selection);
			if (surface) this.#surfaces.push(surface);
		}
		if (this.#surfaces.length === 0) return false;

		for (const surface of this.#surfaces) surface.window.set_visible(true);
		return true;
	}

	update(stroke: PointerStroke): void {
		this.#stroke = stroke;
		for (const surface of this.#surfaces) surface.drawing.queue_draw();
	}

	hide(): void {
		for (const surface of this.#surfaces) surface.window.destroy();
		this.#surfaces = [];
		this.#stroke = null;
	}

	async hideBeforeCapture(): Promise<boolean> {
		const surfaces = this.#surfaces;
		this.#surfaces = [];
		this.#stroke = null;
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
		captureKeyboard: boolean,
		namespace: string,
	): StrokeSurface {
		const geometry = monitor.get_geometry();
		const drawing = new Gtk.DrawingArea({ hexpand: true, vexpand: true });
		drawing.add_css_class("ai-pointer-stroke-canvas");
		drawing.set_draw_func((_area, cr: any) => {
			const stroke = this.#stroke;
			if (!stroke || stroke.points.length < 2) return;
			const color = new Gdk.RGBA();
			color.parse(tokens.colors.accent.primary.value);
			cr.setLineCap(Cairo.LineCap.ROUND);
			cr.setLineJoin(Cairo.LineJoin.ROUND);
			for (const [width, alpha] of [
				[34.5, 0.05],
				[20.7, 0.12],
				[10.35, 0.55],
				[5.175, 0.96],
			] as const) {
				cr.setSourceRGBA(color.red, color.green, color.blue, alpha);
				cr.setLineWidth(width);
				this.#tracePath(cr, geometry.x, geometry.y);
				cr.stroke();
			}
			const endpoint = stroke.points.at(-1);
			if (!endpoint) return;
			cr.setSourceRGBA(color.red, color.green, color.blue, 0.06);
			cr.arc(endpoint.x - geometry.x, endpoint.y - geometry.y, 30, 0, Math.PI * 2);
			cr.fill();
			cr.setSourceRGBA(color.red, color.green, color.blue, 0.14);
			cr.arc(endpoint.x - geometry.x, endpoint.y - geometry.y, 16.5, 0, Math.PI * 2);
			cr.fill();
		});

		const window = this.#createWindow(monitor, index, drawing, namespace, captureKeyboard);
		window.set_anchor(allEdges);
		if (captureKeyboard) this.#addCancelController(window, onCancel);

		return { window, drawing };
	}

	#createSelectionSurface(
		monitor: Gdk.Monitor,
		index: number,
		selection: SelectionGeometry,
	): StrokeSurface | null {
		const monitorGeometry = monitor.get_geometry();
		const x = Math.max(selection.x, monitorGeometry.x);
		const y = Math.max(selection.y, monitorGeometry.y);
		const right = Math.min(
			selection.x + selection.width,
			monitorGeometry.x + monitorGeometry.width,
		);
		const bottom = Math.min(
			selection.y + selection.height,
			monitorGeometry.y + monitorGeometry.height,
		);
		if (right <= x || bottom <= y) return null;

		const outerX = Math.max(monitorGeometry.x, x - selectionPreviewGlow);
		const outerY = Math.max(monitorGeometry.y, y - selectionPreviewGlow);
		const outerRight = Math.min(
			monitorGeometry.x + monitorGeometry.width,
			right + selectionPreviewGlow,
		);
		const outerBottom = Math.min(
			monitorGeometry.y + monitorGeometry.height,
			bottom + selectionPreviewGlow,
		);
		const drawing = new Gtk.DrawingArea({
			widthRequest: outerRight - outerX,
			heightRequest: outerBottom - outerY,
		});
		drawing.add_css_class("ai-pointer-stroke-canvas");
		drawing.set_draw_func((_area, cr: any) => {
			this.#drawSelectionPreview(cr, outerX, outerY, {
				x,
				y,
				width: right - x,
				height: bottom - y,
			});
		});
		const window = this.#createWindow(
			monitor,
			index,
			drawing,
			"ags-ai-pointer-selection-preview",
			false,
		);
		window.set_anchor(Astal.WindowAnchor.TOP | Astal.WindowAnchor.LEFT);
		window.set_margin_left(outerX - monitorGeometry.x);
		window.set_margin_top(outerY - monitorGeometry.y);
		return { window, drawing };
	}

	#createWindow(
		monitor: Gdk.Monitor,
		index: number,
		drawing: Gtk.DrawingArea,
		namespace: string,
		captureKeyboard: boolean,
	): Astal.Window {
		const window = new Astal.Window({
			application: app,
			name: `ai-pointer-${namespace}-${index}`,
			namespace,
			visible: false,
		});
		window.add_css_class("ai-pointer");
		window.add_css_class("ai-pointer-stroke");
		window.set_layer(Astal.Layer.OVERLAY);
		window.set_exclusivity(Astal.Exclusivity.IGNORE);
		window.set_keymode(
			captureKeyboard && index === 0 ? Astal.Keymode.EXCLUSIVE : Astal.Keymode.NONE,
		);
		window.set_gdkmonitor(monitor);
		window.set_child(drawing);
		window.connect("realize", () => {
			const region = new Cairo.Region();
			window.get_surface()?.set_input_region(region);
		});
		return window;
	}

	#addCancelController(window: Astal.Window, onCancel: () => void): void {
		const keyController = new Gtk.EventControllerKey();
		keyController.connect("key-pressed", (_controller, keyval: number) => {
			if (keyval !== Gdk.KEY_Escape) return false;
			onCancel();
			return true;
		});
		window.add_controller(keyController);
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
