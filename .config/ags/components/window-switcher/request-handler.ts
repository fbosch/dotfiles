import { match } from "ts-pattern";
import { perf } from "@/services/performance-monitor";
import { writeBindDiagnostic } from "./diagnostics";
import type { WindowSwitcherController } from "./controller";
import {
	parseWindowSwitcherRequest,
	type WindowSwitcherRequest,
} from "./request";

export function createRequestHandler(controller: WindowSwitcherController) {
	return (argv: string[], respond: (response: string) => void): void => {
		const mark = perf.start("window-switcher", "handleRequest");
		let asyncResponse = false;
		let ok = true;
		let error: string | undefined;
		try {
			const request = argv.join(" ");
			if (!request || request.trim() === "") {
				respond("ready");
				return;
			}
			const parsed = parseWindowSwitcherRequest(JSON.parse(request));
			if (!parsed) {
				respond("unknown action");
				return;
			}
			const response = dispatch(controller, parsed);
			if (typeof response === "string") {
				respond(response);
				return;
			}
			asyncResponse = true;
			response
				.then((message) => {
					respond(message);
					mark.end(ok, error);
				})
				.catch((cause) => {
					ok = false;
					error = String(cause);
					respond(`error: ${cause}`);
					mark.end(ok, error);
				});
		} catch (cause) {
			ok = false;
			error = String(cause);
			console.error("Error handling window-switcher request:", cause);
			respond(`error: ${cause}`);
		} finally {
			if (asyncResponse === false) mark.end(ok, error);
		}
	};
}

function dispatch(
	controller: WindowSwitcherController,
	request: WindowSwitcherRequest,
): string | Promise<string> {
	return match(request)
		.returnType<string | Promise<string>>()
		.with({ action: "show" }, () => controller.show().then(() => "shown"))
		.with({ action: "next" }, ({ triggerModifier }) => {
			writeBindDiagnostic(`request next modifier=${triggerModifier ?? "ALT"}`);
			return controller.next(triggerModifier).then(() => "cycled next");
		})
		.with({ action: "prev" }, ({ triggerModifier }) =>
			controller.prev(triggerModifier).then(() => "cycled prev"),
		)
		.with({ action: "commit" }, () => {
			controller.commit();
			return "committed";
		})
		.with({ action: "hide" }, () => {
			controller.hide();
			return "hidden";
		})
		.with({ action: "set-mode" }, ({ mode }) => controller.setMode(mode))
		.with({ action: "toggle-mode" }, () => {
			controller.toggleMode();
			return `mode toggled to ${controller.displayMode}`;
		})
		.with({ action: "set-sort-mode" }, ({ mode }) =>
			controller.setSortMode(mode),
		)
		.with(
			{ action: "get-sort-mode" },
			() => `current sort mode: ${controller.sortMode}`,
		)
		.with(
			{ action: "get-mode" },
			() => `current mode: ${controller.displayMode}`,
		)
		.with({ action: "get-visibility" }, () =>
			controller.isVisible() ? "visible" : "hidden",
		)
		.exhaustive();
}
