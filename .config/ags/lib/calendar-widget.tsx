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

interface CalendarRange {
  start: Date;
  end: Date;
}

interface CalendarBackendSnapshot extends CachedEvents {}

interface CalendarBackendModule {
  init: () => void;
  refresh: () => boolean;
  stop: () => void;
}

interface SerializedEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  calendarName?: string;
  color?: string;
  location?: string;
}

interface SerializedCacheEntry {
  events: SerializedEvent[];
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
let dayGridBox: Gtk.Box | null = null;
let dayButtons = new Map<string, Gtk.Button>();
let monthTitleLabel: Gtk.Label | null = null;
let statusLabel: Gtk.Label | null = null;
let weekdayLabelWidgets: Gtk.Label[] = [];
let daySlots: DaySlot[] = [];
let isVisible = false;
let lastToggleAtMs = 0;
let visibleMonth = startOfMonth(new Date());
let selectedDate: Date | null = startOfLocalDay(new Date());
let events: CalendarEventPreview[] = [];
let backendStatus: BackendStatus = "unavailable";
let backendMessage = "Calendar events unavailable";
let markerCssCounter = 0;
let markerCssClasses = new Map<string, string>();

const weekStartsOn: WeekStart = 1;
const markerLimit = 3;
const dayInMs = 24 * 60 * 60 * 1000;
const edsConnectWaitSeconds = 1;
const runtimeDir = GLib.getenv("XDG_RUNTIME_DIR") || GLib.get_tmp_dir();
const eventCachePath = `${runtimeDir}/ags-calendar-widget-events.json`;
const monthFormatter = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const dateLabelFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});
const weekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const weekdayLabelCache = Array.from({ length: 7 }, (_, index) => {
  const sunday = new Date(2026, 0, 4);
  const dayOffset = (weekStartsOn + index) % 7;
  return weekdayFormatter.format(addLocalDays(sunday, dayOffset));
});
const desktopTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

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

function getCalendarGridRange(): CalendarRange {
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
      isSelected: selectedDate ? sameLocalDay(date, selectedDate) : false,
      events: dayEvents,
      markers: dayEvents.slice(0, markerLimit),
      markerOverflow: Math.max(0, dayEvents.length - markerLimit),
    };
  });
}

function formatMonthLabel(date: Date): string {
  return monthFormatter.format(date);
}

function formatDateLabel(date: Date): string {
  return dateLabelFormatter.format(date);
}

function weekdayLabels(): string[] {
  return weekdayLabelCache;
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
  return desktopTimeZone;
}

function formatEdsTime(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function buildRangeQuery(start: Date, end: Date): string {
  const startWithSlack = new Date(start.getTime() - 1000);
  const endWithSlack = new Date(end.getTime() + 1000);
  return `(occur-in-time-range? (make-time "${formatEdsTime(startWithSlack)}") (make-time "${formatEdsTime(endWithSlack)}") "${resolvedTimeZone()}")`;
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
  info: { name?: string; color?: string },
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
    calendarName: info.name,
    color: info.color,
    location: textValue(component?.get_location?.()) || undefined,
  };
}

function sourceUid(source: any): string {
  return source?.get_uid?.() || sourceDisplayName(source) || "unknown-source";
}

function serializeEvent(event: CalendarEventPreview): SerializedEvent {
  return {
    ...event,
    start: event.start.toISOString(),
    end: event.end.toISOString(),
  };
}

