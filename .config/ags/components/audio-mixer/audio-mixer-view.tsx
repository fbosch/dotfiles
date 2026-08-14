import { createRoot } from "ags";
import app from "ags/gtk4/app";
import { Astal } from "ags/gtk4";
import Gdk from "gi://Gdk?version=4.0";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import { setImageFile } from "../../services/app-icons";
import { bindGamingOpacity } from "../../services/gaming-opacity";
import { getPointerMonitor } from "../../services/pointer-monitor";
import { createButton, setButtonVariant } from "../button";
import { createAudioMeter } from "./audio-meter";
import {
	clamp,
	tabs,
	volumeLevelIcon,
	type AudioBackend,
	type AudioMixerTab,
	type AudioRow,
	type AudioSnapshot,
} from "./model";

export interface AudioMixerViewActions {
	onHide: () => void;
	isVisible: () => boolean;
	onSetVolume: AudioBackend["setVolume"];
	onToggleMute: AudioBackend["toggleMute"];
	onSetDefault: AudioBackend["setDefault"];
}

export class AudioMixerView {
	#win: Astal.Window | null = null;
	#box: Gtk.Box | null = null;
	#tabBar: Gtk.Box | null = null;
	#rows: Gtk.Box | null = null;
	#windowDispose: (() => void) | null = null;
	#focusSource = 0;
	#tabButtons = new Map<AudioMixerTab, Gtk.Button>();
	#rowCards: Gtk.Box[] = [];
	#meterDisposers: Array<() => void> = [];
	#snapshot: AudioSnapshot;
	#activeTab: AudioMixerTab = "playback";
	#focusedRow = 0;
	#focusVisible = false;
	constructor(
		private readonly actions: AudioMixerViewActions,
		snapshot: AudioSnapshot,
	) {
		this.#snapshot = snapshot;
	}
	get isCreated(): boolean {
		return this.#win !== null;
	}
	create(): void {
		if (this.#win) return;
		createRoot((dispose) => {
			this.#windowDispose = dispose;
			this.#win = (
				<window
					name="audio-mixer-widget"
					namespace="ags-audio-mixer-widget"
					visible={false}
					anchor={
						Astal.WindowAnchor.TOP |
						Astal.WindowAnchor.BOTTOM |
						Astal.WindowAnchor.LEFT |
						Astal.WindowAnchor.RIGHT
					}
					layer={Astal.Layer.OVERLAY}
					exclusivity={Astal.Exclusivity.IGNORE}
					keymode={Astal.Keymode.ON_DEMAND}
					application={app}
					class="audio-mixer-widget"
					$={(window: Astal.Window) => this.#configureWindow(window)}
				>
					<box
						orientation={Gtk.Orientation.VERTICAL}
						valign={Gtk.Align.END}
						halign={Gtk.Align.END}
					>
						<box
							orientation={Gtk.Orientation.VERTICAL}
							spacing={0}
							class="audio-mixer-container"
							$={(box: Gtk.Box) => {
								this.#box = box;
								box.set_size_request(500, -1);
								this.#build();
							}}
						/>
					</box>
				</window>
			) as Astal.Window;
		});
	}
	show(): void {
		this.create();
		if (!this.#win) return;
		try {
			const monitor = getPointerMonitor();
			if (monitor) this.#win.set_gdkmonitor(monitor.monitor);
		} catch (cause) {
			console.error("Failed to resolve audio mixer trigger monitor:", cause);
		}
		this.#win.set_visible(true);
	}
	hide(): void {
		this.#win?.set_visible(false);
	}
	setSnapshot(snapshot: AudioSnapshot): void {
		this.#snapshot = snapshot;
		this.render();
	}
	setTab(tab: AudioMixerTab): void {
		this.#activeTab = tab;
		this.#focusedRow = 0;
		this.#focusVisible = false;
		for (const [id, button] of this.#tabButtons)
			setButtonVariant(button, id === tab ? "primary" : "transparent");
		this.render();
	}
	dispose(): void {
		this.#clearFocusSource();
		this.#disposeMeters();
		this.#windowDispose?.();
		this.#windowDispose = null;
		this.#win = null;
		this.#box = null;
		this.#tabBar = null;
		this.#rows = null;
		this.#tabButtons.clear();
		this.#rowCards = [];
	}
	#configureWindow(window: Astal.Window): void {
		bindGamingOpacity(window);
		const keys = new Gtk.EventControllerKey();
		keys.connect("key-pressed", (_c, key, _code, state) =>
			this.#key(key, state),
		);
		window.add_controller(keys);
		const click = new Gtk.GestureClick();
		click.set_button(0);
		click.connect("pressed", (_c, _presses, x, y) => {
			const target = window.pick(x, y, Gtk.PickFlags.DEFAULT);
			if (this.actions.isVisible() && !this.#isDescendant(target))
				this.actions.onHide();
		});
		window.add_controller(click);
	}
	#isDescendant(widget: Gtk.Widget | null): boolean {
		let current = widget;
		while (current) {
			if (current === this.#box) return true;
			current = current.get_parent();
		}
		return false;
	}
	#key(key: number, state: Gdk.ModifierType): boolean {
		if (key === Gdk.KEY_Escape) {
			this.actions.onHide();
			return true;
		}
		if (key === Gdk.KEY_Tab || key === Gdk.KEY_ISO_Left_Tab) {
			this.#adjacent(
				key === Gdk.KEY_ISO_Left_Tab ||
					(state & Gdk.ModifierType.SHIFT_MASK) !== 0
					? -1
					: 1,
			);
			return true;
		}
		return this.#rowKey(key, state);
	}
	#adjacent(direction: 1 | -1): void {
		const index = tabs.findIndex((tab) => tab.id === this.#activeTab);
		this.setTab(tabs[(index + direction + tabs.length) % tabs.length].id);
	}
	#activeRows(): AudioRow[] {
		return this.#snapshot.rows[this.#activeTab] ?? [];
	}
	#focus(index: number, visible = this.#focusVisible): void {
		if (!this.#rowCards.length) return;
		this.#focusedRow = Math.max(0, Math.min(this.#rowCards.length - 1, index));
		this.#focusVisible = visible;
		this.#rowCards.forEach((card, current) => {
			if (visible && current === this.#focusedRow)
				card.add_css_class("focused");
			else card.remove_css_class("focused");
		});
		this.#rowCards[this.#focusedRow]?.grab_focus();
	}
	#rowKey(key: number, state: Gdk.ModifierType): boolean {
		const rows = this.#activeRows();
		if (!rows.length) return false;
		if ([Gdk.KEY_Up, Gdk.KEY_k, Gdk.KEY_K].includes(key)) {
			this.#focus(this.#focusedRow - 1, true);
			return true;
		}
		if ([Gdk.KEY_Down, Gdk.KEY_j, Gdk.KEY_J].includes(key)) {
			this.#focus(this.#focusedRow + 1, true);
			return true;
		}
		const row = rows[this.#focusedRow];
		if (
			[
				Gdk.KEY_Left,
				Gdk.KEY_Right,
				Gdk.KEY_h,
				Gdk.KEY_H,
				Gdk.KEY_l,
				Gdk.KEY_L,
			].includes(key)
		) {
			const decrease = [Gdk.KEY_Left, Gdk.KEY_h, Gdk.KEY_H].includes(key);
			this.#adjust(
				row,
				decrease
					? -((state & Gdk.ModifierType.SHIFT_MASK) !== 0 ? 10 : 5)
					: (state & Gdk.ModifierType.SHIFT_MASK) !== 0
						? 10
						: 5,
			);
			this.#focus(this.#focusedRow, true);
			return true;
		}
		if (key === Gdk.KEY_space) {
			this.#mute(row, this.#focusedRow, true);
			return true;
		}
		return false;
	}
	#adjust(row: AudioRow, delta: number): void {
		if (row.volume === undefined) return;
		this.actions.onSetVolume(row, row.volume + delta);
		this.render();
	}
	#mute(row: AudioRow, index: number, visible = this.#focusVisible): void {
		this.actions.onToggleMute(row);
		this.render();
		this.#focus(index, visible);
	}
	#build(): void {
		if (!this.#box) return;
		this.#clear(this.#box);
		const body = new Gtk.Box({
			orientation: Gtk.Orientation.VERTICAL,
			spacing: 8,
		});
		body.add_css_class("audio-mixer-body");
		body.set_size_request(500, -1);
		this.#rows = body;
		this.#box.append(body);
		const footer = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL });
		footer.add_css_class("audio-mixer-footer");
		const bar = new Gtk.Box({
			orientation: Gtk.Orientation.HORIZONTAL,
			spacing: 4,
			homogeneous: true,
		});
		bar.add_css_class("audio-mixer-tabs");
		bar.set_hexpand(true);
		bar.set_size_request(476, -1);
		this.#tabBar = bar;
		footer.append(bar);
		this.#box.append(footer);
		for (const tab of tabs) bar.append(this.#tabButton(tab));
		this.render();
	}
	#tabButton(tab: {
		id: AudioMixerTab;
		label: string;
		icon: string;
	}): Gtk.Button {
		const button = createButton({
			variant: tab.id === this.#activeTab ? "primary" : "transparent",
			className: "audio-mixer-tab",
			hexpand: true,
			onClick: () => this.setTab(tab.id),
		});
		const label = new Gtk.Label({ label: "" });
		label.add_css_class("audio-mixer-tab-label");
		label.set_use_markup(true);
		label.set_markup(`<span rise="-1800">${tab.icon}</span>  ${tab.label}`);
		label.set_size_request(112, 20);
		label.set_halign(Gtk.Align.CENTER);
		label.set_valign(Gtk.Align.CENTER);
		label.set_xalign(0.5);
		label.set_yalign(0.5);
		label.set_ellipsize(3);
		button.set_child(label);
		this.#tabButtons.set(tab.id, button);
		return button;
	}
	render(): void {
		if (!this.#rows) return;
		this.#clearFocusSource();
		this.#disposeMeters();
		this.#clear(this.#rows);
		this.#rowCards = [];
		const rows = this.#activeRows();
		if (!rows.length) {
			this.#focusedRow = 0;
			this.#rows.append(this.#empty());
			return;
		}
		this.#focusedRow = Math.max(0, Math.min(this.#focusedRow, rows.length - 1));
		rows.forEach((row, index) => {
			const card = this.#row(row, index);
			this.#rowCards.push(card);
			this.#rows?.append(card);
		});
		if (this.actions.isVisible())
			this.#focusSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
				this.#focusSource = 0;
				this.#focus(this.#focusedRow);
				return GLib.SOURCE_REMOVE;
			});
	}
	#clear(box: Gtk.Box): void {
		let child = box.get_first_child();
		while (child) {
			box.remove(child);
			child = box.get_first_child();
		}
	}
	#empty(): Gtk.Box {
		const empty = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
		empty.add_css_class("audio-mixer-empty");
		empty.set_hexpand(true);
		empty.set_vexpand(true);
		empty.set_halign(Gtk.Align.FILL);
		const top = new Gtk.Box();
		top.set_vexpand(true);
		const content = new Gtk.Box({
			orientation: Gtk.Orientation.VERTICAL,
			spacing: 8,
		});
		content.add_css_class("audio-mixer-empty-content");
		content.set_halign(Gtk.Align.CENTER);
		const icon = new Gtk.Label({ label: "\uE7F4" });
		icon.add_css_class("audio-mixer-icon-label");
		icon.set_halign(Gtk.Align.CENTER);
		const label = new Gtk.Label({
			label:
				this.#snapshot.status === "loading"
					? "Loading audio"
					: this.#snapshot.message || "No audio objects",
		});
		label.add_css_class("audio-mixer-empty-label");
		label.set_halign(Gtk.Align.CENTER);
		content.append(icon);
		content.append(label);
		const bottom = new Gtk.Box();
		bottom.set_vexpand(true);
		empty.append(top);
		empty.append(content);
		empty.append(bottom);
		return empty;
	}
	#row(row: AudioRow, index: number): Gtk.Box {
		const card = new Gtk.Box({
			orientation: Gtk.Orientation.VERTICAL,
			spacing: 0,
		});
		card.add_css_class("audio-mixer-row");
		card.set_hexpand(true);
		card.set_halign(Gtk.Align.FILL);
		card.set_focusable(true);
		if (row.muted) card.add_css_class("muted");
		if (this.#focusVisible && index === this.#focusedRow)
			card.add_css_class("focused");
		const focus = new Gtk.EventControllerFocus();
		focus.connect("enter", () => this.#focus(index));
		card.add_controller(focus);
		const keys = new Gtk.EventControllerKey();
		keys.connect("key-pressed", (_c, key, _code, state) => {
			this.#focusedRow = index;
			if (this.#rowKey(key, state)) return true;
			if (key === Gdk.KEY_Tab || key === Gdk.KEY_ISO_Left_Tab) {
				this.#adjacent(
					key === Gdk.KEY_ISO_Left_Tab ||
						(state & Gdk.ModifierType.SHIFT_MASK) !== 0
						? -1
						: 1,
				);
				return true;
			}
			return false;
		});
		card.add_controller(keys);
		const click = new Gtk.GestureClick();
		click.set_button(0);
		click.connect("pressed", () => this.#focus(index, false));
		card.add_controller(click);
		let updateScrolledVolume: ((delta: number) => void) | null = null;
		if (row.volume !== undefined) {
			const scroll = new Gtk.EventControllerScroll({
				flags: Gtk.EventControllerScrollFlags.VERTICAL,
			});
			scroll.connect("scroll", (_controller, _deltaX, deltaY) => {
				if (!updateScrolledVolume || deltaY === 0) return false;
				this.#focusedRow = index;
				this.#focusVisible = false;
				updateScrolledVolume(deltaY < 0 ? 5 : -5);
				return true;
			});
			card.add_controller(scroll);
		}
		const top = new Gtk.Box({
			orientation: Gtk.Orientation.HORIZONTAL,
			spacing: 10,
		});
		top.set_hexpand(true);
		top.set_halign(Gtk.Align.FILL);
		const iconBox = new Gtk.Box();
		iconBox.add_css_class("audio-mixer-row-icon");
		iconBox.set_halign(Gtk.Align.CENTER);
		iconBox.set_valign(Gtk.Align.START);
		iconBox.set_size_request(36, 36);
		iconBox.set_hexpand(false);
		iconBox.set_vexpand(false);
		if (row.isDefault) iconBox.add_css_class("default");
		if (row.muted) iconBox.add_css_class("muted");
		iconBox.append(this.#icon(row));
		top.append(iconBox);
		const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
		content.set_hexpand(true);
		content.set_halign(Gtk.Align.FILL);
		content.set_size_request(0, -1);
		const title = new Gtk.Label({ label: row.name });
		title.add_css_class("audio-mixer-row-title");
		title.set_hexpand(true);
		title.set_halign(Gtk.Align.START);
		title.set_xalign(0);
		title.set_width_chars(1);
		title.set_max_width_chars(32);
		title.set_ellipsize(3);
		content.append(title);
		let volumeLabel: Gtk.Label | null = null;
		if (row.volume !== undefined) {
			volumeLabel = new Gtk.Label({
				label: row.muted ? "Muted" : `${clamp(row.volume)}%`,
			});
			volumeLabel.add_css_class("audio-mixer-volume-label");
			volumeLabel.set_hexpand(true);
			volumeLabel.set_halign(Gtk.Align.START);
			volumeLabel.set_xalign(0);
			content.append(volumeLabel);
		}
		top.append(content);
		const actions = new Gtk.Box({
			orientation: Gtk.Orientation.HORIZONTAL,
			spacing: 4,
		});
		actions.set_halign(Gtk.Align.END);
		actions.set_valign(Gtk.Align.START);
		let mute: Gtk.Button | null = null;
		if (row.volume !== undefined || row.muted !== undefined) {
			mute = createButton({
				variant: "transparent",
				className: "audio-mixer-action",
				onClick: () => this.#mute(row, index),
			});
			mute.set_label(volumeLevelIcon(row.volume, row.muted));
			mute.add_css_class("icon");
			mute.set_tooltip_text(row.muted ? "Unmute" : "Mute");
			mute.set_focusable(false);
			actions.append(mute);
		}
		if (row.kind === "endpoint") {
			const button = createButton({
				variant: row.isDefault ? "primary" : "transparent",
				className: "audio-mixer-action",
				onClick: () => {
					this.actions.onSetDefault(row);
					this.render();
					this.#focus(index, false);
				},
			});
			button.set_label("\uE8FB");
			button.add_css_class("icon");
			button.add_css_class("default-icon");
			if (row.isDefault) button.add_css_class("active");
			button.set_tooltip_text(row.isDefault ? "Default" : "Set default");
			button.set_focusable(false);
			actions.append(button);
		}
		if (actions.get_first_child()) top.append(actions);
		card.append(top);
		if (volumeLabel) {
			const meter = createAudioMeter(
				row,
				volumeLabel,
				mute,
				(update) => {
					updateScrolledVolume = update;
				},
				this.actions.onSetVolume,
			);
			this.#meterDisposers.push(meter.dispose);
			card.append(meter.widget);
		}
		return card;
	}
	#icon(row: AudioRow): Gtk.Widget {
		if (!row.iconRef) {
			const label = new Gtk.Label({
				label: row.icon || volumeLevelIcon(row.volume, row.muted),
			});
			label.add_css_class("audio-mixer-icon-label");
			label.set_hexpand(true);
			label.set_vexpand(true);
			label.set_halign(Gtk.Align.CENTER);
			label.set_valign(Gtk.Align.CENTER);
			label.set_xalign(0.5);
			label.set_yalign(0.5);
			return label;
		}
		const image =
			row.iconRef.kind === "theme"
				? Gtk.Image.new_from_icon_name(row.iconRef.name)
				: new Gtk.Image();
		image.set_pixel_size(24);
		image.set_halign(Gtk.Align.CENTER);
		image.set_valign(Gtk.Align.CENTER);
		image.set_hexpand(true);
		image.set_vexpand(true);
		image.add_css_class("audio-mixer-app-icon");
		if (row.iconRef.kind === "file") setImageFile(image, row.iconRef.path);
		return image;
	}
	#disposeMeters(): void {
		for (const dispose of this.#meterDisposers) dispose();
		this.#meterDisposers = [];
	}
	#clearFocusSource(): void {
		if (this.#focusSource === 0) return;
		GLib.source_remove(this.#focusSource);
		this.#focusSource = 0;
	}
}
