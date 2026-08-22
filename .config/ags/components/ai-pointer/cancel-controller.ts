import Gdk from "gi://Gdk?version=4.0";
import Gtk from "gi://Gtk?version=4.0";

export function createCancelController(onCancel: () => void): Gtk.EventControllerKey {
	const controller = new Gtk.EventControllerKey();
	controller.connect("key-pressed", (_controller, keyval: number) => {
		if (keyval !== Gdk.KEY_Escape) return false;
		onCancel();
		return true;
	});
	return controller;
}
