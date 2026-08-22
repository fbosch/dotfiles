import Cairo from "cairo";
import Gdk from "gi://Gdk?version=4.0";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import Graphene from "gi://Graphene?version=1.0";
import tokens from "../../../../design-system/tokens.json";
import { drawAccessibilityDiagnostics } from "./accessibility-debug";
import type { AccessibilityDebugState } from "./accessibility/debug-state";
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

export const selectionPreviewGlow = 20;
const selectionPreviewRadius = 14;
const trailFadeBands = 48;
const trailLifetimeMs = 1_400;
const trailGlowRadius = 14;

export class StrokeOverlayRenderer {
	#displaySegments: CubicStrokeSegment[] = [];
	#closedStroke = false;
	#segmentCreatedAtMs: number[] = [];
	#selectionFill = false;
	#selectionDebugState: AccessibilityDebugState | null = null;

	updateStroke(stroke: PointerStroke): void {
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
	}

	setSelection(fill: boolean, debugState: AccessibilityDebugState | null): void {
		this.#selectionFill = fill;
		this.#selectionDebugState = debugState;
	}

	setSelectionFill(enabled: boolean): boolean {
		if (this.#selectionFill === enabled) return false;
		this.#selectionFill = enabled;
		return true;
	}

	setSelectionDebugState(state: AccessibilityDebugState | null): void {
		this.#selectionDebugState = state;
	}

	resetStroke(): void {
		this.#displaySegments = [];
		this.#segmentCreatedAtMs = [];
		this.#closedStroke = false;
	}

	reset(): void {
		this.resetStroke();
		this.#selectionFill = false;
		this.#selectionDebugState = null;
	}

	snapshotStroke(
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

	drawSelectionPreview(
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
		drawAccessibilityDiagnostics(
			cr,
			originX,
			originY,
			selection,
			this.#selectionDebugState,
		);
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
}
