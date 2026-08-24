#!/usr/bin/env -S ags run

import app from "ags/gtk4/app";
import GLib from "gi://GLib?version=2.0";
import aboutThisPCCss from "./components/about-this-pc/styles.scss";
import { AboutThisPCController } from "@/components/about-this-pc/controller";
import {
	aboutThisPCIsolatedInstance,
} from "@/components/about-this-pc/isolated-contract";
import { createRequestHandler } from "@/components/about-this-pc/request-handler";
import buttonCss from "./styles/button.scss";
import gamingOpacityCss from "./styles/gaming-opacity.scss";
import { themeCss } from "@/styles/theme-css";
import { configureAgsTaskbarIdentity } from "@/services/taskbar-identity";

let quitSource = 0;
function scheduleQuit(): void {
	if (quitSource !== 0) return;
	quitSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
		quitSource = 0;
		app.quit();
		return GLib.SOURCE_REMOVE;
	});
}

const controller = new AboutThisPCController({ onHidden: scheduleQuit });
const handleRequest = createRequestHandler(controller);

configureAgsTaskbarIdentity();
app.start({
	instanceName:
		GLib.getenv("AGS_ABOUT_THIS_PC_INSTANCE") ?? aboutThisPCIsolatedInstance,
	css: [themeCss, buttonCss, gamingOpacityCss, aboutThisPCCss].join("\n"),
	main() {
		controller.init();
		return null;
	},
	requestHandler(argv, res) {
		const [component, ...rest] = argv;
		if (!component || component.trim() === "") {
			res("ready");
			return;
		}
		if (component !== "about-this-pc") {
			res(`error: unknown component "${component}"`);
			return;
		}
		handleRequest(rest, res);
	},
});
