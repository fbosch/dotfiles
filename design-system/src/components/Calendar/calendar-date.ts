export type WeekStart = 0 | 1;
export type BackendStatus = 'ready' | 'loading' | 'unavailable' | 'error';

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

export interface CalendarDayEventMarker {
  id: string;
  color?: string;
  allDay: boolean;
}

export interface CalendarDay {
  date: Date;
  inVisibleMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  events: CalendarEventPreview[];
  markers: CalendarDayEventMarker[];
  markerOverflow: number;
}

export interface BuildCalendarDaysOptions {
  visibleMonth: Date;
  selectedDate: Date;
  events?: CalendarEventPreview[];
  weekStartsOn?: WeekStart;
  today?: Date;
}

const dayInMs = 24 * 60 * 60 * 1000;
const markerLimit = 3;

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function addLocalDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function localDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function getCalendarGridStart(visibleMonth: Date, weekStartsOn: WeekStart = 1): Date {
  const firstOfMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
  const offset = (firstOfMonth.getDay() - weekStartsOn + 7) % 7;
  return addLocalDays(firstOfMonth, -offset);
}

export function getCalendarGridRange(
  visibleMonth: Date,
  weekStartsOn: WeekStart = 1
): { start: Date; end: Date } {
  const start = getCalendarGridStart(visibleMonth, weekStartsOn);
  return { start, end: addLocalDays(start, 41) };
}

export function eventOverlapsLocalDay(event: CalendarEventPreview, day: Date): boolean {
  const dayStart = startOfLocalDay(day);
  const dayEnd = new Date(dayStart.getTime() + dayInMs);
  const eventStart = event.start;
  const eventEnd = event.end > event.start ? event.end : new Date(event.start.getTime() + 1);

  return eventStart < dayEnd && eventEnd > dayStart;
}

export function buildCalendarDays({
  visibleMonth,
  selectedDate,
  events = [],
  weekStartsOn = 1,
  today = new Date(),
}: BuildCalendarDaysOptions): CalendarDay[] {
  const start = getCalendarGridStart(visibleMonth, weekStartsOn);
  const visibleMonthId = monthKey(visibleMonth);

  return Array.from({ length: 42 }, (_, index) => {
    const date = addLocalDays(start, index);
    const inVisibleMonth = monthKey(date) === visibleMonthId;
    const dayEvents = events.filter((event) => eventOverlapsLocalDay(event, date));
    const markers = dayEvents.slice(0, markerLimit).map((event) => ({
      id: event.id,
      color: event.color,
      allDay: event.allDay === true,
    }));

    return {
      date,
      inVisibleMonth,
      isToday: sameLocalDay(date, today),
      isSelected: sameLocalDay(date, selectedDate),
      events: dayEvents,
      markers,
      markerOverflow: Math.max(0, dayEvents.length - markerLimit),
    };
  });
}

export function getWeekdayLabels(locale?: string, weekStartsOn: WeekStart = 1): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  const sunday = new Date(2026, 0, 4);

  return Array.from({ length: 7 }, (_, index) => {
    const dayOffset = (weekStartsOn + index) % 7;
    return formatter.format(addLocalDays(sunday, dayOffset));
  });
}
