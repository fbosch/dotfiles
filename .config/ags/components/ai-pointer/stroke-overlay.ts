import { Astal } from "ags/gtk4";
import app from "ags/gtk4/app";
import Cairo from "cairo";
import Gdk from "gi://Gdk?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import GLib from "gi://GLib?version=2.0";
import tokens from "../../../../design-system/tokens.json";
import type { PointerPosition } from "./selection";

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

export class StrokeOverlay {
	#surfaces: StrokeSurface[] = [];
	#points: PointerPosition[] = [];

	show(points: PointerPosition[], onCancel: () => void): boolean {
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

		this.update(points);
		for (const surface of this.#surfaces) surface.window.set_visible(true);
		return true;
	}

	update(points: PointerPosition[]): void {
		this.#points = points;
		for (const surface of this.#surfaces) surface.drawing.queue_draw();
	}

	hide(): void {
		for (const surface of this.#surfaces) surface.window.destroy();
		this.#surfaces = [];
		this.#points = [];
	}

	async hideBeforeCapture(): Promise<boolean> {
		const surfaces = this.#surfaces;
		this.#surfaces = [];
		this.#points = [];
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
		drawing.set_draw_func((_area, cr: any) => {
			if (this.#points.length < 2) return;
			const color = new Gdk.RGBA();
			color.parse(tokens.colors.accent.primary.value);
			cr.setSourceRGBA(color.red, color.green, color.blue, 0.9);
			cr.setLineWidth(4);
			cr.setLineCap(Cairo.LineCap.ROUND);
			cr.setLineJoin(Cairo.LineJoin.ROUND);
			cr.moveTo(
				this.#points[0].x - geometry.x,
				this.#points[0].y - geometry.y,
			);
			for (const point of this.#points.slice(1))
				cr.lineTo(point.x - geometry.x, point.y - geometry.y);
			cr.stroke();
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
			region.$dispose();
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

	#waitForUnmap(window: Astal.Window): Promise<boolean> {
		return new Promise((resolve) => {
			let signalId = 0;
			let timeoutId = 0;
			const finish = (unmapped: boolean) => {
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
