import { isMatching, match } from "ts-pattern";
import { perf } from "../../services/performance-monitor";
import { parseComponentRequest } from "../../services/request";
import type { KeyboardSwitcherController } from "./controller";
import { isValidLayoutSwitchConfig } from "./model";
import {
	keyboardSwitcherRequestPattern,
	type KeyboardSwitcherRequest,
} from "./request";

export function createRequestHandler(controller: KeyboardSwitcherController) {
	return (argv: string[], respond: (response: string) => void): void => {
		const mark = perf.start("keyboard-switcher", "handleRequest");
		let ok = true;
		let error: string | undefined;
		try {
			const data = parseComponentRequest(
				"keyboard-switcher",
				argv,
				respond,
			);
			if (data === null) {
				if (argv.join(" ").trim() === "null") respond("unknown action");
				return;
			}
			const request: unknown = data;
			if (isMatching(keyboardSwitcherRequestPattern, request) === false) {
				respond("unknown action");
				return;
			}
			const keyboardRequest: KeyboardSwitcherRequest = request;
			if (
				keyboardRequest.action === "show" &&
				isValidLayoutSwitchConfig(keyboardRequest.config) === false
			) {
				respond("unknown action");
				return;
			}
			respond(
				match(keyboardRequest)
					.returnType<string>()
					.with({ action: "show" }, ({ config }) => {
						controller.show(config);
						return "shown";
					})
					.with({ action: "hide" }, () => {
						controller.hide();
						return "hidden";
					})
					.with({ action: "get-visibility" }, () =>
						controller.isVisible() ? "visible" : "hidden",
					)
					.exhaustive(),
			);
		} catch (cause) {
			ok = false;
			error = String(cause);
			console.error("Error handling keyboard-switcher request:", cause);
			respond(`error: ${cause}`);
		} finally {
			mark.end(ok, error);
		}
	};
}
