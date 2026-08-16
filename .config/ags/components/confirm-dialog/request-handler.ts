import { isMatching, match } from "ts-pattern";
import { parseComponentRequest } from "../../services/request";
import type { ConfirmDialogController } from "./controller";
import {
	confirmDialogRequestPattern,
	type ConfirmDialogRequest,
} from "./request";

export function createRequestHandler(controller: ConfirmDialogController) {
	return (argv: string[], respond: (response: string) => void): void => {
		const data = parseComponentRequest<{ action?: string }>(
			"confirm-dialog",
			argv,
			respond,
		);
		if (!data) return;
		const request: unknown = data;
		if (isMatching(confirmDialogRequestPattern, request) === false) {
			respond("unknown action");
			return;
		}
		const confirmRequest: ConfirmDialogRequest = request;
		respond(
			match(confirmRequest)
				.returnType<string>()
				.with({ action: "show" }, ({ config }) => {
					controller.show(config);
					return "shown";
				})
				.with({ action: "hide" }, () => {
					controller.hide();
					return "hidden";
				})
				.exhaustive(),
		);
	};
}
