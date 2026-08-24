import { match } from "ts-pattern";
import { perf } from "@/services/performance-monitor";
import { parseComponentRequest } from "@/services/request";
import type { AudioMixerController } from "./controller";
import { parseAudioMixerRequest, type AudioMixerRequest } from "./request";

export function createRequestHandler(controller: AudioMixerController) {
	return (argv: string[], respond: (response: string) => void): void => {
		const mark = perf.start("audio-mixer-widget", "handleRequest");
		let ok = true;
		let error: string | undefined;
		try {
			const value = parseComponentRequest<AudioMixerRequest>(
				"audio-mixer-widget",
				argv,
				respond,
			);
			if (!value) return;
			const request = parseAudioMixerRequest(value);
			if (!request) {
				respond("unknown action");
				return;
			}
			respond(dispatch(controller, request));
		} catch (cause) {
			ok = false;
			error = String(cause);
			console.error("Error handling audio-mixer-widget request:", cause);
			respond(`error: ${cause}`);
		} finally {
			mark.end(ok, error);
		}
	};
}

function dispatch(
	controller: AudioMixerController,
	request: AudioMixerRequest,
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
		.with({ action: "set-tab" }, ({ tab }) => {
			controller.setTab(tab);
			return "ok";
		})
		.with({ action: "prepare" }, ({ source }) => {
			controller.prepare(source);
			return "preparing";
		})
		.with({ action: "release" }, ({ source }) => {
			controller.release(source);
			return "released";
		})
		.exhaustive();
}
