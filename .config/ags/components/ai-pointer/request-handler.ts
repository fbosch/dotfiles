import { isMatching, match } from "ts-pattern";
import { parseComponentRequest } from "@/services/request";
import type { AiPointerController } from "./controller";
import { aiPointerRequestPattern, type AiPointerRequest } from "./request";

export function createRequestHandler(controller: AiPointerController) {
	return (argv: string[], respond: (response: string) => void): void => {
		const data = parseComponentRequest<{ action?: string }>(
			"ai-pointer",
			argv,
			respond,
		);
		if (!data) return;
		const request: unknown = data;
		if (isMatching(aiPointerRequestPattern, request) === false) {
			respond("unknown action");
			return;
		}
		const aiPointerRequest: AiPointerRequest = request;
		respond(
			match(aiPointerRequest)
				.returnType<string>()
				.with({ action: "start" }, ({ x, y }) =>
					controller.start({ x, y }) ? "selecting" : "busy",
				)
				.with({ action: "finish" }, ({ x, y }) =>
					controller.finish({ x, y }) ? "capturing" : "idle",
				)
				.with({ action: "cancel" }, () => {
					controller.cancel();
					return "cancelled";
				})
				.with({ action: "status" }, () => controller.debugStatus())
				.exhaustive(),
		);
	};
}
