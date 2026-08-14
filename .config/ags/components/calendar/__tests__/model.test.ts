import { describe, expect, test } from "bun:test";
import {
	buildCalendarDays,
	getCalendarGridRange,
	initialCalendarModel,
	localDateKey,
	markerColor,
	startOfLocalDay,
	type CalendarEventPreview,
} from "../model";

function event(
	id: string,
	start: Date,
	end: Date,
	color?: string,
): CalendarEventPreview {
	return { id, title: id, start, end, color };
}

describe("calendar model", () => {
	test("builds a Monday-first fixed 42-day grid", () => {
		const model = initialCalendarModel(new Date(2026, 4, 15));
		const days = buildCalendarDays(model, new Date(2026, 4, 20));
		expect(days).toHaveLength(42);
		expect(localDateKey(days[0].date)).toBe("2026-04-27");
		expect(localDateKey(days[41].date)).toBe("2026-06-07");
	});

	test("places an event on every local day it overlaps", () => {
		const model = initialCalendarModel(new Date(2026, 4, 1));
		model.events = [
			event(
				"overnight",
				new Date(2026, 3, 30, 23),
				new Date(2026, 4, 1, 1),
			),
		];
		const eventDays = buildCalendarDays(model)
			.filter((day) => day.events.length > 0)
			.map((day) => localDateKey(day.date));
		expect(eventDays).toEqual(["2026-04-30", "2026-05-01"]);
	});

	test("uses local-midnight boundaries across DST transitions", () => {
		const fallback = initialCalendarModel(new Date(2026, 9, 25));
		fallback.events = [
			event(
				"late-fallback-event",
				new Date(2026, 9, 25, 23, 30),
				new Date(2026, 9, 25, 23, 45),
			),
		];
		expect(
			buildCalendarDays(fallback)
				.filter((day) => day.events.length > 0)
				.map((day) => localDateKey(day.date)),
		).toEqual(["2026-10-25"]);

		const spring = initialCalendarModel(new Date(2026, 2, 29));
		spring.events = [
			event(
				"after-spring-day",
				new Date(2026, 2, 30, 0, 30),
				new Date(2026, 2, 30, 0, 45),
			),
		];
		expect(
			buildCalendarDays(spring)
				.filter((day) => day.events.length > 0)
				.map((day) => localDateKey(day.date)),
		).toEqual(["2026-03-30"]);
	});

	test("caps markers and reports overflow", () => {
		const model = initialCalendarModel(new Date(2026, 4, 1));
		const start = new Date(2026, 4, 4, 9);
		model.events = Array.from({ length: 5 }, (_, index) =>
			event(String(index), start, new Date(2026, 4, 4, 10)),
		);
		const day = buildCalendarDays(model).find(
			(candidate) => localDateKey(candidate.date) === "2026-05-04",
		);
		expect(day?.markers).toHaveLength(3);
		expect(day?.markerOverflow).toBe(2);
	});

	test("uses an exclusive 42-day backend range", () => {
		const range = getCalendarGridRange(new Date(2026, 4, 1));
		expect(localDateKey(range.start)).toBe("2026-04-27");
		expect(localDateKey(range.end)).toBe("2026-06-08");
	});

	test("normalizes selection and rejects unsafe marker colors", () => {
		expect(startOfLocalDay(new Date(2026, 4, 1, 23, 59))).toEqual(
			new Date(2026, 4, 1),
		);
		expect(
			markerColor(
				event("unsafe", new Date(), new Date(), "red; color: transparent"),
			),
		).toMatch(/^#/);
	});
});
