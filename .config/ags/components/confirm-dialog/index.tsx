import type { ComponentModule } from "../../services/component-host";
import { ConfirmDialogController } from "./controller";
import { createRequestHandler } from "./request-handler";
import { applyConfirmDialogStyles } from "./styles";

declare global {
	var ConfirmDialog: ComponentModule;
}

const controller = new ConfirmDialogController();

globalThis.ConfirmDialog = {
	init() {
		applyConfirmDialogStyles();
		controller.init();
	},
	handleRequest: createRequestHandler(controller),
	instanceName: "confirm-dialog",
};
