import type { ComponentModule } from "@/services/component-host";
import { createAiPointerNativeAdapter } from "./native-adapter";
import { createRequestHandler } from "./request-handler";
import { AiPointerWorkflow } from "./workflow";

declare global {
	var AiPointer: ComponentModule;
}

const workflow = new AiPointerWorkflow(createAiPointerNativeAdapter());

globalThis.AiPointer = {
	init: () => workflow.init(),
	handleRequest: createRequestHandler(workflow),
	instanceName: "ai-pointer",
};
