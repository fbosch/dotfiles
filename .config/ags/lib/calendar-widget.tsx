import app from "ags/gtk4/app";
import { Astal } from "ags/gtk4";
import Gdk from "gi://Gdk?version=4.0";
import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import tokens from "../../../design-system/tokens.json";
import { perf } from "./performance-monitor";

type WeekStart = 0 | 1;
type BackendStatus = "ready" | "loading" | "unavailable" | "error";

interface CalendarEventPreview {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  calendarName?: string;
  color?: string;
  location?: string;
}

interface CalendarDay {
  date: Date;
  inVisibleMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  events: CalendarEventPreview[];
  markers: CalendarEventPreview[];
  markerOverflow: number;
}

interface BackendModules {
  ECal: any;
  EDataServer: any;
}

interface CachedEvents {
  events: CalendarEventPreview[];
  status: BackendStatus;
  message: string;
}

interface DaySlot {
  button: Gtk.Button;
  number: Gtk.Label;
  markerRow: Gtk.Box;
  date: Date;
}

let win: Astal.Window | null = null;
let calendarBox: Gtk.Box | null = null;
let dayButtons = new Map<string, Gtk.Button>();
let monthTitleLabel: Gtk.Label | null = null;
let statusLabel: Gtk.Label | null = null;
let weekdayLabelWidgets: Gtk.Label[] = [];
let daySlots: DaySlot[] = [];
let isVisible = false;
let ignoreNextOutsideClick = false;
let visibleMonth = startOfMonth(new Date());
let selectedDate = startOfLocalDay(new Date());
let events: CalendarEventPreview[] = [];
let backendStatus: BackendStatus = "unavailable";
let backendMessage = "Calendar events unavailable";
let markerCssCounter = 0;
let backendLoadVersion = 0;
let backendModules: BackendModules | null = null;
let backendRegistry: any | null = null;
let backendRegistrySignalIds: number[] = [];
let backendRefreshSource = 0;
let eventCache = new Map<string, CachedEvents>();
let clientCache = new Map<string, any>();

