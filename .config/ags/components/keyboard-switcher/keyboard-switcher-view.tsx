import { Astal } from "ags/gtk4";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import { bindGamingOpacity } from "../../services/gaming-opacity";
import { perf } from "../../services/performance-monitor";
import {
	calculatedSizes,
	haveSameLayouts,
	type KeyboardSwitcherSize,
	type LayoutSwitchConfig,
} from "./model";
import { applyKeyboardSwitcherGeometry } from "./styles";

export class KeyboardSwitcherView {
	#win: Astal.Window | null = null;
	#layoutLabels = new Map<string, Gtk.Label>();
	#pill: Gtk.Box | null = null;
	#shadowWrapper: Gtk.Box | null = null;
	#badges: Gtk.Box | null = null;
	#currentLayouts: string[] = [];
	#currentSize: KeyboardSwitcherSize = "sm";
	#lastActiveLayout: string | null = null;
	#shown = false;
	#idleSources = new Set<number>();

	get isCreated(): boolean {
		return this.#win !== null;
	}

	show(config: LayoutSwitchConfig): void {
		const size = config.size ?? "sm";
		const layoutsChanged =
			this.#win !== null &&
			haveSameLayouts(this.#currentLayouts, config.layouts) === false;
		if (layoutsChanged) this.#destroyWindow();
		const firstCreation = this.#win === null;
		if (firstCreation) this.#createWindow(config.layouts, size);
		else if (size !== this.#currentSize) this.#setSize(size);
		this.#updateActiveState(config.activeLayout);
		this.#cancelIdleSources();
		this.#shadowWrapper?.remove_css_class("hiding");
		if (this.#shown) {
			this.#scheduleIdle(() =>
				this.#shadowWrapper?.add_css_class("visible"),
			);
			return;
		}
		if (firstCreation) {
			this.#scheduleIdle(() => {
				this.#win?.set_visible(true);
				this.#shown = true;
				this.#scheduleIdle(() =>
					this.#shadowWrapper?.add_css_class("visible"),
				);
			});
			return;
		}
		this.#win?.set_visible(true);
		this.#shown = true;
		this.#scheduleIdle(() =>
			this.#shadowWrapper?.add_css_class("visible"),
		);
	}

	beginHide(): void {
		this.#cancelIdleSources();
		this.#shadowWrapper?.remove_css_class("visible");
		if (this.#shown) this.#shadowWrapper?.add_css_class("hiding");
	}

	hide(): void {
		this.#cancelIdleSources();
		this.#win?.set_visible(false);
		this.#shown = false;
		this.#shadowWrapper?.remove_css_class("visible");
		this.#shadowWrapper?.remove_css_class("hiding");
	}

	dispose(): void {
		this.#destroyWindow();
	}

	#createWindow(layouts: string[], size: KeyboardSwitcherSize): void {
		this.#currentLayouts = [...layouts];
		this.#currentSize = size;
		this.#win = new Astal.Window({
			name: "keyboard-layout-switcher",
			namespace: "ags-layout-switcher",
			visible: false,
		});
		this.#win.set_anchor(Astal.WindowAnchor.NONE);
		this.#win.set_layer(Astal.Layer.OVERLAY);
		this.#win.set_exclusivity(Astal.Exclusivity.NORMAL);
		this.#win.set_keymode(Astal.Keymode.NONE);
		this.#win.add_css_class("keyboard-layout-switcher");
		bindGamingOpacity(this.#win);
		this.#setSize(size);

		this.#shadowWrapper = new Gtk.Box({
			orientation: Gtk.Orientation.HORIZONTAL,
			halign: Gtk.Align.CENTER,
			valign: Gtk.Align.CENTER,
		});
		this.#shadowWrapper.add_css_class("shadow-wrapper");
		const switcherContainer = new Gtk.Box({
			orientation: Gtk.Orientation.HORIZONTAL,
			hexpand: false,
		});
		switcherContainer.add_css_class("keyboard-switcher-container");
		const overlay = new Gtk.Overlay();
		const pillWrapper = new Gtk.Box({
			orientation: Gtk.Orientation.HORIZONTAL,
			halign: Gtk.Align.START,
		});
		pillWrapper.add_css_class("pill-wrapper");
		this.#pill = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL });
		this.#pill.add_css_class("pill-background");
		pillWrapper.append(this.#pill);
		this.#badges = new Gtk.Box({
			orientation: Gtk.Orientation.HORIZONTAL,
			spacing: calculatedSizes[size].gap,
		});
		this.#badges.add_css_class("badges-container");
		this.#layoutLabels.clear();
		for (const layout of layouts) {
			const label = new Gtk.Label({
				label: layout,
				halign: Gtk.Align.CENTER,
				valign: Gtk.Align.CENTER,
			});
			label.add_css_class("layout-badge");
			this.#layoutLabels.set(layout, label);
			this.#badges.append(label);
		}
		overlay.set_child(pillWrapper);
		overlay.add_overlay(this.#badges);
		switcherContainer.append(overlay);
		this.#shadowWrapper.append(switcherContainer);
		this.#win.set_child(this.#shadowWrapper);
	}

	#setSize(size: KeyboardSwitcherSize): void {
		if (!this.#win) return;
		for (const candidate of ["sm", "md", "lg"] as const)
			this.#win.remove_css_class(`size-${candidate}`);
		this.#win.add_css_class(`size-${size}`);
		for (const className of this.#win.get_css_classes())
			if (className.startsWith("layout-count-"))
				this.#win.remove_css_class(className);
		this.#win.add_css_class(`layout-count-${this.#currentLayouts.length}`);
		applyKeyboardSwitcherGeometry(size, this.#currentLayouts.length);
		this.#badges?.set_spacing(calculatedSizes[size].gap);
		this.#currentSize = size;
	}

	#updateActiveState(activeLayout: string): void {
		const mark = perf.start("keyboard-switcher", "updateActiveState");
		let ok = true;
		let error: string | undefined;
		try {
			if (!this.#pill || this.#lastActiveLayout === activeLayout) return;
			const activeIndex = this.#currentLayouts.indexOf(activeLayout);
			if (activeIndex === -1) return;
			this.#lastActiveLayout = activeLayout;
			const oldPosition = this.#pill
				.get_css_classes()
				.find((className) => className.startsWith("position-"));
			if (oldPosition) this.#pill.remove_css_class(oldPosition);
			this.#pill.add_css_class(`position-${activeIndex}`);
			for (const [layout, label] of this.#layoutLabels) {
				const shouldBeActive = layout === activeLayout;
				const active = label.has_css_class("active");
				if (shouldBeActive && !active) label.add_css_class("active");
				else if (!shouldBeActive && active) label.remove_css_class("active");
			}
		} catch (cause) {
			ok = false;
			error = String(cause);
			throw cause;
		} finally {
			mark.end(ok, error);
		}
	}

	#scheduleIdle(callback: () => void): void {
		let source = 0;
		source = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
			this.#idleSources.delete(source);
			callback();
			return GLib.SOURCE_REMOVE;
		});
		this.#idleSources.add(source);
	}

	#cancelIdleSources(): void {
		for (const source of this.#idleSources) GLib.source_remove(source);
		this.#idleSources.clear();
	}

	#destroyWindow(): void {
		this.#cancelIdleSources();
		this.#win?.destroy();
		this.#win = null;
		this.#layoutLabels.clear();
		this.#pill = null;
		this.#shadowWrapper = null;
		this.#badges = null;
		this.#currentLayouts = [];
		this.#lastActiveLayout = null;
		this.#shown = false;
	}
}
