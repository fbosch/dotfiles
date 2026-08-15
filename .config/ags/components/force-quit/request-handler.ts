import { isMatching, match } from "ts-pattern";
import { parseComponentRequest } from "../../services/request";
import type { ForceQuitController } from "./controller";
import { forceQuitRequestPattern, type ForceQuitRequest } from "./request";

export function createRequestHandler(controller: ForceQuitController) {
	return (argv: string[], respond: (response: string) => void): void => {
		const data = parseComponentRequest<{ action?: string }>(
			"force-quit",
			argv,
			respond,
		);
		if (!data) return;
		const request: unknown = data;
		if (isMatching(forceQuitRequestPattern, request) === false) {
			respond("unknown action");
			return;
		}
		const forceQuitRequest: ForceQuitRequest = request;
		respond(
			match(forceQuitRequest)
				.returnType<string>()
				.with({ action: "show" }, () => {
					controller.show();
					return "shown";
				})
				.with({ action: "hide" }, () => {
					controller.hide();
					return "hidden";
				})
				.with({ action: "destroy" }, () => {
					controller.destroy();
					return "destroyed";
				})
				.with({ action: "is-visible" }, () =>
					controller.isVisible ? "true" : "false",
				)
				.exhaustive(),
		);
	};
}
