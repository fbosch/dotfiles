import { isMatching, match } from "ts-pattern";
import { parseComponentRequest } from "@/services/request";
import { perf } from "@/services/performance-monitor";
import { aiPointerRequestPattern, type AiPointerRequest } from "./request";
import type { AiPointerWorkflow } from "./workflow";

export function createRequestHandler(workflow: AiPointerWorkflow) {
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
				.with({ action: "start" }, ({ x, y }) => {
					perf.refresh();
					return workflow.start({ x, y }) ? "selecting" : "busy";
				})
				.with({ action: "finish" }, ({ x, y }) =>
					workflow.finish({ x, y }) ? "capturing" : "idle",
				)
				.with({ action: "cancel" }, () => {
					workflow.cancel();
					return "cancelled";
				})
				.exhaustive(),
		);
	};
}