const weekStartsOn: WeekStart = 1;
const markerLimit = 3;
const dayInMs = 24 * 60 * 60 * 1000;

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addLocalDays(date: Date, days: number): Date {
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

function localDateKey(date: Date): string {
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

function getCalendarGridRange(): { start: Date; end: Date } {
  const start = getCalendarGridStart(visibleMonth);
  return { start, end: addLocalDays(start, 42) };
}

function gridRangeKey(start: Date, end: Date): string {
  return `${localDateKey(start)}:${localDateKey(end)}`;
}

function eventOverlapsLocalDay(event: CalendarEventPreview, day: Date): boolean {
  const dayStart = startOfLocalDay(day);
  const dayEnd = new Date(dayStart.getTime() + dayInMs);
  const eventEnd = event.end > event.start ? event.end : new Date(event.start.getTime() + 1);

  return event.start < dayEnd && eventEnd > dayStart;
}

function buildCalendarDays(): CalendarDay[] {
  const start = getCalendarGridStart(visibleMonth);
  const visibleMonthId = monthKey(visibleMonth);
  const today = new Date();

  return Array.from({ length: 42 }, (_, index) => {
    const date = addLocalDays(start, index);
    const dayEvents = events.filter((event) => eventOverlapsLocalDay(event, date));

    return {
      date,
      inVisibleMonth: monthKey(date) === visibleMonthId,
      isToday: sameLocalDay(date, today),
      isSelected: sameLocalDay(date, selectedDate),
      events: dayEvents,
      markers: dayEvents.slice(0, markerLimit),
      markerOverflow: Math.max(0, dayEvents.length - markerLimit),
    };
  });
}

function formatMonthLabel(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatDateLabel(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function weekdayLabels(): string[] {
  const formatter = new Intl.DateTimeFormat(undefined, { weekday: "short" });
  const sunday = new Date(2026, 0, 4);

  return Array.from({ length: 7 }, (_, index) => {
    const dayOffset = (weekStartsOn + index) % 7;
    return formatter.format(addLocalDays(sunday, dayOffset));
  });
}

function eventTooltip(day: CalendarDay): string | null {
  if (day.events.length === 0) return null;
  return [formatDateLabel(day.date), ...day.events.map((event) => event.title)].join("\n");
}

function markerColor(event: CalendarEventPreview): string {
  return isValidCssColor(event.color) ? event.color : tokens.colors.accent.primary.value;
}

function isValidCssColor(value: string | undefined): value is string {
  if (!value) return false;
  return (
    /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?([0-9a-fA-F]{2})?$/.test(value) ||
    /^rgba?\([^)]+\)$/.test(value) ||
    /^hsla?\([^)]+\)$/.test(value)
  );
}

function resolvedTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function formatEdsTime(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function buildRangeQuery(start: Date, end: Date): string {
  const startWithSlack = new Date(start.getTime() - 1000);
  const endWithSlack = new Date(end.getTime() + 1000);
  return `(occur-in-time-range? (make-time "${formatEdsTime(startWithSlack)}") (make-time "${formatEdsTime(endWithSlack)}") "${resolvedTimeZone()}")`;
}

async function loadBackendModules(): Promise<BackendModules> {
  if (backendModules) return backendModules;

  const [{ default: ECal }, { default: EDataServer }] = await Promise.all([
    import("gi://ECal?version=2.0"),
    import("gi://EDataServer?version=1.2"),
  ]);
  backendModules = { ECal, EDataServer };
  return backendModules;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function textValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;

  const object = value as { get_value?: () => unknown; value?: unknown };
  const fromGetter = object.get_value?.();
  if (typeof fromGetter === "string") return fromGetter;
  if (typeof object.value === "string") return object.value;
  return null;
}

function componentDateToDate(dateTime: any): { date: Date; allDay: boolean } | null {
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
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    return { date: new Date(timestamp * 1000), allDay };
  }

  return null;
}

function sourceDisplayName(source: any): string | undefined {
  return source?.get_display_name?.() || undefined;
}

function sourceColor(source: any, EDataServer: any): string | undefined {
  try {
    const extension = source?.get_extension?.(EDataServer.SOURCE_EXTENSION_CALENDAR);
    return extension?.get_color?.() || undefined;
  } catch {
    return undefined;
  }
}

function componentToEvent(
  component: any,
  source: any,
  EDataServer: any,
  index: number,
): CalendarEventPreview | null {
  const start = componentDateToDate(component?.get_dtstart?.());
  if (!start) return null;

  const end = componentDateToDate(component?.get_dtend?.());
  const fallbackEnd = start.allDay
    ? addLocalDays(start.date, 1)
    : new Date(start.date.getTime() + 60 * 60 * 1000);
  const uid = component?.get_uid?.() || `${source?.get_uid?.() || "source"}-${index}`;

  return {
    id: `${source?.get_uid?.() || "source"}:${uid}:${index}`,
    title: textValue(component?.get_summary?.()) || "Untitled event",
    start: start.date,
    end: end?.date || fallbackEnd,
    allDay: start.allDay,
    calendarName: sourceDisplayName(source),
    color: sourceColor(source, EDataServer),
    location: textValue(component?.get_location?.()) || undefined,
  };
}

function sourceUid(source: any): string {
  return source?.get_uid?.() || sourceDisplayName(source) || "unknown-source";
}

function getCachedClient(source: any, ECal: any): any {
  const uid = sourceUid(source);
  const cached = clientCache.get(uid);
  if (cached) return cached;

  const client = ECal.Client.connect_sync(
    source,
    ECal.ClientSourceType.EVENTS,
    2,
    null as Gio.Cancellable | null,
  );
  clientCache.set(uid, client);
  return client;
}

function applyCachedEvents(cacheKey: string): boolean {
  const cached = eventCache.get(cacheKey);
  if (!cached) return false;

  events = cached.events;
  backendStatus = cached.status;
  backendMessage = cached.message;
  renderCalendar();
  return true;
}

async function loadEventsForVisibleGrid(): Promise<void> {
  const loadVersion = ++backendLoadVersion;
  const { start, end } = getCalendarGridRange();
  const cacheKey = gridRangeKey(start, end);

  if (!applyCachedEvents(cacheKey)) {
    events = [];
    backendStatus = "loading";
    backendMessage = "Loading events...";
    renderCalendar();
  }

  try {
    const { ECal, EDataServer } = await loadBackendModules();
    if (loadVersion !== backendLoadVersion) return;

    backendRegistry ||= EDataServer.SourceRegistry.new_sync(null);
    const sources = asArray<any>(
      backendRegistry.list_enabled?.(EDataServer.SOURCE_EXTENSION_CALENDAR) ??
        backendRegistry.list_sources?.(EDataServer.SOURCE_EXTENSION_CALENDAR),
    );

    if (sources.length === 0) {
      events = [];
      backendStatus = "unavailable";
      backendMessage = "No visible EDS calendars";
      eventCache.set(cacheKey, { events, status: backendStatus, message: backendMessage });
      renderCalendar();
      return;
    }

    const nextEvents: CalendarEventPreview[] = [];
    const sexp = buildRangeQuery(start, end);
    for (const source of sources) {
      try {
        const client = getCachedClient(source, ECal);
        const [ok, components] = client.get_object_list_as_comps_sync(sexp, null);
        if (!ok) continue;

        for (const [index, component] of asArray<any>(components).entries()) {
          const event = componentToEvent(component, source, EDataServer, index);
          if (event) nextEvents.push(event);
        }
      } catch (e) {
        console.error("Failed to read EDS calendar source:", e);
      }
    }

    if (loadVersion !== backendLoadVersion) return;
    events = nextEvents.sort((a, b) => a.start.getTime() - b.start.getTime());
    backendStatus = "ready";
    backendMessage = "";
    eventCache.set(cacheKey, { events, status: backendStatus, message: backendMessage });
    renderCalendar();
  } catch (e) {
    if (loadVersion !== backendLoadVersion) return;
    events = [];
    backendStatus = "unavailable";
    backendMessage = "Calendar events unavailable";
    eventCache.set(cacheKey, { events, status: backendStatus, message: backendMessage });
    console.error("EDS calendar backend unavailable:", e);
    renderCalendar();
  }
}

function scheduleBackendRefresh(): void {
  if (!isVisible || backendRefreshSource !== 0) return;
  backendRefreshSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    backendRefreshSource = 0;
    invalidateBackendCache();
    void loadEventsForVisibleGrid();
    return GLib.SOURCE_REMOVE;
  });
}

