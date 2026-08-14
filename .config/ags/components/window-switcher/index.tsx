import { WindowSwitcherController } from "./controller";
import { createRequestHandler } from "./request-handler";

const controller = new WindowSwitcherController();

globalThis.WindowSwitcher = {
	init: () => controller.init(),
	handleRequest: createRequestHandler(controller),
	instanceName: "window-switcher",
};
