import { P } from "ts-pattern";
import { createPreparationRequestPattern } from "@/services/preparation-intent";

export const calendarPreparationSource = "waybar:clock" as const;
export type CalendarPreparationSource = typeof calendarPreparationSource;

export const calendarRequestPattern = P.union(
	{ action: "show" },
	{ action: "hide" },
	{ action: "toggle" },
	{ action: "is-visible" },
	{ action: "next-month" },
	{ action: "prev-month" },
	{ action: "today" },
	{ action: "select-date", date: P.optional(P.string) },
	createPreparationRequestPattern(calendarPreparationSource),
);

export type CalendarRequest = P.infer<typeof calendarRequestPattern>;
