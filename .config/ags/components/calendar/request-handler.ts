import { isMatching, match } from "ts-pattern";
import { perf } from "@/services/performance-monitor";
import { parseComponentRequest } from "@/services/request";
import type { CalendarController } from "./controller";
import {
	calendarRequestPattern,
	type CalendarRequest,
} from "./request";

export function createRequestHandler(controller: CalendarController) {
	return (argv: string[], respond: (response: string) => void): void => {
		const mark = perf.start("calendar-widget", "handleRequest");
		let ok = true;
		let error: string | undefined;
		try {
			const data = parseComponentRequest<{ action?: string; date?: string }>(
				"calendar-widget",
				argv,
				respond,
			);
			if (!data) return;
			const request: unknown = data;
			if (isMatching(calendarRequestPattern, request) === false) {
				respond("unknown action");
				return;
			}
			const calendarRequest: CalendarRequest = request;
			respond(
				match(calendarRequest)
					.returnType<string>()
					.with({ action: "show" }, () => {
						controller.show();
						return "shown";
					})
					.with({ action: "hide" }, () => {
						controller.hide();
						return "hidden";
					})
					.with({ action: "toggle" }, () => {
						controller.toggle();
						return controller.isVisible ? "shown" : "hidden";
					})
					.with({ action: "is-visible" }, () =>
						controller.isVisible ? "true" : "false",
					)
					.with({ action: "next-month" }, () => {
						controller.nextMonth();
						return "ok";
					})
					.with({ action: "prev-month" }, () => {
						controller.previousMonth();
						return "ok";
					})
					.with({ action: "today" }, () => {
						controller.today();
						return "ok";
					})
					.with({ action: "select-date" }, ({ date }) => {
						controller.selectDate(date);
						return "ok";
					})
					.exhaustive(),
			);
		} catch (caught) {
			ok = false;
			error = String(caught);
			console.error("Error handling calendar-widget request:", caught);
			respond(`error: ${caught}`);
		} finally {
			mark.end(ok, error);
		}
	};
}
