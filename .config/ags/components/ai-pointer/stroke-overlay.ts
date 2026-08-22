import { Astal } from "ags/gtk4";
import app from "ags/gtk4/app";
import Cairo from "cairo";
import Gdk from "gi://Gdk?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import GLib from "gi://GLib?version=2.0";
import GObject from "gi://GObject?version=2.0";
import type { AccessibilityDebugState } from "./accessibility/debug-state";
import { createCancelController } from "./cancel-controller";
import type { PointerPosition, SelectionGeometry } from "./selection";
import type { PointerStroke } from "./stroke";
import { selectionPreviewGlow, StrokeOverlayRenderer } from "./stroke-overlay-renderer";

interface StrokeSurface {
	window: Astal.Window;
	drawing: Gtk.Widget;
	bounds: SelectionGeometry;
}

type SnapshotRenderer = (snapshot: Gtk.Snapshot, width: number, height: number) => void;

const StrokeCanvas = GObject.registerClass(
	{ GTypeName: "AgsAiPointerStrokeCanvas" },
	class extends Gtk.Widget {
		renderer: SnapshotRenderer | null = null;

		vfunc_snapshot(snapshot: Gtk.Snapshot): void {
			this.renderer?.(snapshot, this.get_width(), this.get_height());
		}
	},
);

const allEdges =
	Astal.WindowAnchor.TOP |
	Astal.WindowAnchor.BOTTOM |
	Astal.WindowAnchor.LEFT |
	Astal.WindowAnchor.RIGHT;
const unmapTimeoutMs = 250;
const compositorFrameDelayMs = 34;

export class StrokeOverlay {
	#surfaces: StrokeSurface[] = [];
	#frameDrawing: Gtk.Widget | null = null;
	#frameCallbackId = 0;
	readonly #renderer = new StrokeOverlayRenderer();

	get isVisible(): boolean {
		return this.#surfaces.length > 0;
	}

	show(stroke: PointerStroke, onCancel: () => void, onFrame: () => void): boolean {
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
		this.#startFrameCallback(stroke.points[0], onFrame);
		return true;
	}

	showSelection(
		selection: SelectionGeometry,
		fill = false,
		debugState: AccessibilityDebugState | null = null,
		debugBounds: AccessibilityDebugState | null = debugState,
	): boolean {
		this.hide();
		this.#renderer.setSelection(fill, debugState);
		const display = Gdk.Display.get_default();
		if (!display) return false;

		const monitors = display.get_monitors();
		for (let index = 0; index < monitors.get_n_items(); index += 1) {
			const monitor = monitors.get_item(index) as Gdk.Monitor | null;
			if (!monitor) continue;
			const surface = this.#createSelectionSurface(monitor, index, selection, debugBounds);
			if (surface) this.#surfaces.push(surface);
		}
		if (this.#surfaces.length === 0) return false;

		for (const surface of this.#surfaces) surface.window.set_visible(true);
		return true;
	}

	setSelectionFill(enabled: boolean): void {
		if (this.#renderer.setSelectionFill(enabled) === false) return;
		for (const surface of this.#surfaces) surface.drawing.queue_draw();
	}

	setSelectionDebugState(state: AccessibilityDebugState | null): void {
		this.#renderer.setSelectionDebugState(state);
		for (const surface of this.#surfaces) surface.drawing.queue_draw();
	}

	update(stroke: PointerStroke): void {
		this.#renderer.updateStroke(stroke);
		for (const surface of this.#surfaces) surface.drawing.queue_draw();
	}

	hide(): void {
		this.#stopFrameCallback();
		for (const surface of this.#surfaces) surface.window.destroy();
		this.#surfaces = [];
		this.#renderer.reset();
	}

	async hideBeforeCapture(): Promise<boolean> {
		this.#stopFrameCallback();
		const surfaces = this.#surfaces;
		this.#surfaces = [];
		this.#renderer.resetStroke();
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
		const drawing = new StrokeCanvas({ hexpand: true, vexpand: true });
		drawing.add_css_class("ai-pointer-stroke-canvas");
		drawing.renderer = (snapshot, width, height) => {
			this.#renderer.snapshotStroke(snapshot, width, height, geometry.x, geometry.y);
		};

		const window = this.#createWindow(monitor, index, drawing, namespace, captureKeyboard);
		window.set_anchor(allEdges);
		if (captureKeyboard) this.#addCancelController(window, onCancel);

		return {
			window,
			drawing,
			bounds: {
				x: geometry.x,
				y: geometry.y,
				width: geometry.width,
				height: geometry.height,
			},
		};
	}

	#createSelectionSurface(
		monitor: Gdk.Monitor,
		index: number,
		selection: SelectionGeometry,
		debugState: AccessibilityDebugState | null,
	): StrokeSurface | null {
		const monitorGeometry = monitor.get_geometry();
		const debugGeometries = debugState?.kind === "evaluated"
			? debugState.diagnostics.map(({ geometry }) => geometry)
			: [];
		const geometries = [selection, ...debugGeometries];
		const outerX = Math.max(
			monitorGeometry.x,
			Math.min(...geometries.map(({ x }) => x)) - selectionPreviewGlow,
		);
		const outerY = Math.max(
			monitorGeometry.y,
			Math.min(...geometries.map(({ y }) => y)) - selectionPreviewGlow,
		);
		const outerRight = Math.min(
			Math.max(...geometries.map(({ x, width }) => x + width)) + selectionPreviewGlow,
			monitorGeometry.x + monitorGeometry.width,
		);
		const outerBottom = Math.min(
			Math.max(...geometries.map(({ y, height }) => y + height)) + selectionPreviewGlow,
			monitorGeometry.y + monitorGeometry.height,
		);
		if (outerRight <= outerX || outerBottom <= outerY) return null;
		const drawing = new Gtk.DrawingArea({
			widthRequest: outerRight - outerX,
			heightRequest: outerBottom - outerY,
		});
		drawing.add_css_class("ai-pointer-stroke-canvas");
		drawing.set_draw_func((area, cr: any) => {
			this.#renderer.drawSelectionPreview(
				cr,
				outerX,
				outerY,
				selection,
				area.get_width(),
				area.get_height(),
			);
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
		return {
			window,
			drawing,
			bounds: {
				x: monitorGeometry.x,
				y: monitorGeometry.y,
				width: monitorGeometry.width,
				height: monitorGeometry.height,
			},
		};
	}

	#startFrameCallback(point: PointerPosition, onFrame: () => void): void {
		const surface = this.#surfaces.find(
			({ bounds }) =>
				point.x >= bounds.x &&
				point.x < bounds.x + bounds.width &&
				point.y >= bounds.y &&
				point.y < bounds.y + bounds.height,
		) ?? this.#surfaces[0];
		if (!surface) return;

		this.#frameDrawing = surface.drawing;
		this.#frameCallbackId = surface.drawing.add_tick_callback(() => {
			onFrame();
			return this.#frameCallbackId !== 0;
		});
	}

	#stopFrameCallback(): void {
		if (this.#frameCallbackId !== 0)
			this.#frameDrawing?.remove_tick_callback(this.#frameCallbackId);
		this.#frameCallbackId = 0;
		this.#frameDrawing = null;
	}

	#createWindow(
		monitor: Gdk.Monitor,
		index: number,
		drawing: Gtk.Widget,
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
		window.add_controller(createCancelController(onCancel));
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
