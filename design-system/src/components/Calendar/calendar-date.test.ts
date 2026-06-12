import { describe, expect, it } from 'vitest';
import {
  buildCalendarDays,
  type CalendarEventPreview,
  eventOverlapsLocalDay,
  getCalendarGridStart,
  localDateKey,
} from './calendar-date';

describe('calendar-date', () => {
  it('builds a 42-cell Monday-first grid', () => {
    const visibleMonth = new Date(2026, 2, 1);
    const days = buildCalendarDays({
      visibleMonth,
      selectedDate: visibleMonth,
      weekStartsOn: 1,
      today: new Date(2026, 2, 15),
    });

    expect(days).toHaveLength(42);
    expect(localDateKey(days[0].date)).toBe('2026-02-23');
    expect(localDateKey(days[41].date)).toBe('2026-04-05');
  });

  it('builds a 42-cell Sunday-first grid', () => {
    const visibleMonth = new Date(2026, 2, 1);

    expect(localDateKey(getCalendarGridStart(visibleMonth, 0))).toBe('2026-03-01');
  });

  it('matches timed events that cross midnight on both local days', () => {
    const event: CalendarEventPreview = {
      id: 'overnight',
      title: 'Overnight',
      start: new Date(2026, 2, 9, 23, 30),
      end: new Date(2026, 2, 10, 0, 30),
    };

    expect(eventOverlapsLocalDay(event, new Date(2026, 2, 9))).toBe(true);
    expect(eventOverlapsLocalDay(event, new Date(2026, 2, 10))).toBe(true);
    expect(eventOverlapsLocalDay(event, new Date(2026, 2, 11))).toBe(false);
  });

  it('matches multi-day all-day events on every local day in the span', () => {
    const event: CalendarEventPreview = {
      id: 'easter',
      title: 'Easter',
      start: new Date(2026, 3, 3),
      end: new Date(2026, 3, 7),
      allDay: true,
    };

    expect(eventOverlapsLocalDay(event, new Date(2026, 3, 3))).toBe(true);
    expect(eventOverlapsLocalDay(event, new Date(2026, 3, 6))).toBe(true);
    expect(eventOverlapsLocalDay(event, new Date(2026, 3, 7))).toBe(false);
  });

  it('shows markers and ordered events for outside-month days', () => {
    const events: CalendarEventPreview[] = [
      {
        id: 'outside-holiday',
        title: 'Outside Holiday',
        start: new Date(2026, 1, 23),
        end: new Date(2026, 1, 24),
        allDay: true,
      },
    ];
    const days = buildCalendarDays({
      visibleMonth: new Date(2026, 2, 1),
      selectedDate: new Date(2026, 2, 1),
      events,
      weekStartsOn: 1,
      today: new Date(2026, 2, 15),
    });

    expect(days[0].inVisibleMonth).toBe(false);
    expect(days[0].markers).toHaveLength(1);
    expect(days[0].events.map((event) => event.title)).toEqual(['Outside Holiday']);
  });

  it('preserves caller event order for tooltip data', () => {
    const events: CalendarEventPreview[] = [
      {
        id: 'first',
        title: 'First Holiday',
        start: new Date(2026, 4, 1),
        end: new Date(2026, 4, 2),
        allDay: true,
      },
      {
        id: 'second',
        title: 'Second Holiday',
        start: new Date(2026, 4, 1),
        end: new Date(2026, 4, 2),
        allDay: true,
      },
    ];
    const day = buildCalendarDays({
      visibleMonth: new Date(2026, 4, 1),
      selectedDate: new Date(2026, 4, 1),
      events,
      today: new Date(2026, 4, 15),
    }).find((calendarDay) => localDateKey(calendarDay.date) === '2026-05-01');

    expect(day?.events.map((event) => event.title)).toEqual(['First Holiday', 'Second Holiday']);
    expect(day?.markers).toHaveLength(2);
  });
});
