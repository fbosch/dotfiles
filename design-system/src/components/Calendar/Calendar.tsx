import { cva } from 'class-variance-authority';
import type React from 'react';
import { cn } from '../../utils/cn';
import {
  type BackendStatus,
  buildCalendarDays,
  type CalendarDay,
  type CalendarEventPreview,
  getWeekdayLabels,
  localDateKey,
  type WeekStart,
} from './calendar-date';

export type { BackendStatus, CalendarDay, CalendarEventPreview, WeekStart };

export interface CalendarProps {
  visibleMonth: Date;
  selectedDate: Date;
  events?: CalendarEventPreview[];
  weekStartsOn?: WeekStart;
  locale?: string;
  backendStatus?: BackendStatus;
  backendMessage?: string;
  disableAnimations?: boolean;
  onPreviousMonth?: () => void;
  onNextMonth?: () => void;
  onToday?: () => void;
  onSelectDate?: (date: Date) => void;
  className?: string;
  style?: React.CSSProperties;
}

const calendarVariants = cva(
  'w-[360px] rounded-lg border border-white/15 bg-background-secondary/90 p-3 text-foreground-primary shadow-[0_8px_32px_rgba(0,0,0,0.24),0_2px_8px_rgba(0,0,0,0.12)] backdrop-blur-md font-primary',
  {
    variants: {
      animated: {
        true: 'transition-colors duration-150',
        false: '',
      },
    },
    defaultVariants: {
      animated: true,
    },
  }
);

const dayCellVariants = cva(
  'group relative flex min-w-0 flex-col rounded-none border-0 p-1 text-left outline-none',
  {
    variants: {
      inVisibleMonth: {
        true: 'border-white/[0.08] text-foreground-primary hover:bg-white/10 focus-visible:bg-white/10 focus-visible:ring-1 focus-visible:ring-white/30',
        false:
          'border-white/[0.05] text-foreground-tertiary/35 opacity-50 hover:bg-white/[0.04] focus-visible:bg-white/[0.04] focus-visible:ring-1 focus-visible:ring-white/15',
      },
      selected: {
        true: 'bg-accent-primary/20 text-foreground-primary ring-1 ring-inset ring-accent-primary',
        false: '',
      },
      today: {
        true: 'bg-white/15 font-semibold',
        false: '',
      },
      animated: {
        true: 'transition-colors duration-150',
        false: '',
      },
    },
    defaultVariants: {
      inVisibleMonth: true,
      selected: false,
      today: false,
      animated: true,
    },
  }
);

const statusLabels: Record<BackendStatus, string> = {
  ready: '',
  loading: 'Loading events',
  unavailable: 'Events unavailable',
  error: 'Event loading failed',
};

