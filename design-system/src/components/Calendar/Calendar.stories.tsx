import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Desktop } from '../Desktop';
import { Waybar } from '../Waybar/Waybar';
import { Calendar, type CalendarEventPreview } from './Calendar';

const meta: Meta<typeof Calendar> = {
  title: 'Components/Calendar',
  component: Calendar,
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj<typeof Calendar>;

const visibleMonth = new Date(2026, 11, 1);
const selectedDate = new Date(2026, 11, 24);

const holidayEvents: CalendarEventPreview[] = [
  {
    id: 'christmas-eve',
    title: 'Christmas Eve',
    start: new Date(2026, 11, 24),
    end: new Date(2026, 11, 25),
    allDay: true,
    calendarName: 'Holidays in Denmark',
    color: '#dea721',
  },
  {
    id: 'christmas-day',
    title: 'Christmas Day',
    start: new Date(2026, 11, 25),
    end: new Date(2026, 11, 26),
    allDay: true,
    calendarName: 'Holidays in Denmark',
    color: '#dea721',
  },
  {
    id: 'second-christmas-day',
    title: 'Second Christmas Day',
    start: new Date(2026, 11, 26),
    end: new Date(2026, 11, 27),
    allDay: true,
    calendarName: 'Holidays in Denmark',
    color: '#dea721',
  },
  {
    id: 'new-years-eve',
    title: "New Year's Eve",
    start: new Date(2026, 11, 31),
    end: new Date(2027, 0, 1),
    allDay: true,
    calendarName: 'Holidays in Denmark',
    color: '#73bc6f',
  },
  {
    id: 'timed-event',
    title: 'Timed event',
    start: new Date(2026, 11, 24, 14),
    end: new Date(2026, 11, 24, 15),
    color: '#0067c0',
  },
  {
    id: 'overnight-event',
    title: 'Overnight event',
    start: new Date(2026, 11, 30, 23, 30),
    end: new Date(2026, 11, 31, 0, 30),
    color: '#a78bfa',
  },
];

function StatefulCalendar({
  events = [],
  backendStatus = 'ready',
  backendMessage,
}: Pick<React.ComponentProps<typeof Calendar>, 'events' | 'backendStatus' | 'backendMessage'>) {
  const [month, setMonth] = useState(visibleMonth);
  const [selected, setSelected] = useState(selectedDate);

  return (
    <Calendar
      visibleMonth={month}
      selectedDate={selected}
      events={events}
      locale="en-US"
      weekStartsOn={1}
      backendStatus={backendStatus}
      backendMessage={backendMessage}
      onPreviousMonth={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
      onNextMonth={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
      onToday={() => {
        const today = new Date();
        setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
        setSelected(today);
      }}
      onSelectDate={setSelected}
    />
  );
}

export const Open: Story = {
  render: () => (
    <div className="flex min-h-screen items-start justify-center bg-background-primary p-8">
      <StatefulCalendar />
    </div>
  ),
};

export const WithEventTooltips: Story = {
  render: () => (
    <div className="flex min-h-screen items-start justify-center bg-background-primary p-8">
      <StatefulCalendar events={holidayEvents} />
    </div>
  ),
};

export const BackendUnavailable: Story = {
  render: () => (
    <div className="flex min-h-screen items-start justify-center bg-background-primary p-8">
      <StatefulCalendar backendStatus="unavailable" backendMessage="Calendar events unavailable" />
    </div>
  ),
};

export const SpawningFromWaybar: Story = {
  render: () => (
    <Desktop>
      <div className="relative w-full">
        <Calendar
          visibleMonth={visibleMonth}
          selectedDate={selectedDate}
          events={holidayEvents}
          locale="en-US"
          weekStartsOn={1}
          style={{
            position: 'absolute',
            right: '8px',
            bottom: '53px',
            zIndex: 10,
          }}
        />
        <Waybar position="bottom" height={45} />
      </div>
    </Desktop>
  ),
};
