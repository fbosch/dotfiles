import { CalendarController } from "./controller";
import { createRequestHandler } from "./request-handler";

const controller = new CalendarController();

globalThis.CalendarWidget = {
	init: () => controller.init(),
	handleRequest: createRequestHandler(controller),
	instanceName: "calendar-widget",
};
