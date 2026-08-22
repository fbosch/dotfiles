import { Astal } from "ags/gtk4";
import app from "ags/gtk4/app";
import Cairo from "cairo";
import Gdk from "gi://Gdk?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import GLib from "gi://GLib?version=2.0";
import GObject from "gi://GObject?version=2.0";
import Graphene from "gi://Graphene?version=1.0";
import tokens from "../../../../design-system/tokens.json";
import { createCancelController } from "./cancel-controller";
import type { PointerPosition, SelectionGeometry } from "./selection";
import {
	bsplineStrokeSegments,
	closedBsplineStrokeSegments,
	type CubicStrokeSegment,
	isClosedStroke,
	type PointerStroke,
	resampledStrokePoints,
	strokeBrushRadius,
	subdivideStrokeSegments,
	temporalTrailFade,
} from "./stroke";

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
const selectionPreviewRadius = 14;
const selectionPreviewGlow = 20;
const trailFadeBands = 48;
const trailLifetimeMs = 1_400;
const trailGlowRadius = 14;

export class StrokeOverlay {
	#surfaces: StrokeSurface[] = [];
	#stroke: PointerStroke | null = null;
	#displaySegments: CubicStrokeSegment[] = [];
	#closedStroke = false;
	#segmentCreatedAtMs: number[] = [];
	#frameDrawing: Gtk.Widget | null = null;
	#frameCallbackId = 0;
	#selectionFill = false;

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

	showSelection(selection: SelectionGeometry, fill = false): boolean {
		this.hide();
		this.#selectionFill = fill;
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

	setSelectionFill(enabled: boolean): void {
		if (this.#selectionFill === enabled) return;
		this.#selectionFill = enabled;
		for (const surface of this.#surfaces) surface.drawing.queue_draw();
	}

	update(stroke: PointerStroke): void {
		this.#stroke = stroke;
		const previousCreatedAt = new Map(
			this.#displaySegments.map((segment, index) => [
				this.#segmentKey(segment),
				this.#segmentCreatedAtMs[index],
			]),
		);
		const displayPoints = resampledStrokePoints(stroke.points);
		this.#closedStroke = isClosedStroke(displayPoints);
		const segments = subdivideStrokeSegments(
			this.#closedStroke
				? closedBsplineStrokeSegments(displayPoints)
				: bsplineStrokeSegments(displayPoints),
			2,
		);
		const now = GLib.get_monotonic_time() / 1_000;
		this.#displaySegments = segments;
		this.#segmentCreatedAtMs = segments.map(
			(segment) => previousCreatedAt.get(this.#segmentKey(segment)) ?? now,
		);
		for (const surface of this.#surfaces) surface.drawing.queue_draw();
	}

	hide(): void {
		this.#stopFrameCallback();
		for (const surface of this.#surfaces) surface.window.destroy();
		this.#surfaces = [];
		this.#stroke = null;
		this.#displaySegments = [];
		this.#segmentCreatedAtMs = [];
		this.#closedStroke = false;
		this.#selectionFill = false;
	}

	async hideBeforeCapture(): Promise<boolean> {
		this.#stopFrameCallback();
		const surfaces = this.#surfaces;
		this.#surfaces = [];
		this.#stroke = null;
		this.#displaySegments = [];
		this.#segmentCreatedAtMs = [];
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
			this.#snapshotStroke(snapshot, width, height, geometry.x, geometry.y);
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

	#snapshotStroke(
		snapshot: Gtk.Snapshot,
		width: number,
		height: number,
		originX: number,
		originY: number,
	): void {
		const segments = this.#displaySegments;
		if (segments.length === 0 || width <= 0 || height <= 0) return;
		const color = new Gdk.RGBA();
		color.parse(tokens.colors.accent.primary.value);
		const bounds = this.#strokeRenderBounds(segments, width, height, originX, originY);
		if (!bounds) return;
		const brushDiameter = strokeBrushRadius * 2;

		snapshot.push_blur(trailGlowRadius);
		const glow = snapshot.append_cairo(bounds);
		try {
			this.#drawTrailLayer(
				glow,
				segments,
				color,
				brushDiameter * 0.42,
				0.3,
				originX,
				originY,
			);
		} finally {
			glow.$dispose();
		}
		snapshot.pop();

		const core = snapshot.append_cairo(bounds);
		try {
			this.#drawTrailLayer(
				core,
				segments,
				color,
				brushDiameter * 0.3,
				0.55,
				originX,
				originY,
			);
			this.#drawTrailLayer(
				core,
				segments,
				color,
				brushDiameter * 0.15,
				0.96,
				originX,
				originY,
			);
		} finally {
			core.$dispose();
		}
	}

