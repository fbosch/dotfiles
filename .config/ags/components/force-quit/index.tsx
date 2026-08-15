import { type ComponentModule } from "../../services/component-host";
import { ForceQuitController } from "./controller";
import { createRequestHandler } from "./request-handler";
import { applyForceQuitStyles } from "./styles";

declare global {
	var ForceQuit: ComponentModule;
}

const controller = new ForceQuitController();

globalThis.ForceQuit = {
	init() {
		applyForceQuitStyles();
		controller.init();
	},
	handleRequest: createRequestHandler(controller),
	instanceName: "force-quit",
	show: () => controller.show(),
};