function startBackendWatch(): void {
  if (!backendRegistry || backendRegistrySignalIds.length > 0) return;
  for (const signal of [
    "source-added",
    "source-changed",
    "source-disabled",
    "source-enabled",
    "source-removed",
  ]) {
    backendRegistrySignalIds.push(backendRegistry.connect(signal, scheduleBackendRefresh));
  }
}

function stopBackendWatch(): void {
  if (backendRefreshSource !== 0) {
    GLib.source_remove(backendRefreshSource);
    backendRefreshSource = 0;
  }

  if (!backendRegistry) return;
  for (const signalId of backendRegistrySignalIds) {
    backendRegistry.disconnect(signalId);
  }
  backendRegistrySignalIds = [];
}

function refreshVisibleEvents(): void {
  if (!isVisible) return;
  void loadEventsForVisibleGrid().then(startBackendWatch);
}

function invalidateBackendCache(): void {
  eventCache = new Map();
  clientCache = new Map();
}

function nextMarkerName(): string {
  markerCssCounter += 1;
  return `calendar-marker-${markerCssCounter}`;
}

function clearBox(box: Gtk.Box): void {
  let child = box.get_first_child();
  while (child) {
    box.remove(child);
    child = box.get_first_child();
  }
}

function setCssClass(widget: Gtk.Widget, className: string, enabled: boolean): void {
  if (enabled) {
    widget.add_css_class(className);
  } else {
    widget.remove_css_class(className);
  }
}

function updateDaySelection(): void {
  if (dayButtons.size === 0) {
    renderCalendar();
    return;
  }

  const selectedKey = localDateKey(selectedDate);
  for (const [dateKey, button] of dayButtons) {
    setCssClass(button, "selected", dateKey === selectedKey);
  }
}

function resetCalendarRefs(): void {
  dayButtons = new Map();
  monthTitleLabel = null;
  statusLabel = null;
  weekdayLabelWidgets = [];
  daySlots = [];
}

function makeLabel(label: string, className: string): Gtk.Label {
  const widget = new Gtk.Label({ label });
  widget.add_css_class(className);
  return widget;
}

function makeHeaderButton(label: string, className: string, onClick: () => void): Gtk.Button {
  const button = new Gtk.Button({ label });
  button.add_css_class("calendar-nav-button");
  button.add_css_class(className);
  button.connect("clicked", onClick);
  button.set_cursor_from_name("pointer");
  return button;
}

