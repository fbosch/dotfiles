import { P } from "ts-pattern";

export const calendarRequestPattern = P.union(
	{ action: "show" },
	{ action: "hide" },
	{ action: "toggle" },
	{ action: "is-visible" },
	{ action: "next-month" },
	{ action: "prev-month" },
	{ action: "today" },
	{ action: "select-date", date: P.optional(P.string) },
);

export type CalendarRequest = P.infer<typeof calendarRequestPattern>;
