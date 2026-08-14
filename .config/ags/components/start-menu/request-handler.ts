import { match } from "ts-pattern";
import { perf } from "../../services/performance-monitor";
import { parseComponentRequest } from "../../services/request";
import type { StartMenuController } from "./controller";
import { parseStartMenuRequest, type StartMenuRequest } from "./request";

export function createRequestHandler(controller: StartMenuController) {
	return (argv: string[], respond: (response: string) => void): void => {
		const mark = perf.start("start-menu", "handleRequest");
		let ok = true;
		let error: string | undefined;
		try {
			const value = parseComponentRequest<StartMenuRequest>(
				"start-menu",
				argv,
				respond,
			);
			if (!value) return;
			const request = parseStartMenuRequest(value);
			if (!request) {
				respond("unknown action");
				return;
			}
			respond(dispatch(controller, request));
		} catch (cause) {
			ok = false;
			error = String(cause);
			console.error("Error in start-menu request handler:", cause);
			respond(`error: ${cause}`);
		} finally {
			mark.end(ok, error);
		}
	};
}

function dispatch(
	controller: StartMenuController,
	request: StartMenuRequest,
): string {
	return match(request)
		.returnType<string>()
		.with({ action: "show" }, () => {
			controller.show();
			return "shown";
		})
		.with({ action: "hide" }, () => {
			controller.hide();
			return "hidden";
		})
		.with({ action: "toggle" }, () => controller.toggle())
		.with({ action: "is-visible" }, () =>
			controller.isVisible() ? "true" : "false",
		)
		.with({ action: "refresh" }, () => {
			controller.refresh();
			return "refreshed";
		})
		.exhaustive();
}
