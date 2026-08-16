import type { ComponentModule } from "@/services/component-host";
import { AiPointerController } from "./controller";
import { createRequestHandler } from "./request-handler";

declare global {
	var AiPointer: ComponentModule;
}

const controller = new AiPointerController();

globalThis.AiPointer = {
	init: () => controller.init(),
	handleRequest: createRequestHandler(controller),
	instanceName: "ai-pointer",
};
