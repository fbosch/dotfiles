import Cairo from "cairo";
import Gdk from "gi://Gdk?version=4.0";
import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import tokens from "../../../../design-system/tokens.json";
import {
	accessibilityDebugLabel,
	type AccessibilityDebugState,
} from "./accessibility/debug-state";
import type { AccessibilityCandidateDiagnostic } from "./accessibility/policy";
import type { SelectionGeometry } from "./selection";

export const accessibilityDebugFlagPath = GLib.build_filenamev([
	GLib.getenv("XDG_RUNTIME_DIR") || GLib.get_tmp_dir(),
	"ags-ai-pointer-debug",
]);

export function accessibilityDebugEnabled(): boolean {
	try {
		return Gio.File.new_for_path(accessibilityDebugFlagPath).query_exists(null);
	} catch {
		return false;
	}
}

export function drawAccessibilityDiagnostics(
	cr: any,
	originX: number,
	originY: number,
	selection: SelectionGeometry,
	state: AccessibilityDebugState | null,
): void {
	if (state === null) return;
	const x = selection.x - originX;
	const y = selection.y - originY;
	drawDebugLabel(cr, x, y, accessibilityDebugLabel(state));
	if (state.kind !== "evaluated") return;

	for (const diagnostic of state.diagnostics) {
		const color = diagnosticColor(diagnostic);
		const x = diagnostic.geometry.x - originX;
		const y = diagnostic.geometry.y - originY;
		cr.setSourceRGBA(color.red, color.green, color.blue, 0.12);
		cr.rectangle(x, y, diagnostic.geometry.width, diagnostic.geometry.height);
		cr.fillPreserve();
		cr.setSourceRGBA(color.red, color.green, color.blue, 0.95);
		cr.setLineWidth(diagnostic.selected ? 3 : 2);
		cr.stroke();
		const confidence = diagnostic.confidence === undefined
			? ""
			: ` ${(diagnostic.confidence * 100).toFixed(0)}%`;
		const state = diagnostic.selected ? "selected" : diagnostic.reason;
		drawDebugLabel(cr, x, y, `${diagnostic.role}${confidence}: ${state}`, color);
	}
}

function diagnosticColor(diagnostic: AccessibilityCandidateDiagnostic): Gdk.RGBA {
	const color = new Gdk.RGBA();
	color.parse(
		diagnostic.selected
			? tokens.colors.state.success.value
			: diagnostic.reason === "eligible"
				? tokens.colors.state.warning.value
				: tokens.colors.state.error.value,
	);
	return color;
}

function drawDebugLabel(
	cr: any,
	x: number,
	y: number,
	label: string,
	color?: Gdk.RGBA,
): void {
	const text = label.slice(0, 64);
	const width = Math.max(120, text.length * 7 + 12);
	const top = Math.max(0, y - 20);
	cr.setSourceRGBA(0.05, 0.05, 0.05, 0.92);
	cr.rectangle(x, top, width, 20);
	cr.fill();
	cr.setSourceRGBA(color?.red ?? 1, color?.green ?? 1, color?.blue ?? 1, 1);
	cr.selectFontFace("monospace", Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
	cr.setFontSize(11);
	cr.moveTo(x + 6, top + 14);
	cr.showText(text);
}
