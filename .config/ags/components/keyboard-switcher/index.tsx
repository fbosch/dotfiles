import { KeyboardSwitcherController } from "./controller";
import { createRequestHandler } from "./request-handler";

const controller = new KeyboardSwitcherController();

globalThis.KeyboardSwitcher = {
	init: () => controller.init(),
	handleRequest: createRequestHandler(controller),
	instanceName: "keyboard-switcher",
};