function formatMonthLabel(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function validMarkerColor(color: string | undefined): string {
  if (!color) return '#0067c0';

  if (typeof CSS !== 'undefined' && CSS.supports('color', color)) {
    return color;
  }

  return '#0067c0';
}

function dayAriaLabel(day: CalendarDay, locale?: string): string {
  const dateLabel = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(day.date);
  const eventCount = day.markers.length + day.markerOverflow;
  const eventText = eventCount === 1 ? '1 event' : `${eventCount} events`;

  return eventCount > 0 ? `${dateLabel}, ${eventText}` : dateLabel;
}

function dayTooltip(day: CalendarDay, locale?: string): string | undefined {
  if (day.events.length === 0) return undefined;

  const dateLabel = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(day.date);

  const eventLines = day.events.map((event) => event.title);
  return [dateLabel, ...eventLines].join('\n');
}

export const Calendar: React.FC<CalendarProps> = ({
  visibleMonth,
  selectedDate,
  events = [],
  weekStartsOn = 1,
  locale,
  backendStatus = 'ready',
  backendMessage,
  disableAnimations = false,
  onPreviousMonth,
  onNextMonth,
  onToday,
  onSelectDate,
  className,
  style,
}) => {
  const days = buildCalendarDays({ visibleMonth, selectedDate, events, weekStartsOn });
  const weekdayLabels = getWeekdayLabels(locale, weekStartsOn);
  const statusLabel = backendMessage || statusLabels[backendStatus];
  const calendarStyle: React.CSSProperties = {
    width: 360,
    backgroundColor: 'rgba(45, 45, 45, 0.9)',
    backdropFilter: 'blur(12px)',
    ...style,
  };

  return (
    <section
      className={cn(calendarVariants({ animated: !disableAnimations }), className)}
      style={calendarStyle}
      aria-label="Calendar"
    >
      <header className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onPreviousMonth}
          className="flex h-8 w-8 items-center justify-center rounded-md text-foreground-secondary hover:bg-white/10 hover:text-foreground-primary focus-visible:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
          aria-label="Previous month"
        >
          <span aria-hidden="true">‹</span>
        </button>
        <div className="min-w-0 flex-1 text-center">
          <h2 className="truncate text-sm font-semibold capitalize text-foreground-primary">
            {formatMonthLabel(visibleMonth, locale)}
          </h2>
          {backendStatus !== 'ready' && (
            <p className="mt-0.5 truncate text-[11px] text-foreground-tertiary">{statusLabel}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onToday}
          className="h-8 rounded-md px-2 text-xs text-foreground-secondary hover:bg-white/10 hover:text-foreground-primary focus-visible:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
        >
          Today
        </button>
        <button
          type="button"
          onClick={onNextMonth}
          className="flex h-8 w-8 items-center justify-center rounded-md text-foreground-secondary hover:bg-white/10 hover:text-foreground-primary focus-visible:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
          aria-label="Next month"
        >
          <span aria-hidden="true">›</span>
        </button>
      </header>

      <div
        className="grid grid-cols-7 gap-1 pb-1 text-center text-[11px] font-medium text-foreground-tertiary"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}
      >
        {weekdayLabels.map((label) => (
          <div key={label} className="py-1 capitalize">
            {label}
          </div>
        ))}
      </div>

      <div
        className="grid grid-cols-7 gap-0 overflow-hidden rounded-md border border-white/[0.08]"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}
      >
        {days.map((day, index) => (
          <button
            type="button"
            key={localDateKey(day.date)}
            onClick={() => onSelectDate?.(day.date)}
            className={cn(
              dayCellVariants({
                inVisibleMonth: day.inVisibleMonth,
                selected: day.isSelected,
                today: day.isToday,
                animated: !disableAnimations,
              }),
              index % 7 !== 0 && 'border-l',
              index >= 7 && 'border-t'
            )}
            aria-pressed={day.isSelected}
            aria-label={dayAriaLabel(day, locale)}
            title={dayTooltip(day, locale)}
            style={{ aspectRatio: '1 / 1' }}
          >
            <span
              className={cn(
                'flex h-5 w-5 items-center justify-center text-xs',
                day.isToday && 'text-foreground-primary'
              )}
            >
              {day.date.getDate()}
            </span>

            <span
              className="mt-auto flex min-h-[7px] items-center gap-0.5 overflow-hidden"
              style={{
                position: 'absolute',
                right: 4,
                bottom: 4,
                left: 4,
                display: 'flex',
                justifyContent: 'center',
                gap: 2,
              }}
            >
              {day.markers.map((marker) => (
                <span
                  key={marker.id}
                  data-calendar-event-marker="true"
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    !day.inVisibleMonth && 'opacity-50'
                  )}
                  style={{
                    display: 'block',
                    width: 6,
                    height: 6,
                    borderRadius: 9999,
                    backgroundColor: validMarkerColor(marker.color),
                  }}
                />
              ))}
              {day.markerOverflow > 0 && (
                <span className="text-[9px] leading-none text-foreground-tertiary">
                  +{day.markerOverflow}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
};