function makeDayButton(slotIndex: number): DaySlot {
  const button = new Gtk.Button();
  button.add_css_class("calendar-day");
  button.set_size_request(44, 44);
  button.set_cursor_from_name("pointer");
  button.connect("clicked", () => {
    const slot = daySlots[slotIndex];
    if (!slot) return;
    selectedDate = slot.date;
    updateDaySelection();
  });

  const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0 });
  content.add_css_class("calendar-day-content");

  const number = makeLabel("", "calendar-day-number");
  content.append(number);

  const spacer = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
  spacer.set_vexpand(true);
  content.append(spacer);

  const markerRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 2 });
  markerRow.add_css_class("calendar-marker-row");
  markerRow.set_halign(Gtk.Align.CENTER);
  content.append(markerRow);

  button.set_child(content);
  return { button, number, markerRow, date: selectedDate };
}

function buildCalendarShell(): void {
  if (!calendarBox) return;

  clearBox(calendarBox);
  resetCalendarRefs();

  const header = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 });
  header.add_css_class("calendar-header");
  header.append(makeHeaderButton("‹", "previous", previousMonth));

  const title = makeLabel("", "calendar-title");
  title.set_hexpand(true);
  monthTitleLabel = title;
  header.append(title);

  header.append(makeHeaderButton("Today", "today-button", goToday));
  header.append(makeHeaderButton("›", "next", nextMonth));
  calendarBox.append(header);

  statusLabel = makeLabel("", "calendar-status");
  calendarBox.append(statusLabel);

  const weekdays = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 4, homogeneous: true });
  weekdays.add_css_class("calendar-weekdays");
  for (let index = 0; index < 7; index++) {
    const weekday = makeLabel("", "calendar-weekday");
    weekday.set_size_request(44, 18);
    weekday.set_halign(Gtk.Align.CENTER);
    weekdayLabelWidgets.push(weekday);
    weekdays.append(weekday);
  }
  calendarBox.append(weekdays);

  for (let rowIndex = 0; rowIndex < 6; rowIndex++) {
    const row = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 4, homogeneous: true });
    row.add_css_class("calendar-day-row");
    for (let columnIndex = 0; columnIndex < 7; columnIndex++) {
      const slot = makeDayButton(rowIndex * 7 + columnIndex);
      daySlots.push(slot);
      row.append(slot.button);
    }
    calendarBox.append(row);
  }
}

function updateDaySlot(slot: DaySlot, day: CalendarDay): void {
  const dateKey = localDateKey(day.date);
  slot.date = day.date;
  slot.number.set_label(String(day.date.getDate()));
  slot.button.set_tooltip_text(eventTooltip(day));
  setCssClass(slot.button, "outside-month", !day.inVisibleMonth);
  setCssClass(slot.button, "selected", day.isSelected);
  setCssClass(slot.button, "today", day.isToday);
  dayButtons.set(dateKey, slot.button);

  clearBox(slot.markerRow);
  for (const event of day.markers) {
    const markerName = nextMarkerName();
    const marker = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
    marker.add_css_class("calendar-event-marker");
    marker.set_size_request(6, 6);
    marker.set_tooltip_text(event.title);
    marker.set_name(markerName);
    slot.markerRow.append(marker);

    app.apply_css(
      `#${markerName} { background-color: ${markerColor(event)}; }`,
      false,
    );
  }
  if (day.markerOverflow > 0) {
    slot.markerRow.append(makeLabel(`+${day.markerOverflow}`, "calendar-marker-overflow"));
  }
}

function renderCalendar(): void {
  if (!calendarBox) return;
  if (daySlots.length !== 42 || !monthTitleLabel || !statusLabel) {
    buildCalendarShell();
  }

  monthTitleLabel?.set_label(formatMonthLabel(visibleMonth));
  if (statusLabel) {
    statusLabel.set_label(backendStatus === "ready" ? "" : backendMessage);
    statusLabel.set_visible(backendStatus !== "ready");
  }

  const labels = weekdayLabels();
  for (const [index, label] of labels.entries()) {
    weekdayLabelWidgets[index]?.set_label(label);
  }

  dayButtons = new Map();
  const days = buildCalendarDays();
  for (const [index, day] of days.entries()) {
    const slot = daySlots[index];
    if (slot) updateDaySlot(slot, day);
  }
}

