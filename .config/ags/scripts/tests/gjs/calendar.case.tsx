import type {
	CalendarBackend,
	CalendarBackendOptions,
} from "@/components/calendar/calendar-backend";
import { CalendarController } from "@/components/calendar/controller";
import { CalendarView } from "@/components/calendar/calendar-view";
import { initialCalendarModel } from "@/components/calendar/model";
import { createRequestHandler } from "@/components/calendar/request-handler";
import { assert, test } from "./harness";

function request(
	handler: (argv: string[], respond: (value: string) => void) => void,
	argv: string[],
): string {
	let response = "";
	handler(argv, (value) => {
		response = value;
	});
	return response;
}

test("Calendar Widget handles its complete request lifecycle", () => {
	let created = false;
	let visible = false;
	let refreshes = 0;
	const backend: CalendarBackend = {
		init() {},
		refresh() {
			refreshes += 1;
			return false;
		},
		stop() {},
		cooldown() {},
	};
	const controller = new CalendarController({
		createBackend: (_options: CalendarBackendOptions) => backend,
		createView: () =>
			({
				get isCreated() {
					return created;
				},
				create() {
					created = true;
				},
				show() {
					created = true;
					visible = true;
				},
				hide() {
					visible = false;
				},
				dispose() {
					created = false;
				},
				render() {},
				updateSelection() {},
			}) as unknown as CalendarView,
		signalWaybar() {},
	});
	const handle = createRequestHandler(controller);
	controller.init();
	try {
		assert(request(handle, []) === "ready", "empty request was not ready");
		assert(
			request(handle, ["not-json"]) === "error: invalid JSON",
			"invalid JSON was accepted",
		);
		assert(
			request(handle, [JSON.stringify({ action: "missing" })]) ===
				"unknown action",
			"unknown action was accepted",
		);
		assert(
			request(handle, [JSON.stringify({ action: "is-visible" })]) ===
				"false",
			"calendar started visible",
		);
		assert(
			request(handle, [JSON.stringify({ action: "show" })]) === "shown",
			"show request failed",
		);
		assert(visible, "show did not update the view");
		for (const action of ["next-month", "prev-month", "today"])
			assert(
				request(handle, [JSON.stringify({ action })]) === "ok",
				`${action} request failed`,
			);
		assert(
			request(handle, [
				JSON.stringify({ action: "select-date", date: "2026-05-14" }),
			]) === "ok",
			"select-date request failed",
		);
		assert(refreshes === 5, "navigation did not refresh the backend");
		assert(
			request(handle, [JSON.stringify({ action: "toggle" })]) === "hidden",
			"toggle request failed",
		);
		assert(
			request(handle, [JSON.stringify({ action: "hide" })]) === "hidden",
			"hide request failed",
		);
	} finally {
		controller.teardown();
	}
});

test("Calendar Widget view creates, renders, updates, and disposes", () => {
	const model = initialCalendarModel(new Date(2026, 4, 14));
	let visible = false;
	const view = new CalendarView({
		readModel: () => model,
		isVisible: () => visible,
		onHide() {
			visible = false;
		},
		onPreviousMonth() {},
		onNextMonth() {},
		onToday() {},
		onSelectDate(date) {
			model.selectedDate = date;
		},
		onClearSelection() {
			model.selectedDate = null;
		},
		onOpenDate() {},
	});
	view.create();
	assert(view.isCreated, "calendar view was not created");
	view.render(model);
	view.updateSelection(new Date(2026, 4, 20));
	visible = true;
	view.show();
	view.hide();
	view.dispose();
	assert(view.isCreated === false, "calendar view was not disposed");
});
