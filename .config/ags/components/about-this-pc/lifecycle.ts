import GLib from "gi://GLib?version=2.0";
import { createAboutThisPCLifecycle } from "./isolated-component";
import {
	connectIsolatedAboutThisPCShutdown,
	launchIsolatedAboutThisPC,
} from "./isolated-process";

export const aboutThisPCLifecycle = createAboutThisPCLifecycle({
	launch: launchIsolatedAboutThisPC,
	onShutdown: connectIsolatedAboutThisPCShutdown,
	schedule(callback, delayMs) {
		let sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
			sourceId = 0;
			callback();
			return GLib.SOURCE_REMOVE;
		});
		return () => {
			if (sourceId === 0) return;
			GLib.source_remove(sourceId);
			sourceId = 0;
		};
	},
});