function deserializeEvent(event: SerializedEvent): CalendarEventPreview | null {
  const start = new Date(event.start);
  const end = new Date(event.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  return {
    ...event,
    start,
    end,
  };
}

function createCalendarBackendModule(options: {
  readRange: () => CalendarRange;
  isVisible: () => boolean;
  applySnapshot: (snapshot: CalendarBackendSnapshot) => void;
}): CalendarBackendModule {
  let loadVersion = 0;
  let modules: BackendModules | null = null;
  let registry: any | null = null;
  let registrySignalIds: number[] = [];
  let refreshSource = 0;
  let loadSource = 0;
  let eventCache = new Map<string, CachedEvents>();
  let clientCache = new Map<string, Promise<any>>();
  let sourceInfoCache = new Map<string, { name?: string; color?: string }>();

  async function loadModules(): Promise<BackendModules> {
    if (modules) return modules;

    const [{ default: ECal }, { default: EDataServer }] = await Promise.all([
      import("gi://ECal?version=2.0"),
      import("gi://EDataServer?version=1.2"),
    ]);
    modules = { ECal, EDataServer };
    return modules;
  }

  function sourceInfo(source: any, EDataServer: any): { name?: string; color?: string } {
    const uid = sourceUid(source);
    const cached = sourceInfoCache.get(uid);
    if (cached) return cached;

    const info = {
      name: sourceDisplayName(source),
      color: sourceColor(source, EDataServer),
    };
    sourceInfoCache.set(uid, info);
    return info;
  }

  function loadSourceRegistry(EDataServer: any): Promise<any> {
    return new Promise((resolve, reject) => {
      EDataServer.SourceRegistry.new(null, (_sourceRegistry: unknown, result: Gio.AsyncResult) => {
        try {
          resolve(EDataServer.SourceRegistry.new_finish(result));
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  function connectSourceClient(source: any, ECal: any): Promise<any> {
    return new Promise((resolve, reject) => {
      ECal.Client.connect(
        source,
        ECal.ClientSourceType.EVENTS,
        edsConnectWaitSeconds,
        null,
        (_client: unknown, result: Gio.AsyncResult) => {
          try {
            resolve(ECal.Client.connect_finish(result));
          } catch (e) {
            reject(e);
          }
        },
      );
    });
  }

  function querySourceEvents(client: any, sexp: string): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
      client.get_object_list_as_comps(sexp, null, (_client: unknown, result: Gio.AsyncResult) => {
        try {
          const response = client.get_object_list_as_comps_finish(result);
          if (Array.isArray(response)) {
            const [ok, components] = response;
            resolve(ok ? asArray<unknown>(components) : []);
            return;
          }

          resolve(asArray<unknown>(response));
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  function getClient(source: any, ECal: any): Promise<any> {
    const uid = sourceUid(source);
    const cached = clientCache.get(uid);
    if (cached) return cached;

    const mark = perf.start("calendar-widget", "connectSourceClient");
    const clientPromise = connectSourceClient(source, ECal).finally(() => mark.end());
    clientCache.set(uid, clientPromise);
    return clientPromise;
  }

  function loadCacheFromTmpfs(): void {
    try {
      if (!Gio.File.new_for_path(eventCachePath).query_exists(null)) return;
      const [ok, contents] = GLib.file_get_contents(eventCachePath);
      if (!ok || !contents) return;

      const text = new TextDecoder("utf-8").decode(contents);
      const parsed = JSON.parse(text) as Record<string, SerializedCacheEntry>;
      for (const [cacheKey, entry] of Object.entries(parsed)) {
        const cachedEvents = entry.events
          .map(deserializeEvent)
          .filter((event): event is CalendarEventPreview => event !== null);
        eventCache.set(cacheKey, {
          events: cachedEvents,
          status: entry.status,
          message: entry.message,
        });
      }
    } catch (e) {
      console.error("Failed to read calendar event cache:", e);
    }
  }

  function writeCacheToTmpfs(): void {
    try {
      const serialized: Record<string, SerializedCacheEntry> = {};
      for (const [cacheKey, entry] of eventCache) {
        serialized[cacheKey] = {
          events: entry.events.map(serializeEvent),
          status: entry.status,
          message: entry.message,
        };
      }

      GLib.file_set_contents(eventCachePath, JSON.stringify(serialized));
    } catch (e) {
      console.error("Failed to write calendar event cache:", e);
    }
  }

  function applyCachedEvents(cacheKey: string): boolean {
    const cached = eventCache.get(cacheKey);
    if (!cached) return false;

    options.applySnapshot(cached);
    return true;
  }

  function applyVisibleGridCache(): boolean {
    const { start, end } = options.readRange();
    const cacheKey = gridRangeKey(start, end);
    return applyCachedEvents(cacheKey);
  }

  function applyLoadingSnapshot(): void {
    options.applySnapshot({ events: [], status: "loading", message: "" });
  }

  function invalidate(): void {
    eventCache = new Map();
    clientCache = new Map();
    sourceInfoCache = new Map();
    try {
      GLib.unlink(eventCachePath);
    } catch {
      // Missing cache file is fine.
    }
  }

  async function loadEventsForVisibleGrid(): Promise<void> {
    const mark = perf.start("calendar-widget", "loadEventsForVisibleGrid");
    let ok = true;
    let error: string | undefined;
    const currentLoadVersion = ++loadVersion;
    const { start, end } = options.readRange();
    const cacheKey = gridRangeKey(start, end);

    try {
      if (!applyCachedEvents(cacheKey)) {
        options.applySnapshot({ events: [], status: "loading", message: "Loading events..." });
      }

      const { ECal, EDataServer } = await loadModules();
      if (currentLoadVersion !== loadVersion) return;

      if (!registry) {
        const registryMark = perf.start("calendar-widget", "loadSourceRegistry");
        try {
          registry = await loadSourceRegistry(EDataServer);
        } finally {
          registryMark.end();
        }
      }
      const sources = asArray<any>(
        registry.list_enabled?.(EDataServer.SOURCE_EXTENSION_CALENDAR) ??
          registry.list_sources?.(EDataServer.SOURCE_EXTENSION_CALENDAR),
      );

      if (sources.length === 0) {
        const snapshot = { events: [], status: "unavailable" as BackendStatus, message: "No visible EDS calendars" };
        eventCache.set(cacheKey, snapshot);
        writeCacheToTmpfs();
        options.applySnapshot(snapshot);
        return;
      }

      const nextEvents: CalendarEventPreview[] = [];
      const sexp = buildRangeQuery(start, end);
      for (const source of sources) {
        try {
          const client = await getClient(source, ECal);
          if (currentLoadVersion !== loadVersion) return;
          const queryMark = perf.start("calendar-widget", "querySourceEvents");
          let components: unknown[];
          try {
            components = await querySourceEvents(client, sexp);
          } finally {
            queryMark.end();
          }

          const info = sourceInfo(source, EDataServer);
          for (const [index, component] of components.entries()) {
            const event = componentToEvent(component, source, info, index);
            if (event) nextEvents.push(event);
          }
        } catch (e) {
          console.error("Failed to read EDS calendar source:", e);
        }
      }

      if (currentLoadVersion !== loadVersion) return;
      const snapshot = {
        events: nextEvents.sort((a, b) => a.start.getTime() - b.start.getTime()),
        status: "ready" as BackendStatus,
        message: "",
      };
      eventCache.set(cacheKey, snapshot);
      writeCacheToTmpfs();
      options.applySnapshot(snapshot);
    } catch (e) {
      ok = false;
      error = String(e);
      if (currentLoadVersion !== loadVersion) return;
      const snapshot = {
        events: [],
        status: "unavailable" as BackendStatus,
        message: "Calendar events unavailable",
      };
      eventCache.set(cacheKey, snapshot);
      writeCacheToTmpfs();
      console.error("EDS calendar backend unavailable:", e);
      options.applySnapshot(snapshot);
    } finally {
      mark.end(ok, error);
    }
  }

  function scheduleBackendRefresh(): void {
    if (!options.isVisible() || refreshSource !== 0) return;
    refreshSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      refreshSource = 0;
      invalidate();
      void loadEventsForVisibleGrid();
      return GLib.SOURCE_REMOVE;
    });
  }

  function startBackendWatch(): void {
    if (!registry || registrySignalIds.length > 0) return;
    for (const signal of [
      "source-added",
      "source-changed",
      "source-disabled",
      "source-enabled",
      "source-removed",
    ]) {
      registrySignalIds.push(registry.connect(signal, scheduleBackendRefresh));
    }
  }

  function stop(): void {
    if (loadSource !== 0) {
      GLib.source_remove(loadSource);
      loadSource = 0;
    }

    if (refreshSource !== 0) {
      GLib.source_remove(refreshSource);
      refreshSource = 0;
    }

    if (!registry) return;
    for (const signalId of registrySignalIds) {
      registry.disconnect(signalId);
    }
    registrySignalIds = [];
  }

  return {
    init: loadCacheFromTmpfs,
    refresh(): boolean {
      if (!options.isVisible()) return false;
      const appliedCache = applyVisibleGridCache();
      if (!appliedCache) applyLoadingSnapshot();
      if (loadSource !== 0) return appliedCache;
      loadSource = GLib.timeout_add(GLib.PRIORITY_LOW, 100, () => {
        loadSource = 0;
        if (options.isVisible()) void loadEventsForVisibleGrid().then(startBackendWatch);
        return GLib.SOURCE_REMOVE;
      });
      return appliedCache;
    },
    stop,
  };
}

const calendarBackend = createCalendarBackendModule({
  readRange: getCalendarGridRange,
  isVisible: () => isVisible,
  applySnapshot(snapshot) {
    events = snapshot.events;
    backendStatus = snapshot.status;
    backendMessage = snapshot.message;
    renderCalendar();
  },
});

function nextMarkerName(): string {
  markerCssCounter += 1;
  return `calendar-marker-${markerCssCounter}`;
}

function markerCssClass(event: CalendarEventPreview): string {
  const color = markerColor(event);
  const cached = markerCssClasses.get(color);
  if (cached) return cached;

  const className = nextMarkerName();
  markerCssClasses.set(color, className);
  app.apply_css(
    `window.calendar-widget box.${className} { background-color: ${color}; }`,
    false,
  );
  return className;
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

  const selectedKey = selectedDate ? localDateKey(selectedDate) : null;
  for (const [dateKey, button] of dayButtons) {
    setCssClass(button, "selected", dateKey === selectedKey);
  }
}

function resetCalendarRefs(): void {
  dayButtons = new Map();
  monthTitleLabel = null;
  statusLabel = null;
  dayGridBox = null;
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
  if (slotIndex % 7 !== 0) button.add_css_class("not-first-column");
  if (slotIndex >= 7) button.add_css_class("not-first-row");
  button.set_size_request(48, 48);
  button.set_cursor_from_name("pointer");
  button.connect("clicked", () => {
    const slot = daySlots[slotIndex];
    if (!slot) return;
    selectedDate = slot.date;
    updateDaySelection();
  });

  const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0 });
  content.add_css_class("calendar-day-content");
  content.set_hexpand(true);
  content.set_vexpand(true);

  const number = makeLabel("", "calendar-day-number");
  number.set_halign(Gtk.Align.START);
  number.set_xalign(0);
  content.append(number);

  const spacer = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
  spacer.set_vexpand(true);
  content.append(spacer);

  const markerRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 2 });
  markerRow.add_css_class("calendar-marker-row");
  markerRow.set_halign(Gtk.Align.CENTER);
  content.append(markerRow);

  button.set_child(content);
  return { button, number, markerRow, date: selectedDate ?? startOfLocalDay(new Date()) };
}

function buildCalendarShell(): void {
  if (!calendarBox) return;

  clearBox(calendarBox);
  resetCalendarRefs();

  const header = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 });
  header.add_css_class("calendar-header");
  header.append(makeHeaderButton("‹", "previous", previousMonth));

  const titleBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0 });
  titleBox.add_css_class("calendar-title-box");
  titleBox.set_hexpand(true);

  const title = makeLabel("", "calendar-title");
  title.set_halign(Gtk.Align.CENTER);
  monthTitleLabel = title;

  statusLabel = makeLabel("", "calendar-status");
  statusLabel.set_halign(Gtk.Align.CENTER);

  titleBox.append(title);
  titleBox.append(statusLabel);
  header.append(titleBox);

  header.append(makeHeaderButton("Today", "today-button", goToday));
  header.append(makeHeaderButton("›", "next", nextMonth));
  calendarBox.append(header);

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

  const dayGrid = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0 });
  dayGrid.add_css_class("calendar-day-grid");
  dayGridBox = dayGrid;

  for (let rowIndex = 0; rowIndex < 6; rowIndex++) {
    const row = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 0, homogeneous: true });
    row.add_css_class("calendar-day-row");
    for (let columnIndex = 0; columnIndex < 7; columnIndex++) {
      const slot = makeDayButton(rowIndex * 7 + columnIndex);
      daySlots.push(slot);
      row.append(slot.button);
    }
    dayGrid.append(row);
  }

  calendarBox.append(dayGrid);
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
    const marker = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
    marker.add_css_class("calendar-event-marker");
    marker.add_css_class(markerCssClass(event));
    marker.set_size_request(6, 6);
    marker.set_tooltip_text(event.title);
    slot.markerRow.append(marker);
  }
  if (day.markerOverflow > 0) {
    slot.markerRow.append(makeLabel(`+${day.markerOverflow}`, "calendar-marker-overflow"));
  }
}

