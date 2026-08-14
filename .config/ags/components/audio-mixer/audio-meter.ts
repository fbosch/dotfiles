import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import tokens from "../../../../design-system/tokens.json";
import {
	clamp,
	clampFloat,
	maxVolume,
	meterSegments,
	type AudioBackend,
	type AudioRow,
	volumeLevelIcon,
} from "./model";

interface AudioMeter {
	widget: Gtk.Box;
	dispose: () => void;
}

export function createAudioMeter(
	row: AudioRow,
	label: Gtk.Label,
	mute: Gtk.Button | null,
	registerScroll: (update: (delta: number) => void) => void,
	onSetVolume: AudioBackend["setVolume"],
): AudioMeter {
	let volume = clampFloat(row.volume ?? 0);
	let dragging = false;
	let timeout = 0;
	const dispose = () => {
		if (timeout) GLib.source_remove(timeout);
		timeout = 0;
	};
	const meter = new Gtk.Box({
		orientation: Gtk.Orientation.VERTICAL,
		spacing: 4,
	});
	meter.add_css_class("audio-mixer-meter-wrapper");
	meter.set_hexpand(true);
	meter.set_halign(Gtk.Align.FILL);
	const drawing = new Gtk.DrawingArea();
	drawing.add_css_class("audio-mixer-meter");
	drawing.set_hexpand(true);
	drawing.set_halign(Gtk.Align.FILL);
	drawing.set_size_request(-1, 20);
	drawing.set_cursor_from_name("pointer");

	const update = (next: number, immediate = false) => {
		volume = clampFloat(next);
		row.volume = clamp(volume);
		label.set_label(row.muted ? "Muted" : `${row.volume}%`);
		mute?.set_label(volumeLevelIcon(volume, row.muted));
		drawing.queue_draw();
		if (timeout) GLib.source_remove(timeout);
		if (immediate) onSetVolume(row, volume);
		else
			timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
				timeout = 0;
				onSetVolume(row, volume);
				return GLib.SOURCE_REMOVE;
			});
	};
	registerScroll((delta) => update(volume + delta));
	drawing.set_draw_func((_area, cr: any, width, height) => {
		const visible = row.muted ? 0 : volume;
		const gap = 2;
		const segmentHeight = 8;
		const segmentY = Math.round((height - segmentHeight) / 2);
		const segmentWidth = Math.max(
			2,
			(width - gap * (meterSegments - 1)) / meterSegments,
		);
		for (let index = 0; index < meterSegments; index += 1) {
			const x = index * (segmentWidth + gap);
			const segmentStart = (index / meterSegments) * maxVolume;
			const segmentEnd = ((index + 1) / meterSegments) * maxVolume;
			const fillWidth =
				Math.max(
					0,
					Math.min(1, (visible - segmentStart) / (segmentEnd - segmentStart)),
				) * segmentWidth;
			cr.setSourceRGBA(1, 1, 1, 0.08);
			roundedRect(cr, x, segmentY, segmentWidth, segmentHeight, 2);
			cr.fill();
			if (fillWidth > 0) {
				setSourceHex(cr, tokens.colors.accent.primary.value);
				roundedRect(cr, x, segmentY, fillWidth, segmentHeight, 2);
				cr.fill();
			}
		}
		const thumbX = Math.max(
			3,
			Math.min(width - 3, (visible / maxVolume) * width),
		);
		cr.setSourceRGBA(0, 0, 0, 0.35);
		roundedRect(cr, thumbX - 3, 3, 6, height - 6, 3);
		cr.fill();
		cr.setSourceRGBA(1, 1, 1, row.muted ? 0.5 : 1);
		roundedRect(cr, thumbX - 2, 4, 4, height - 8, 2);
		cr.fill();
	});

	const click = new Gtk.GestureClick();
	click.set_button(0);
	click.connect("pressed", (_controller, _presses, x) => {
		dragging = true;
		update(volumeFromX(drawing, x, volume));
	});
	click.connect("released", (_controller, _presses, x) => {
		update(volumeFromX(drawing, x, volume), true);
		dragging = false;
	});
	drawing.add_controller(click);
	const motion = new Gtk.EventControllerMotion();
	motion.connect("motion", (_controller, x) => {
		if (dragging) update(volumeFromX(drawing, x, volume));
	});
	motion.connect("leave", () => {
		if (dragging) {
			update(volume, true);
			dragging = false;
		}
	});
	drawing.add_controller(motion);
	meter.append(drawing);

	const rowWrapper = new Gtk.Box({
		orientation: Gtk.Orientation.HORIZONTAL,
		spacing: 10,
	});
	rowWrapper.set_hexpand(true);
	rowWrapper.set_halign(Gtk.Align.FILL);
	const indent = new Gtk.Box();
	indent.set_size_request(36, -1);
	indent.set_hexpand(false);
	rowWrapper.append(indent);
	rowWrapper.append(meter);
	return { widget: rowWrapper, dispose };
}

function volumeFromX(
	drawing: Gtk.DrawingArea,
	x: number,
	fallback: number,
): number {
	const width = drawing.get_allocation().width;
	return width > 0 ? (x / width) * maxVolume : fallback;
}

function setSourceHex(cr: any, hex: string): void {
	const normalized = hex.replace("#", "");
	cr.setSourceRGBA(
		Number.parseInt(normalized.slice(0, 2), 16) / 255,
		Number.parseInt(normalized.slice(2, 4), 16) / 255,
		Number.parseInt(normalized.slice(4, 6), 16) / 255,
		1,
	);
}

function roundedRect(
	cr: any,
	x: number,
	y: number,
	width: number,
	height: number,
	radius: number,
): void {
	const r = Math.min(radius, width / 2, height / 2);
	cr.newSubPath();
	cr.arc(x + width - r, y + r, r, -Math.PI / 2, 0);
	cr.arc(x + width - r, y + height - r, r, 0, Math.PI / 2);
	cr.arc(x + r, y + height - r, r, Math.PI / 2, Math.PI);
	cr.arc(x + r, y + r, r, Math.PI, (Math.PI * 3) / 2);
	cr.closePath();
}