function setTriggerMonitor(): void {
  if (!win) return;

  try {
    const display = Gdk.Display.get_default();
    const seat = display?.get_default_seat();
    const pointer = seat?.get_pointer() as unknown as {
      get_position?: () => [unknown, number, number];
    } | null;
    if (!display || !pointer?.get_position) return;

    const [, x, y] = pointer.get_position();
    const monitor = display.get_monitor_at_point(x, y);
    if (monitor) {
      win.set_gdkmonitor(monitor);
    }
  } catch (e) {
    console.error("Failed to resolve calendar trigger monitor:", e);
  }
}

function hideCalendar(): void {
  if (!win) return;
  win.set_visible(false);
  isVisible = false;
  stopBackendWatch();
}

function showCalendar(): void {
  if (!win) createWindow();
  setTriggerMonitor();
  renderCalendar();
  ignoreNextOutsideClick = true;
  win?.set_visible(true);
  isVisible = true;
  refreshVisibleEvents();

  try {
    GLib.spawn_command_line_async("pkill -SIGUSR1 waybar");
  } catch (e) {
    console.error("Failed to show waybar:", e);
  }
}

function toggleCalendar(): void {
  if (isVisible) {
    hideCalendar();
    return;
  }
  showCalendar();
}

function previousMonth(): void {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1);
  renderCalendar();
  refreshVisibleEvents();
}

function nextMonth(): void {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
  renderCalendar();
  refreshVisibleEvents();
}

function goToday(): void {
  const today = new Date();
  visibleMonth = startOfMonth(today);
  selectedDate = startOfLocalDay(today);
  renderCalendar();
  refreshVisibleEvents();
}

function selectDate(value: string | undefined): void {
  if (!value) return;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return;
  selectedDate = date;
  visibleMonth = startOfMonth(date);
  renderCalendar();
  refreshVisibleEvents();
}

function handleOutsideClick(x: number, y: number): void {
  if (!isVisible || !calendarBox) return;
  if (ignoreNextOutsideClick) {
    ignoreNextOutsideClick = false;
    return;
  }

  const allocation = calendarBox.get_allocation();
  if (
    x < allocation.x ||
    x > allocation.x + allocation.width ||
    y < allocation.y ||
    y > allocation.y + allocation.height
  ) {
    hideCalendar();
  }
}

function applyStaticCSS(): void {
  app.apply_css(
    `
    window.calendar-widget {
      background-color: transparent;
      border: none;
      padding: 0;
    }

    window.calendar-widget box.calendar-container {
      background-color: rgba(45, 45, 45, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      padding: 12px;
      min-width: 338px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24), 0 2px 8px rgba(0, 0, 0, 0.12);
      margin-bottom: 53px;
      margin-right: 8px;
    }

    window.calendar-widget box.calendar-header {
      margin-bottom: 8px;
    }

    window.calendar-widget button.calendar-nav-button {
      min-height: 28px;
      min-width: 28px;
      padding: 0 6px;
      border-radius: 6px;
      background-color: transparent;
      color: ${tokens.colors.foreground.secondary.value};
      border: none;
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      font-size: 12px;
    }

    window.calendar-widget button.calendar-nav-button:hover,
    window.calendar-widget button.calendar-nav-button:focus {
      background-color: rgba(255, 255, 255, 0.1);
      color: ${tokens.colors.foreground.primary.value};
    }

    window.calendar-widget label.calendar-title {
      color: ${tokens.colors.foreground.primary.value};
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      font-size: 14px;
      font-weight: 600;
    }

    window.calendar-widget label.calendar-status {
      color: ${tokens.colors.foreground.tertiary.value};
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      font-size: 11px;
      margin-bottom: 6px;
    }

    window.calendar-widget box.calendar-weekdays {
      margin-bottom: 4px;
    }

    window.calendar-widget label.calendar-weekday {
      color: ${tokens.colors.foreground.tertiary.value};
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      font-size: 11px;
      font-weight: 500;
    }

    window.calendar-widget box.calendar-day-row {
      margin-bottom: 4px;
    }

    window.calendar-widget button.calendar-day {
      min-width: 44px;
      min-height: 44px;
      padding: 4px;
      border-radius: 6px;
      border: 1px solid transparent;
      background-color: transparent;
      color: ${tokens.colors.foreground.primary.value};
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
    }

    window.calendar-widget button.calendar-day:hover,
    window.calendar-widget button.calendar-day:focus {
      background-color: rgba(255, 255, 255, 0.1);
    }

    window.calendar-widget button.calendar-day.selected {
      border-color: ${tokens.colors.accent.primary.value};
      background-color: rgba(0, 103, 192, 0.2);
    }

    window.calendar-widget button.calendar-day.outside-month {
      opacity: 0.5;
      color: rgba(153, 153, 153, 0.35);
    }

    window.calendar-widget label.calendar-day-number {
      font-size: 12px;
      color: inherit;
    }

    window.calendar-widget button.calendar-day.today label.calendar-day-number {
      background-color: rgba(255, 255, 255, 0.15);
      border-radius: 999px;
      min-width: 20px;
      min-height: 20px;
    }

    window.calendar-widget box.calendar-event-marker {
      border-radius: 999px;
      min-width: 6px;
      min-height: 6px;
    }

    window.calendar-widget label.calendar-marker-overflow {
      font-size: 9px;
      color: ${tokens.colors.foreground.tertiary.value};
    }
  `,
    false,
  );
}