	#strokeRenderBounds(
		segments: CubicStrokeSegment[],
		width: number,
		height: number,
		originX: number,
		originY: number,
	): Graphene.Rect | null {
		const points = segments.flatMap(({ start, control1, control2, end }) => [
			start,
			control1,
			control2,
			end,
		]);
		const padding = strokeBrushRadius + trailGlowRadius;
		const left = Math.max(0, Math.min(...points.map(({ x }) => x)) - originX - padding);
		const top = Math.max(0, Math.min(...points.map(({ y }) => y)) - originY - padding);
		const right = Math.min(
			width,
			Math.max(...points.map(({ x }) => x)) - originX + padding,
		);
		const bottom = Math.min(
			height,
			Math.max(...points.map(({ y }) => y)) - originY + padding,
		);
		if (right <= left || bottom <= top) return null;
		return new Graphene.Rect().init(left, top, right - left, bottom - top);
	}

	#drawTrailLayer(
		cr: any,
		segments: CubicStrokeSegment[],
		color: Gdk.RGBA,
		width: number,
		alpha: number,
		originX: number,
		originY: number,
	): void {
		const endpoint = segments.at(-1)?.end;
		if (!endpoint) return;
		const now = GLib.get_monotonic_time() / 1_000;
		const bandCount = Math.min(trailFadeBands, segments.length);
		cr.setAntialias(Cairo.Antialias.BEST);
		cr.setLineCap(Cairo.LineCap.BUTT);
		cr.setLineJoin(Cairo.LineJoin.ROUND);
		for (let band = 0; band < bandCount; band += 1) {
			const progress = (band + 0.5) / bandCount;
			const smoothProgress = progress * progress * (3 - 2 * progress);
			const distanceFade = 0.05 + Math.pow(smoothProgress, 1.15) * 0.95;
			const start = Math.floor((band * segments.length) / bandCount);
			const end = Math.floor(((band + 1) * segments.length) / bandCount);
			const createdAt = this.#segmentCreatedAtMs[Math.max(start, end - 1)] ?? now;
			const timeFade = temporalTrailFade(now - createdAt, trailLifetimeMs);
			if (timeFade === 0) continue;
			cr.setSourceRGBA(color.red, color.green, color.blue, alpha * distanceFade * timeFade);
			cr.setLineWidth(width * (0.25 + smoothProgress * 0.75));
			this.#tracePath(cr, segments, start, end, originX, originY);
			cr.stroke();
		}
		if (this.#closedStroke === false) {
			cr.setSourceRGBA(color.red, color.green, color.blue, alpha);
			cr.arc(endpoint.x - originX, endpoint.y - originY, width / 2, 0, Math.PI * 2);
			cr.fill();
		}
	}

	#createSelectionSurface(
		monitor: Gdk.Monitor,
		index: number,
		selection: SelectionGeometry,
	): StrokeSurface | null {
		const monitorGeometry = monitor.get_geometry();
		const outerX = Math.max(monitorGeometry.x, selection.x - selectionPreviewGlow);
		const outerY = Math.max(monitorGeometry.y, selection.y - selectionPreviewGlow);
		const outerRight = Math.min(
			selection.x + selection.width + selectionPreviewGlow,
			monitorGeometry.x + monitorGeometry.width,
		);
		const outerBottom = Math.min(
			selection.y + selection.height + selectionPreviewGlow,
			monitorGeometry.y + monitorGeometry.height,
		);
		if (outerRight <= outerX || outerBottom <= outerY) return null;
		const drawing = new Gtk.DrawingArea({
			widthRequest: outerRight - outerX,
			heightRequest: outerBottom - outerY,
		});
		drawing.add_css_class("ai-pointer-stroke-canvas");
		drawing.set_draw_func((area, cr: any) => {
			this.#drawSelectionPreview(
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

	#drawSelectionPreview(
		cr: any,
		originX: number,
		originY: number,
		selection: SelectionGeometry,
		surfaceWidth: number,
		surfaceHeight: number,
	): void {
		const color = new Gdk.RGBA();
		color.parse(tokens.colors.accent.primary.value);
		if (this.#selectionFill) {
			cr.setSourceRGBA(color.red, color.green, color.blue, 0.06);
			this.#roundedRectangle(
				cr,
				selection.x - originX,
				selection.y - originY,
				selection.width,
				selection.height,
			);
			cr.fill();
		}
		// Keep the highlight outside captured pixels so it can remain mapped without contaminating the attachment.
		for (const [width, alpha] of [
			[20, 0.04],
			[10, 0.1],
			[4, 0.18],
			[2, 0.96],
		] as const) {
			const expansion = Math.max(width / 2 + 1, selectionPreviewRadius / 3.4);
			this.#drawOutsideSelection(
				cr,
				selection.x - originX,
				selection.y - originY,
				selection.width,
				selection.height,
				surfaceWidth,
				surfaceHeight,
				expansion,
				width,
				alpha,
				color,
			);
		}
	}

	#drawOutsideSelection(
		cr: any,
		x: number,
		y: number,
		width: number,
		height: number,
		surfaceWidth: number,
		surfaceHeight: number,
		expansion: number,
		lineWidth: number,
		alpha: number,
		color: Gdk.RGBA,
	): void {
		const regions = [
			[0, 0, surfaceWidth, y],
			[0, y + height, surfaceWidth, surfaceHeight - y - height],
			[0, y, x, height],
			[x + width, y, surfaceWidth - x - width, height],
		] as const;
		for (const [clipX, clipY, clipWidth, clipHeight] of regions) {
			if (clipWidth <= 0 || clipHeight <= 0) continue;
			cr.save();
			cr.rectangle(clipX, clipY, clipWidth, clipHeight);
			cr.clip();
			cr.setSourceRGBA(color.red, color.green, color.blue, alpha);
			cr.setLineWidth(lineWidth);
			this.#roundedRectangle(
				cr,
				x - expansion,
				y - expansion,
				width + expansion * 2,
				height + expansion * 2,
				selectionPreviewRadius,
			);
			cr.stroke();
			cr.restore();
		}
	}

	#roundedRectangle(
		cr: any,
		x: number,
		y: number,
		width: number,
		height: number,
		maximumRadius = selectionPreviewRadius,
	): void {
		const radius = Math.min(maximumRadius, width / 2, height / 2);
		cr.newSubPath();
		cr.arc(x + width - radius, y + radius, radius, -Math.PI / 2, 0);
		cr.arc(x + width - radius, y + height - radius, radius, 0, Math.PI / 2);
		cr.arc(x + radius, y + height - radius, radius, Math.PI / 2, Math.PI);
		cr.arc(x + radius, y + radius, radius, Math.PI, (Math.PI * 3) / 2);
		cr.closePath();
	}

	#tracePath(
		cr: any,
		segments: CubicStrokeSegment[],
		start: number,
		end: number,
		originX: number,
		originY: number,
	): void {
		const first = segments[start];
		if (!first) return;
		cr.moveTo(first.start.x - originX, first.start.y - originY);
		for (let index = start; index < end; index += 1) {
			const segment = segments[index];
			cr.curveTo(
				segment.control1.x - originX,
				segment.control1.y - originY,
				segment.control2.x - originX,
				segment.control2.y - originY,
				segment.end.x - originX,
				segment.end.y - originY,
			);
		}
	}

	#segmentKey(segment: CubicStrokeSegment): string {
		return `${segment.start.x.toFixed(2)},${segment.start.y.toFixed(2)}:${segment.end.x.toFixed(2)},${segment.end.y.toFixed(2)}`;
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
