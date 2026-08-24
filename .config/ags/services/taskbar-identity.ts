import app from "ags/gtk4/app";
import GdkWayland from "gi://GdkWayland?version=4.0";
import type Gtk from "gi://Gtk?version=4.0";

const AGS_TASKBAR_APPLICATION_ID = "io.Astal.ags";
let configured = false;

function configureWindow(window: Gtk.Window): void {
	const setApplicationId = () => {
		const surface = window.get_surface();
		if (!(surface instanceof GdkWayland.WaylandToplevel)) return;

		// Keep AGS socket identities unique while exposing one stable icon identity.
		surface.set_application_id(AGS_TASKBAR_APPLICATION_ID);
	};

	if (window.get_mapped()) {
		setApplicationId();
		return;
	}
	window.connect("map", setApplicationId);
}

export function configureAgsTaskbarIdentity(): void {
	if (configured) return;
	configured = true;

	app.connect("window-added", (_application, window) => configureWindow(window));
	for (const window of app.get_windows()) configureWindow(window);
}
