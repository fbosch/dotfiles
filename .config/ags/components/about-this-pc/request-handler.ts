import { isMatching, match } from "ts-pattern";
import { parseComponentRequest } from "../../services/request";
import type { AboutThisPCController } from "./controller";
import { aboutThisPCRequestPattern, type AboutThisPCRequest } from "./request";

export function createRequestHandler(controller: AboutThisPCController) {
	return (argv: string[], respond: (response: string) => void): void => {
		const data = parseComponentRequest<{ action?: string }>(
			"about-this-pc",
			argv,
			respond,
		);
		if (!data) return;
		const request: unknown = data;
		if (isMatching(aboutThisPCRequestPattern, request) === false) {
			respond("unknown action");
			return;
		}
		const aboutRequest: AboutThisPCRequest = request;
		respond(
			match(aboutRequest)
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
