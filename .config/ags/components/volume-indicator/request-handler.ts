import { isMatching, match } from "ts-pattern";
import { perf } from "@/services/performance-monitor";
import { parseComponentRequest } from "@/services/request";
import type { VolumeIndicatorController } from "./controller";
import {
	volumeIndicatorRequestPattern,
	type VolumeIndicatorRequest,
} from "./request";

export function createRequestHandler(controller: VolumeIndicatorController) {
	return (argv: string[], respond: (response: string) => void): void => {
		const mark = perf.start("volume-indicator", "handleRequest");
		let ok = true;
		let error: string | undefined;
		try {
			if (argv.join(" ").trim() === "") {
				respond("ok");
				return;
			}
			const data = parseComponentRequest(
				"volume-indicator",
				argv,
				respond,
			);
			if (data === null) {
				if (argv.join(" ").trim() === "null") respond("unknown action");
				return;
			}
			const request: unknown = data;
			if (isMatching(volumeIndicatorRequestPattern, request) === false) {
				respond("unknown action");
				return;
			}
			const volumeRequest: VolumeIndicatorRequest = request;
			respond(
				match(volumeRequest)
					.returnType<string>()
					.with({ action: "show" }, () => {
						controller.show();
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
			console.error("Error handling volume-indicator request:", cause);
			respond(`error: ${cause}`);
		} finally {
			mark.end(ok, error);
		}
	};
}
