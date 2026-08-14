import { StartMenuController } from "./controller";
import { createRequestHandler } from "./request-handler";

const controller = new StartMenuController();

globalThis.StartMenu = {
	init: () => controller.init(),
	handleRequest: createRequestHandler(controller),
	instanceName: "start-menu",
};
