import type { ComponentModule } from "../../services/component-host";
import { AboutThisPCController } from "./controller";
import { createRequestHandler } from "./request-handler";

declare global {
	var AboutThisPC: ComponentModule;
}

const controller = new AboutThisPCController();

globalThis.AboutThisPC = {
	init() {
		controller.init();
	},
	handleRequest: createRequestHandler(controller),
	instanceName: "about-this-pc",
	show: () => controller.show(),
};