function renderCalendar(): void {
  if (!calendarBox) return;
  const mark = perf.start("calendar-widget", "renderCalendar");
  try {
    if (daySlots.length !== 42 || !monthTitleLabel || !statusLabel) {
      buildCalendarShell();
    }

    monthTitleLabel?.set_label(formatMonthLabel(visibleMonth));
    if (statusLabel) {
      const showStatus = backendStatus !== "ready" && backendStatus !== "loading";
      statusLabel.set_label(showStatus ? backendMessage : "");
      statusLabel.set_visible(showStatus);
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
  } finally {
    mark.end();
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
  calendarBackend.stop();
}

function showCalendar(): void {
  if (!win) createWindow();
  setTriggerMonitor();
  win?.set_visible(true);
  isVisible = true;
  if (!calendarBackend.refresh()) renderCalendar();

  try {
    GLib.spawn_command_line_async("pkill -SIGUSR1 waybar");
  } catch (e) {
    console.error("Failed to show waybar:", e);
  }
}

function toggleCalendar(): void {
  const now = GLib.get_monotonic_time() / 1000;
  if (now - lastToggleAtMs < 300) return;
  lastToggleAtMs = now;

  if (isVisible) {
    hideCalendar();
    return;
  }
  showCalendar();
}

function previousMonth(): void {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1);
  if (!calendarBackend.refresh()) renderCalendar();
}

function nextMonth(): void {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
  if (!calendarBackend.refresh()) renderCalendar();
}

function goToday(): void {
  const today = new Date();
  visibleMonth = startOfMonth(today);
  selectedDate = startOfLocalDay(today);
  if (!calendarBackend.refresh()) renderCalendar();
}

function selectDate(value: string | undefined): void {
  if (!value) return;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return;
  selectedDate = date;
  visibleMonth = startOfMonth(date);
  if (!calendarBackend.refresh()) renderCalendar();
}

function handleOutsideClick(x: number, y: number): void {
  if (!isVisible || !calendarBox) return;

  const allocation = calendarBox.get_allocation();
  if (
    x < allocation.x ||
    x > allocation.x + allocation.width ||
    y < allocation.y ||
    y > allocation.y + allocation.height
  ) {
    hideCalendar();
    return;
  }

  if (!dayGridBox) return;
  const gridAllocation = dayGridBox.get_allocation();
  const localX = x - allocation.x;
  const localY = y - allocation.y;
  const insideGrid =
    localX >= gridAllocation.x &&
    localX <= gridAllocation.x + gridAllocation.width &&
    localY >= gridAllocation.y &&
    localY <= gridAllocation.y + gridAllocation.height;

  if (!insideGrid && selectedDate) {
    selectedDate = null;
    updateDaySelection();
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
      min-width: 336px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24), 0 2px 8px rgba(0, 0, 0, 0.12);
      margin-bottom: 53px;
      margin-right: 8px;
    }

    window.calendar-widget box.calendar-header {
      margin-bottom: 12px;
    }

    window.calendar-widget box.calendar-title-box {
      min-width: 0;
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

    window.calendar-widget button.today-button {
      padding-left: 8px;
      padding-right: 8px;
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
      text-transform: capitalize;
    }

    window.calendar-widget label.calendar-status {
      color: ${tokens.colors.foreground.tertiary.value};
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      font-size: 11px;
    }

    window.calendar-widget box.calendar-weekdays {
      margin-bottom: 4px;
    }

    window.calendar-widget box.calendar-day-grid {
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 6px;
    }

    window.calendar-widget label.calendar-weekday {
      color: ${tokens.colors.foreground.tertiary.value};
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      font-size: 11px;
      font-weight: 500;
    }

    window.calendar-widget button.calendar-day {
      min-width: 48px;
      min-height: 48px;
      padding: 0;
      border-radius: 0;
      border: none;
      background-color: transparent;
      color: ${tokens.colors.foreground.primary.value};
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
    }

    window.calendar-widget box.calendar-day-content {
      padding: 4px;
    }

    window.calendar-widget button.calendar-day.not-first-column {
      border-left: 1px solid rgba(255, 255, 255, 0.08);
    }

    window.calendar-widget button.calendar-day.not-first-row {
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }

    window.calendar-widget button.calendar-day:hover,
    window.calendar-widget button.calendar-day:focus {
      background-color: rgba(255, 255, 255, 0.1);
    }

    window.calendar-widget button.calendar-day.selected {
      background-color: rgba(0, 103, 192, 0.2);
      box-shadow: inset 0 0 0 1px ${tokens.colors.accent.primary.value};
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
      font-weight: 600;
    }

    window.calendar-widget button.calendar-day.today {
      background-color: rgba(255, 255, 255, 0.15);
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
        clickController.set_button(0);
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
  calendarBackend.init();
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
