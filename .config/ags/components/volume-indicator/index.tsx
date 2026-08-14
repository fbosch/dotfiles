import { VolumeIndicatorController } from "./controller";
import { createRequestHandler } from "./request-handler";

const controller = new VolumeIndicatorController();

globalThis.VolumeIndicator = {
	init: () => controller.init(),
	handleRequest: createRequestHandler(controller),
	instanceName: "volume-indicator",
};
