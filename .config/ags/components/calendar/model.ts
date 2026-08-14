import tokens from "../../../../design-system/tokens.json";

type WeekStart = 0 | 1;
export type BackendStatus = "ready" | "loading" | "unavailable" | "error";

export interface CalendarEventPreview {
	id: string;
	title: string;
	start: Date;
	end: Date;
	allDay?: boolean;
	calendarName?: string;
	color?: string;
	location?: string;
}

export interface CalendarDay {
	date: Date;
	inVisibleMonth: boolean;
	isToday: boolean;
	isSelected: boolean;
	events: CalendarEventPreview[];
	markers: CalendarEventPreview[];
	markerOverflow: number;
}

export interface CalendarRange {
	start: Date;
	end: Date;
}

export interface CalendarBackendSnapshot {
	events: CalendarEventPreview[];
	status: BackendStatus;
	message: string;
}

export interface CalendarModel extends CalendarBackendSnapshot {
	visibleMonth: Date;
	selectedDate: Date | null;
}

const weekStartsOn: WeekStart = 1;
const markerLimit = 3;
const monthFormatter = new Intl.DateTimeFormat(undefined, {
	month: "long",
	year: "numeric",
});
const dateLabelFormatter = new Intl.DateTimeFormat(undefined, {
	weekday: "long",
	month: "long",
	day: "numeric",
	year: "numeric",
});
const weekdayFormatter = new Intl.DateTimeFormat(undefined, {
	weekday: "short",
});
const weekdayLabelCache = Array.from({ length: 7 }, (_, index) => {
	const sunday = new Date(2026, 0, 4);
	const dayOffset = (weekStartsOn + index) % 7;
	return weekdayFormatter.format(addLocalDays(sunday, dayOffset));
});

export function initialCalendarModel(now = new Date()): CalendarModel {
	return {
		visibleMonth: startOfMonth(now),
		selectedDate: startOfLocalDay(now),
		events: [],
		status: "unavailable",
		message: "Calendar events unavailable",
	};
}

export function startOfLocalDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function startOfMonth(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addLocalDays(date: Date, days: number): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function sameLocalDay(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

function monthKey(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function localDateKey(date: Date): string {
	return [
		date.getFullYear(),
		String(date.getMonth() + 1).padStart(2, "0"),
		String(date.getDate()).padStart(2, "0"),
	].join("-");
}

function getCalendarGridStart(month: Date): Date {
	const firstOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
	const offset = (firstOfMonth.getDay() - weekStartsOn + 7) % 7;
	return addLocalDays(firstOfMonth, -offset);
}

export function getCalendarGridRange(visibleMonth: Date): CalendarRange {
	const start = getCalendarGridStart(visibleMonth);
	return { start, end: addLocalDays(start, 42) };
}

export function gridRangeKey(start: Date, end: Date): string {
	return `${localDateKey(start)}:${localDateKey(end)}`;
}

function eventOverlapsLocalDay(
	event: CalendarEventPreview,
	day: Date,
): boolean {
	const dayStart = startOfLocalDay(day);
	const dayEnd = addLocalDays(dayStart, 1);
	const eventEnd =
		event.end > event.start
			? event.end
			: new Date(event.start.getTime() + 1);
	return event.start < dayEnd && eventEnd > dayStart;
}

function buildEventsByLocalDate(
	events: CalendarEventPreview[],
	gridStart: Date,
	gridEnd: Date,
): Map<string, CalendarEventPreview[]> {
	const eventsByDate = new Map<string, CalendarEventPreview[]>();
	for (const event of events) {
		const eventEnd =
			event.end > event.start
				? event.end
				: new Date(event.start.getTime() + 1);
		let day = startOfLocalDay(
			event.start > gridStart ? event.start : gridStart,
		);
		const lastDay = startOfLocalDay(
			new Date(Math.min(eventEnd.getTime() - 1, gridEnd.getTime() - 1)),
		);
		while (day <= lastDay) {
			if (eventOverlapsLocalDay(event, day)) {
				const key = localDateKey(day);
				const dayEvents = eventsByDate.get(key) ?? [];
				dayEvents.push(event);
				eventsByDate.set(key, dayEvents);
			}
			day = addLocalDays(day, 1);
		}
	}
	return eventsByDate;
}

export function buildCalendarDays(
	model: CalendarModel,
	today = new Date(),
): CalendarDay[] {
	const start = getCalendarGridStart(model.visibleMonth);
	const end = addLocalDays(start, 42);
	const visibleMonthId = monthKey(model.visibleMonth);
	const eventsByDate = buildEventsByLocalDate(model.events, start, end);
	return Array.from({ length: 42 }, (_, index) => {
		const date = addLocalDays(start, index);
		const dayEvents = eventsByDate.get(localDateKey(date)) ?? [];
		return {
			date,
			inVisibleMonth: monthKey(date) === visibleMonthId,
			isToday: sameLocalDay(date, today),
			isSelected: model.selectedDate
				? sameLocalDay(date, model.selectedDate)
				: false,
			events: dayEvents,
			markers: dayEvents.slice(0, markerLimit),
			markerOverflow: Math.max(0, dayEvents.length - markerLimit),
		};
	});
}

export function formatMonthLabel(date: Date): string {
	return monthFormatter.format(date);
}

export function weekdayLabels(): string[] {
	return weekdayLabelCache;
}

export function eventTooltip(day: CalendarDay): string | null {
	if (day.events.length === 0) return null;
	return [
		dateLabelFormatter.format(day.date),
		...day.events.map((event) => event.title),
	].join("\n");
}

export function markerColor(event: CalendarEventPreview): string {
	return isValidCssColor(event.color)
		? event.color
		: tokens.colors.accent.primary.value;
}

function isValidCssColor(value: string | undefined): value is string {
	if (!value) return false;
	return (
		/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?([0-9a-fA-F]{2})?$/.test(value) ||
		/^rgba?\([^)]+\)$/.test(value) ||
		/^hsla?\([^)]+\)$/.test(value)
	);
}