function createWindow(): void {
  if (win) return;

  win = (
    <window
      name="calendar-widget"
      namespace="ags-calendar-widget"
      visible={false}
      anchor={
        Astal.WindowAnchor.TOP |
        Astal.WindowAnchor.BOTTOM |
        Astal.WindowAnchor.LEFT |
        Astal.WindowAnchor.RIGHT
      }
      layer={Astal.Layer.OVERLAY}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.ON_DEMAND}
      application={app}
      class="calendar-widget"
      $={(self: Astal.Window) => {
        const keyController = new Gtk.EventControllerKey();
        keyController.connect("key-pressed", (_controller, keyval) => {
          if (keyval === Gdk.KEY_Escape) {
            hideCalendar();
            return true;
          }
          return false;
        });
        self.add_controller(keyController);

        const clickController = new Gtk.GestureClick();
        clickController.connect("released", (_controller, _nPress, x, y) => {
          handleOutsideClick(x, y);
        });
        self.add_controller(clickController);
      }}
    >
      <box orientation={Gtk.Orientation.VERTICAL} valign={Gtk.Align.END} halign={Gtk.Align.END}>
        <box
          orientation={Gtk.Orientation.VERTICAL}
          spacing={0}
          class="calendar-container"
          $={(self: Gtk.Box) => {
            calendarBox = self;
            renderCalendar();
          }}
        />
      </box>
    </window>
  ) as Astal.Window;
}

function initCalendarWidget(): void {
  applyStaticCSS();
}

function handleCalendarWidgetRequest(argv: string[], res: (response: string) => void): void {
  const mark = perf.start("calendar-widget", "handleRequest");
  let ok = true;
  let error: string | undefined;
  try {
    const request = argv.join(" ");
    if (!request || request.trim() === "") {
      res("ready");
      return;
    }

    let data: { action?: string; date?: string };
    try {
      data = JSON.parse(request);
    } catch (e) {
      console.error("Error parsing calendar-widget request:", e);
      res("error: invalid JSON");
      return;
    }

    switch (data.action) {
      case "show":
        showCalendar();
        res("shown");
        return;
      case "hide":
        hideCalendar();
        res("hidden");
        return;
      case "toggle":
        toggleCalendar();
        res(isVisible ? "shown" : "hidden");
        return;
      case "is-visible":
        res(isVisible ? "true" : "false");
        return;
      case "next-month":
        nextMonth();
        res("ok");
        return;
      case "prev-month":
        previousMonth();
        res("ok");
        return;
      case "today":
        goToday();
        res("ok");
        return;
      case "select-date":
        selectDate(data.date);
        res("ok");
        return;
      default:
        res("unknown action");
        return;
    }
  } catch (e) {
    ok = false;
    error = String(e);
    console.error("Error handling calendar-widget request:", e);
    res(`error: ${e}`);
  } finally {
    mark.end(ok, error);
  }
}

globalThis.CalendarWidget = {
  init: initCalendarWidget,
  handleRequest: handleCalendarWidgetRequest,
  instanceName: "calendar-widget",
};
