import { AudioMixerController } from "./controller";
import { createRequestHandler } from "./request-handler";

const controller = new AudioMixerController();

globalThis.AudioMixerWidget = {
	init: () => controller.init(),
	handleRequest: createRequestHandler(controller),
	instanceName: "audio-mixer-widget",
};
