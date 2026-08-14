import type {
	CalendarEventPreview,
	CalendarRange,
} from "./model";
import { addLocalDays } from "./model";

const desktopTimeZone =
	Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function resolvedTimeZone(): string {
	return desktopTimeZone;
}

function formatEdsTime(date: Date): string {
	return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function buildRangeQuery({ start, end }: CalendarRange): string {
	const startWithSlack = new Date(start.getTime() - 1000);
	const endWithSlack = new Date(end.getTime() + 1000);
	return `(occur-in-time-range? (make-time "${formatEdsTime(startWithSlack)}") (make-time "${formatEdsTime(endWithSlack)}") "${resolvedTimeZone()}")`;
}

export function asArray<T>(value: unknown): T[] {
	return Array.isArray(value) ? (value as T[]) : [];
}

function textValue(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (!value || typeof value !== "object") return null;
	const object = value as { get_value?: () => unknown; value?: unknown };
	const fromGetter = object.get_value?.();
	if (typeof fromGetter === "string") return fromGetter;
	return typeof object.value === "string" ? object.value : null;
}

function componentDateToDate(
	dateTime: any,
): { date: Date; allDay: boolean } | null {
	const value = dateTime?.get_value?.() ?? dateTime;
	if (!value) return null;
	const allDay = Boolean(value.is_date?.() ?? value.is_date ?? false);
	if (allDay && value.get_year && value.get_month && value.get_day) {
		return {
			date: new Date(value.get_year(), value.get_month() - 1, value.get_day()),
			allDay,
		};
	}
	const timestamp = value.as_timet?.();
	if (typeof timestamp === "number" && Number.isFinite(timestamp))
		return { date: new Date(timestamp * 1000), allDay };
	return null;
}

export function sourceDisplayName(source: any): string | undefined {
	return source?.get_display_name?.() || undefined;
}

export function sourceColor(
	source: any,
	EDataServer: any,
): string | undefined {
	try {
		const extension = source?.get_extension?.(
			EDataServer.SOURCE_EXTENSION_CALENDAR,
		);
		return extension?.get_color?.() || undefined;
	} catch {
		return undefined;
	}
}

export function sourceUid(source: any): string {
	return source?.get_uid?.() || sourceDisplayName(source) || "unknown-source";
}

export function componentToEvent(
	component: any,
	source: any,
	info: { name?: string; color?: string },
	index: number,
): CalendarEventPreview | null {
	const start = componentDateToDate(component?.get_dtstart?.());
	if (!start) return null;
	const end = componentDateToDate(component?.get_dtend?.());
	const fallbackEnd = start.allDay
		? addLocalDays(start.date, 1)
		: new Date(start.date.getTime() + 60 * 60 * 1000);
	const uid =
		component?.get_uid?.() || `${source?.get_uid?.() || "source"}-${index}`;
	return {
		id: `${source?.get_uid?.() || "source"}:${uid}:${index}`,
		title: textValue(component?.get_summary?.()) || "Untitled event",
		start: start.date,
		end: end?.date || fallbackEnd,
		allDay: start.allDay,
		calendarName: info.name,
		color: info.color,
		location: textValue(component?.get_location?.()) || undefined,
	};
}
