import Gdk from "gi://Gdk?version=4.0";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";

type ModifierControllerOptions = {
	isVisible: () => boolean;
	getTriggerModifier: () => string;
	onRelease: (source: "key" | "watch") => void;
	onScreenshot: () => void;
};

export class ModifierController {
	#watchId: number | null = null;

	constructor(private readonly options: ModifierControllerOptions) {}

	attach(window: Gtk.Widget): void {
		const controller = new Gtk.EventControllerKey();
		controller.connect("key-released", (_controller, keyval: number) => {
			if (isTriggerModifierKey(this.options.getTriggerModifier(), keyval))
				this.options.onRelease("key");
			if (keyval === 65377) this.options.onScreenshot();
		});
		window.add_controller(controller);
	}

	start(): void {
		this.stop();
		this.#watchId = GLib.timeout_add(GLib.PRIORITY_HIGH, 25, () => {
			if (this.options.isVisible() === false) {
				this.#watchId = null;
				return GLib.SOURCE_REMOVE;
			}
			if (isModifierPressed(this.options.getTriggerModifier()) === false) {
				this.#watchId = null;
				this.options.onRelease("watch");
				return GLib.SOURCE_REMOVE;
			}
			return GLib.SOURCE_CONTINUE;
		});
	}

	stop(): void {
		if (this.#watchId === null) return;
		GLib.source_remove(this.#watchId);
		this.#watchId = null;
	}
}

export function modifierMaskFor(name: string): Gdk.ModifierType {
	switch (name.toUpperCase()) {
		case "SUPER":
			return Gdk.ModifierType.SUPER_MASK;
		case "ALT":
			return Gdk.ModifierType.ALT_MASK;
		case "CTRL":
		case "CONTROL":
			return Gdk.ModifierType.CONTROL_MASK;
		case "SHIFT":
			return Gdk.ModifierType.SHIFT_MASK;
		default:
			return Gdk.ModifierType.ALT_MASK;
	}
}

function isModifierPressed(name: string): boolean {
	const keyboard = Gdk.Display.get_default()
		?.get_default_seat()
		?.get_keyboard();
	return keyboard
		? (keyboard.get_modifier_state() & modifierMaskFor(name)) !== 0
		: false;
}

function isTriggerModifierKey(name: string, keyval: number): boolean {
	switch (name.toUpperCase()) {
		case "SUPER":
			return keyval === 65515 || keyval === 65516;
		case "ALT":
			return keyval === 65513 || keyval === 65514;
		case "CTRL":
		case "CONTROL":
			return keyval === 65507 || keyval === 65508;
		case "SHIFT":
			return keyval === 65505 || keyval === 65506;
		default:
			return keyval === 65513 || keyval === 65514;
	}
}
