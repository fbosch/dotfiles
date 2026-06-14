import app from "ags/gtk4/app";
import { Astal } from "ags/gtk4";
import Gdk from "gi://Gdk?version=4.0";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import tokens from "../../../design-system/tokens.json";
import { perf } from "./performance-monitor";

type AudioMixerTab = "playback" | "output" | "input";
type BackendStatus = "loading" | "ready" | "unavailable" | "error";
type RowKind = "stream" | "endpoint" | "device";

interface AudioRow {
  id: string;
  name: string;
  icon: string;
  kind: RowKind;
  object: any;
  volume?: number;
  muted?: boolean;
  isDefault?: boolean;
}

interface AudioSnapshot {
  status: BackendStatus;
  message: string;
  rows: Record<AudioMixerTab, AudioRow[]>;
}

interface AudioBackend {
  init: () => void;
  refresh: () => void;
  stop: () => void;
  setVolume: (row: AudioRow, volume: number) => void;
  toggleMute: (row: AudioRow) => void;
  setDefault: (row: AudioRow) => void;
}

const tabs: Array<{ id: AudioMixerTab; label: string; icon: string }> = [
  { id: "playback", label: "Playback", icon: "\uE768" },
  { id: "output", label: "Output", icon: "\uE995" },
  { id: "input", label: "Input", icon: "\uE720" },
];

const maxVolume = 150;
const meterSegments = 12;

let win: Astal.Window | null = null;
let mixerBox: Gtk.Box | null = null;
let tabBar: Gtk.Box | null = null;
let rowList: Gtk.Box | null = null;
let isVisible = false;
let lastToggleAtMs = 0;
let pointerStartedInsideMixer = false;
let activeTab: AudioMixerTab = "playback";
let tabButtons = new Map<AudioMixerTab, Gtk.Button>();
let snapshot: AudioSnapshot = emptySnapshot("Audio backend unavailable", "unavailable");

function emptyRows(): Record<AudioMixerTab, AudioRow[]> {
  return {
    playback: [],
    output: [],
    input: [],
  };
}

function emptySnapshot(message: string, status: BackendStatus): AudioSnapshot {
  return { status, message, rows: emptyRows() };
}

function asArray<T>(value: unknown): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as T[];
  try {
    const listModel = value as { get_n_items?: () => number; get_item?: (index: number) => T };
    if (typeof listModel.get_n_items === "function" && typeof listModel.get_item === "function") {
      return Array.from({ length: listModel.get_n_items() }, (_, index) => listModel.get_item?.(index)).filter(
        (item): item is T => item !== undefined,
      );
    }

    const length = Number((value as { length?: unknown }).length ?? 0);
    if (Number.isFinite(length) && length > 0) {
      return Array.from({ length }, (_, index) => (value as Record<number, T>)[index]);
    }
  } catch {
    // Ignore non-array GI containers.
  }
  return [];
}

function textValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getText(object: any, keys: string[]): string | undefined {
  for (const key of keys) {
    try {
      const getter = object?.[`get_${key}`];
      const value = typeof getter === "function" ? getter.call(object) : object?.[key];
      const text = textValue(value);
      if (text) return text;
    } catch {
      // Keep probing optional backend fields.
    }
  }
  return undefined;
}

function getBoolean(object: any, keys: string[]): boolean | undefined {
  for (const key of keys) {
    try {
      const getter = object?.[`get_${key}`];
      const value = typeof getter === "function" ? getter.call(object) : object?.[key];
      if (typeof value === "boolean") return value;
    } catch {
      // Keep probing optional backend fields.
    }
  }
  return undefined;
}

function getNumber(object: any, keys: string[]): number | undefined {
  for (const key of keys) {
    try {
      const getter = object?.[`get_${key}`];
      const value = typeof getter === "function" ? getter.call(object) : object?.[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
    } catch {
      // Keep probing optional backend fields.
    }
  }
  return undefined;
}

function getList<T>(object: any, keys: string[]): T[] {
  for (const key of keys) {
    try {
      const getter = object?.[`get_${key}`];
      const value = typeof getter === "function" ? getter.call(object) : object?.[key];
      const list = asArray<T>(value);
      if (list.length > 0) return list;
    } catch {
      // Keep probing optional backend lists.
    }
  }
  return [];
}

function objectId(object: any, fallback: string): string {
  const serial = getText(object, ["serial", "id", "name", "description"]);
  return serial ?? fallback;
}

function displayName(object: any, fallback: string): string {
  return getText(object, ["description", "name", "nick", "media_name", "application_name"]) ?? fallback;
}

function clamp(value: number, max = maxVolume): number {
  return Math.max(0, Math.min(max, Math.round(value)));
}

function clampFloat(value: number, max = maxVolume): number {
  return Math.max(0, Math.min(max, value));
}

function setSourceHex(cr: any, hex: string, alpha = 1): void {
  const normalized = hex.replace("#", "");
  const r = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const g = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const b = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  cr.setSourceRGBA(r, g, b, alpha);
}

function roundedRect(cr: any, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  cr.newSubPath();
  cr.arc(x + width - r, y + r, r, -Math.PI / 2, 0);
  cr.arc(x + width - r, y + height - r, r, 0, Math.PI / 2);
  cr.arc(x + r, y + height - r, r, Math.PI / 2, Math.PI);
  cr.arc(x + r, y + r, r, Math.PI, (Math.PI * 3) / 2);
  cr.closePath();
}

function readVolume(object: any): number | undefined {
  const volume = getNumber(object, ["volume"]);
  if (volume === undefined) return undefined;
  return volume <= 2 ? clamp(volume * 100) : clamp(volume);
}

function speakerIcon(row: Pick<AudioRow, "kind" | "volume" | "muted" | "icon">): string {
  if (row.icon) return row.icon;
  if (row.muted || row.volume === 0) return "\uE74F";
  if ((row.volume ?? 0) <= 30) return "\uE993";
  return "\uE995";
}

function clearBox(box: Gtk.Box): void {
  let child = box.get_first_child();
  while (child) {
    box.remove(child);
    child = box.get_first_child();
  }
}

function setCssClass(widget: Gtk.Widget, className: string, enabled: boolean): void {
  if (enabled) widget.add_css_class(className);
  else widget.remove_css_class(className);
}

function makeLabel(label: string, className: string): Gtk.Label {
  const widget = new Gtk.Label({ label });
  widget.add_css_class(className);
  return widget;
}

function makeIconLabel(label: string): Gtk.Label {
  const widget = makeLabel(label, "audio-mixer-icon-label");
  widget.set_halign(Gtk.Align.CENTER);
  widget.set_valign(Gtk.Align.CENTER);
  widget.set_xalign(0.5);
  widget.set_yalign(0.5);
  return widget;
}

function createAudioBackend(options: { applySnapshot: (snapshot: AudioSnapshot) => void }): AudioBackend {
  let modules: { AstalWp: any } | null = null;
  let audio: any | null = null;
  let signalIds: number[] = [];
  let refreshSource = 0;
  let loadVersion = 0;

  async function loadModules(): Promise<{ AstalWp: any }> {
    if (modules) return modules;
    const { default: AstalWp } = await import("gi://AstalWp");
    modules = { AstalWp };
    return modules;
  }

  function getAudio(AstalWp: any): any | null {
    if (audio) return audio;
    const wp = AstalWp?.get_default?.() ?? AstalWp?.Wp?.get_default?.();
    audio =
      wp?.audio ??
      wp?.get_audio?.() ??
      AstalWp?.Audio?.get_default?.() ??
      AstalWp?.Audio?.new?.();
    return audio;
  }

  function makeRow(object: any, kind: RowKind, fallback: string, icon: string, isDefault = false): AudioRow {
    return {
      id: `${kind}:${objectId(object, fallback)}`,
      name: displayName(object, fallback),
      icon,
      kind,
      object,
      volume: readVolume(object),
      muted: getBoolean(object, ["mute", "muted"]),
      isDefault,
    };
  }

  function buildSnapshot(): AudioSnapshot {
    if (!audio) return emptySnapshot("AstalWP audio unavailable", "unavailable");

    const defaultSpeaker = audio.get_default_speaker?.() ?? audio.default_speaker;
    const defaultMicrophone = audio.get_default_microphone?.() ?? audio.default_microphone;
    const speakers = getList<any>(audio, ["speakers"]);
    const microphones = getList<any>(audio, ["microphones"]);
    const streams = getList<any>(audio, ["streams"]);

    const rows = emptyRows();
    rows.playback = streams.map((stream, index) => makeRow(stream, "stream", `Playback ${index + 1}`, "\uE768"));
    rows.output = speakers.map((speaker, index) => makeRow(speaker, "endpoint", `Output ${index + 1}`, "\uE995", speaker === defaultSpeaker));
    rows.input = microphones.map((microphone, index) => makeRow(microphone, "endpoint", `Input ${index + 1}`, "\uE720", microphone === defaultMicrophone));

    return { status: "ready", message: "", rows };
  }

  function scheduleRefresh(): void {
    if (refreshSource !== 0) return;
    refreshSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      refreshSource = 0;
      try {
        options.applySnapshot(buildSnapshot());
      } catch (e) {
        console.error("Failed to refresh audio mixer state:", e);
        options.applySnapshot(emptySnapshot("Audio state unavailable", "error"));
      }
      return GLib.SOURCE_REMOVE;
    });
  }

  function connectSignals(target: any): void {
    if (!target?.connect) return;
    for (const signal of [
      "notify",
      "speaker-added",
      "speaker-removed",
      "microphone-added",
      "microphone-removed",
      "stream-added",
      "stream-removed",
      "recorder-added",
      "recorder-removed",
      "device-added",
      "device-removed",
    ]) {
      try {
        signalIds.push(target.connect(signal, scheduleRefresh));
      } catch {
        // Signal names vary by generated GIR; best-effort subscriptions only.
      }
    }
  }

  async function loadAudio(): Promise<void> {
    const currentLoadVersion = ++loadVersion;
    try {
      options.applySnapshot(emptySnapshot("", "loading"));
      const { AstalWp } = await loadModules();
      if (currentLoadVersion !== loadVersion) return;

      audio = getAudio(AstalWp);
      if (!audio) {
        options.applySnapshot(emptySnapshot("AstalWP audio unavailable", "unavailable"));
        return;
      }

      connectSignals(audio);
      options.applySnapshot(buildSnapshot());
    } catch (e) {
      console.error("AstalWP audio backend unavailable:", e);
      options.applySnapshot(emptySnapshot("AstalWP audio unavailable", "unavailable"));
    }
  }

  return {
    init() {
      void loadAudio();
    },
    refresh() {
      if (!audio) {
        void loadAudio();
        return;
      }
      scheduleRefresh();
    },
    stop() {
      if (refreshSource !== 0) {
        GLib.source_remove(refreshSource);
        refreshSource = 0;
      }
      if (!audio) return;
      for (const signalId of signalIds) {
        try {
          audio.disconnect(signalId);
        } catch {
          // Ignore stale signal IDs from backend teardown.
        }
      }
      signalIds = [];
    },
    setVolume(row: AudioRow, volume: number) {
      row.volume = clamp(volume);
      const backendVolume = row.volume / 100;
      row.object?.set_volume?.(backendVolume);
      row.object.volume = backendVolume;
    },
    toggleMute(row: AudioRow) {
      const muted = !(row.muted ?? getBoolean(row.object, ["mute", "muted"]) ?? false);
      if (typeof row.object?.set_mute === "function") row.object.set_mute(muted);
      else if (typeof row.object?.set_muted === "function") row.object.set_muted(muted);
      else row.object.mute = muted;
      scheduleRefresh();
    },
    setDefault(row: AudioRow) {
      if (typeof row.object?.set_is_default === "function") row.object.set_is_default(true);
      else if (typeof row.object?.set_default === "function") row.object.set_default();
      scheduleRefresh();
    },
  };
}

const audioBackend = createAudioBackend({
  applySnapshot(nextSnapshot) {
    snapshot = nextSnapshot;
    renderAudioMixer();
  },
});

function activateTab(tab: AudioMixerTab): void {
  activeTab = tab;
  for (const [tabId, button] of tabButtons) {
    setCssClass(button, "active", tabId === activeTab);
  }
  renderRows();
}

function makeTabButton(tab: { id: AudioMixerTab; label: string; icon: string }): Gtk.Button {
  const button = new Gtk.Button();
  button.add_css_class("audio-mixer-tab");
  if (tab.id === activeTab) button.add_css_class("active");
  button.set_hexpand(true);
  button.set_cursor_from_name("pointer");
  button.connect("clicked", () => activateTab(tab.id));

  const content = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 4 });
  content.set_halign(Gtk.Align.CENTER);
  content.append(makeIconLabel(tab.icon));
  const label = makeLabel(tab.label, "audio-mixer-tab-label");
  label.set_ellipsize(3);
  content.append(label);
  button.set_child(content);

  tabButtons.set(tab.id, button);
  return button;
}

function buildTabs(): void {
  if (!tabBar) return;
  clearBox(tabBar);
  tabButtons = new Map();
  for (const tab of tabs) {
    tabBar.append(makeTabButton(tab));
  }
}

function makeBadge(label: string, className: string): Gtk.Label {
  const badge = makeLabel(label, "audio-mixer-badge");
  badge.add_css_class(className);
  badge.set_halign(Gtk.Align.END);
  return badge;
}

function makeMeter(row: AudioRow): Gtk.Box | null {
  if (row.volume === undefined) return null;
  let currentVolume = clampFloat(row.volume);
  let dragging = false;
  let throttleSource = 0;

  const meterWrapper = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 4 });
  meterWrapper.add_css_class("audio-mixer-meter-wrapper");
  meterWrapper.set_hexpand(true);
  meterWrapper.set_halign(Gtk.Align.FILL);

  const volumeRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 });
  const volumeLabel = makeLabel(row.muted ? "Muted" : `${clamp(row.volume)}%`, "audio-mixer-volume-label");
  volumeLabel.set_hexpand(true);
  volumeLabel.set_halign(Gtk.Align.START);
  volumeLabel.set_xalign(0);
  volumeRow.append(volumeLabel);
  meterWrapper.append(volumeRow);

  const drawing = new Gtk.DrawingArea();
  drawing.add_css_class("audio-mixer-meter");
  drawing.set_hexpand(true);
  drawing.set_halign(Gtk.Align.FILL);
  drawing.set_size_request(-1, 24);
  drawing.set_cursor_from_name("pointer");

  function updateLabel(): void {
    volumeLabel.set_label(row.muted ? "Muted" : `${clamp(currentVolume)}%`);
  }

  function sendVolume(immediate = false): void {
    if (throttleSource !== 0) {
      GLib.source_remove(throttleSource);
      throttleSource = 0;
    }

    if (immediate) {
      audioBackend.setVolume(row, currentVolume);
      return;
    }

    throttleSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
      throttleSource = 0;
      audioBackend.setVolume(row, currentVolume);
      return GLib.SOURCE_REMOVE;
    });
  }

  function setVisualVolume(nextVolume: number, immediate = false): void {
    currentVolume = clampFloat(nextVolume);
    row.volume = clamp(currentVolume);
    updateLabel();
    drawing.queue_draw();
    sendVolume(immediate);
  }

  function volumeFromX(x: number): number {
    const allocation = drawing.get_allocation();
    return allocation.width > 0 ? (x / allocation.width) * maxVolume : currentVolume;
  }

  drawing.set_draw_func((_area, cr: any, width: number, height: number) => {
    const visibleVolume = row.muted ? 0 : currentVolume;
    const gap = 2;
    const segmentHeight = 8;
    const segmentY = Math.round((height - segmentHeight) / 2);
    const segmentWidth = Math.max(2, (width - gap * (meterSegments - 1)) / meterSegments);
    const accent = tokens.colors.accent.primary.value;

    for (let index = 0; index < meterSegments; index++) {
      const x = index * (segmentWidth + gap);
      const segmentStart = (index / meterSegments) * maxVolume;
      const segmentEnd = ((index + 1) / meterSegments) * maxVolume;
      const segmentRange = segmentEnd - segmentStart;
      const fillWidth = Math.max(0, Math.min(1, (visibleVolume - segmentStart) / segmentRange)) * segmentWidth;

      cr.setSourceRGBA(1, 1, 1, 0.08);
      roundedRect(cr, x, segmentY, segmentWidth, segmentHeight, 2);
      cr.fill();

      if (fillWidth > 0) {
        setSourceHex(cr, accent);
        roundedRect(cr, x, segmentY, fillWidth, segmentHeight, 2);
        cr.fill();
      }
    }

    const thumbX = Math.max(3, Math.min(width - 3, (visibleVolume / maxVolume) * width));
    cr.setSourceRGBA(0, 0, 0, 0.35);
    roundedRect(cr, thumbX - 3, 2, 6, height - 4, 3);
    cr.fill();
    cr.setSourceRGBA(1, 1, 1, row.muted ? 0.5 : 1);
    roundedRect(cr, thumbX - 2, 3, 4, height - 6, 2);
    cr.fill();
  });

  const clickController = new Gtk.GestureClick();
  clickController.set_button(0);
  clickController.connect("pressed", (_controller, _nPress, x) => {
    dragging = true;
    setVisualVolume(volumeFromX(x));
  });
  clickController.connect("released", (_controller, _nPress, x) => {
    setVisualVolume(volumeFromX(x), true);
    dragging = false;
  });
  drawing.add_controller(clickController);

  const motionController = new Gtk.EventControllerMotion();
  motionController.connect("motion", (_controller, x) => {
    if (!dragging) return;
    setVisualVolume(volumeFromX(x));
  });
  motionController.connect("leave", () => {
    if (!dragging) return;
    sendVolume(true);
    dragging = false;
  });
  drawing.add_controller(motionController);

  meterWrapper.append(drawing);
  return meterWrapper;
}

function makeRow(row: AudioRow): Gtk.Box {
  const card = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0 });
  card.add_css_class("audio-mixer-row");
  card.set_hexpand(true);
  card.set_halign(Gtk.Align.FILL);
  if (row.muted) card.add_css_class("muted");

  const header = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 10 });
  header.set_hexpand(true);
  header.set_halign(Gtk.Align.FILL);
  const iconBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL });
  iconBox.add_css_class("audio-mixer-row-icon");
  iconBox.set_halign(Gtk.Align.CENTER);
  iconBox.set_valign(Gtk.Align.START);
  iconBox.set_size_request(40, 40);
  iconBox.append(makeIconLabel(speakerIcon(row)));
  header.append(iconBox);

  const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0 });
  content.set_hexpand(true);
  content.set_halign(Gtk.Align.FILL);
  const titleRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6 });
  titleRow.set_hexpand(true);
  titleRow.set_halign(Gtk.Align.FILL);
  const title = makeLabel(row.name, "audio-mixer-row-title");
  title.set_hexpand(true);
  title.set_halign(Gtk.Align.START);
  title.set_xalign(0);
  title.set_width_chars(1);
  title.set_max_width_chars(42);
  title.set_ellipsize(3);
  titleRow.append(title);

  if (row.isDefault) titleRow.append(makeBadge("Default", "default"));
  if (row.muted) titleRow.append(makeBadge("Muted", "muted"));
  content.append(titleRow);

  const meter = makeMeter(row);
  if (meter) content.append(meter);
  header.append(content);

  const actions = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 4 });
  actions.set_halign(Gtk.Align.END);
  actions.set_valign(Gtk.Align.START);
  if (row.volume !== undefined || row.muted !== undefined) {
    const muteButton = new Gtk.Button({ label: row.muted ? "Unmute" : "Mute" });
    muteButton.add_css_class("audio-mixer-action");
    muteButton.set_cursor_from_name("pointer");
    muteButton.connect("clicked", () => audioBackend.toggleMute(row));
    actions.append(muteButton);
  }
  if (row.kind === "endpoint" && !row.isDefault) {
    const defaultButton = new Gtk.Button({ label: "Default" });
    defaultButton.add_css_class("audio-mixer-action");
    defaultButton.set_cursor_from_name("pointer");
    defaultButton.connect("clicked", () => audioBackend.setDefault(row));
    actions.append(defaultButton);
  }
  if (actions.get_first_child()) header.append(actions);

  card.append(header);
  return card;
}

function makeEmptyState(): Gtk.Box {
  const empty = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 8 });
  empty.add_css_class("audio-mixer-empty");
  empty.set_hexpand(true);
  empty.set_valign(Gtk.Align.CENTER);
  empty.set_halign(Gtk.Align.FILL);
  empty.append(makeIconLabel("\uE7F4"));
  const label = makeLabel(snapshot.status === "loading" ? "Loading audio" : snapshot.message || "No audio objects", "audio-mixer-empty-label");
  label.set_halign(Gtk.Align.CENTER);
  empty.append(label);
  return empty;
}

function renderRows(): void {
  if (!rowList) return;
  clearBox(rowList);
  const rows = snapshot.rows[activeTab] ?? [];
  if (rows.length === 0) {
    rowList.append(makeEmptyState());
    return;
  }
  for (const row of rows) {
    rowList.append(makeRow(row));
  }
}

function renderAudioMixer(): void {
  if (!mixerBox) return;
  if (!tabBar) buildShell();
  renderRows();
}

function buildShell(): void {
  if (!mixerBox) return;
  clearBox(mixerBox);

  const header = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 0 });
  header.add_css_class("audio-mixer-header");
  const nav = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 4 });
  nav.add_css_class("audio-mixer-tabs");
  nav.set_hexpand(true);
  tabBar = nav;
  header.append(nav);
  mixerBox.append(header);
  buildTabs();

  const body = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 8 });
  body.add_css_class("audio-mixer-body");
  rowList = body;
  mixerBox.append(body);
  renderRows();
}

function setTriggerMonitor(): void {
  if (!win) return;
  try {
    const display = Gdk.Display.get_default();
    const seat = display?.get_default_seat();
    const pointer = seat?.get_pointer() as unknown as { get_position?: () => [unknown, number, number] } | null;
    if (!display || !pointer?.get_position) return;
    const [, x, y] = pointer.get_position();
    const monitor = display.get_monitor_at_point(x, y);
    if (monitor) win.set_gdkmonitor(monitor);
  } catch (e) {
    console.error("Failed to resolve audio mixer trigger monitor:", e);
  }
}

function hideAudioMixer(): void {
  if (!win) return;
  win.set_visible(false);
  isVisible = false;
}

function showAudioMixer(): void {
  if (!win) createWindow();
  setTriggerMonitor();
  audioBackend.refresh();
  win?.set_visible(true);
  isVisible = true;

  try {
    GLib.spawn_command_line_async("pkill -SIGUSR1 waybar");
  } catch (e) {
    console.error("Failed to show waybar:", e);
  }
}

function toggleAudioMixer(): void {
  const now = GLib.get_monotonic_time() / 1000;
  if (now - lastToggleAtMs < 300) return;
  lastToggleAtMs = now;
  if (isVisible) hideAudioMixer();
  else showAudioMixer();
}

function handleOutsideClick(x: number, y: number): void {
  if (pointerStartedInsideMixer) {
    pointerStartedInsideMixer = false;
    return;
  }

  if (!isVisible || !mixerBox) return;
  const allocation = mixerBox.get_allocation();
  if (x < allocation.x || x > allocation.x + allocation.width || y < allocation.y || y > allocation.y + allocation.height) {
    hideAudioMixer();
  }
}

function stopInsideClickPropagation(widget: Gtk.Widget): void {
  const clickController = new Gtk.GestureClick();
  clickController.set_button(0);
  (clickController as any).set_propagation_phase?.(Gtk.PropagationPhase.CAPTURE);
  clickController.connect("pressed", () => {
    pointerStartedInsideMixer = true;
  });
  widget.add_controller(clickController);
}

function createWindow(): void {
  if (win) return;
  win = (
    <window
      name="audio-mixer-widget"
      namespace="ags-audio-mixer-widget"
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
      class="audio-mixer-widget"
      $={(self: Astal.Window) => {
        const keyController = new Gtk.EventControllerKey();
        keyController.connect("key-pressed", (_controller, keyval) => {
          if (keyval === Gdk.KEY_Escape) {
            hideAudioMixer();
            return true;
          }
          return false;
        });
        self.add_controller(keyController);

        const clickController = new Gtk.GestureClick();
        clickController.set_button(0);
        clickController.connect("released", (_controller, _nPress, x, y) => handleOutsideClick(x, y));
        self.add_controller(clickController);
      }}
    >
      <box orientation={Gtk.Orientation.VERTICAL} valign={Gtk.Align.END} halign={Gtk.Align.END}>
        <box
          orientation={Gtk.Orientation.VERTICAL}
          spacing={0}
          class="audio-mixer-container"
          $={(self: Gtk.Box) => {
            mixerBox = self;
            mixerBox.set_size_request(500, -1);
            stopInsideClickPropagation(self);
            buildShell();
          }}
        />
      </box>
    </window>
  ) as Astal.Window;
}

function applyStaticCSS(): void {
  app.apply_css(
    `
    window.audio-mixer-widget {
      background-color: transparent;
      border: none;
      padding: 0;
    }

    window.audio-mixer-widget box.audio-mixer-container {
      background-color: rgba(45, 45, 45, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 12px;
      min-width: 500px;
      max-width: 500px;
      padding: 0;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24), 0 2px 8px rgba(0, 0, 0, 0.12);
      margin-bottom: 53px;
      margin-right: 4px;
      color: ${tokens.colors.foreground.primary.value};
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
    }

    window.audio-mixer-widget box.audio-mixer-header {
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      padding: 12px;
    }

    window.audio-mixer-widget box.audio-mixer-tabs {
      background-color: rgba(32, 32, 32, 0.5);
      border-radius: 8px;
      padding: 4px;
    }

    window.audio-mixer-widget button.audio-mixer-tab {
      min-height: 30px;
      padding: 0 8px;
      border: none;
      border-radius: 6px;
      background-color: transparent;
      color: ${tokens.colors.foreground.secondary.value};
      font-size: 12px;
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
    }

    window.audio-mixer-widget button.audio-mixer-tab:hover,
    window.audio-mixer-widget button.audio-mixer-tab:focus {
      background-color: rgba(255, 255, 255, 0.1);
      color: ${tokens.colors.foreground.primary.value};
    }

    window.audio-mixer-widget button.audio-mixer-tab.active {
      background-color: ${tokens.colors.accent.primary.value};
      color: #ffffff;
    }

    window.audio-mixer-widget label.audio-mixer-icon-label {
      font-family: "Segoe Fluent Icons";
      font-size: 16px;
      color: inherit;
    }

    window.audio-mixer-widget label.audio-mixer-tab-label {
      font-size: 12px;
      color: inherit;
    }

    window.audio-mixer-widget box.audio-mixer-body {
      padding: 12px;
      min-height: 220px;
    }

    window.audio-mixer-widget box.audio-mixer-row {
      background-color: rgba(32, 32, 32, 0.45);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 8px;
    }

    window.audio-mixer-widget box.audio-mixer-row.muted {
      opacity: 0.72;
    }

    window.audio-mixer-widget box.audio-mixer-row-icon {
      background-color: rgba(255, 255, 255, 0.06);
      border-radius: 8px;
      min-width: 40px;
      max-width: 40px;
      min-height: 40px;
      max-height: 40px;
      padding: 0;
    }

    window.audio-mixer-widget box.audio-mixer-row-icon label.audio-mixer-icon-label {
      font-size: 18px;
    }

    window.audio-mixer-widget label.audio-mixer-row-title {
      color: ${tokens.colors.foreground.primary.value};
      font-size: 14px;
      font-weight: 600;
    }

    window.audio-mixer-widget label.audio-mixer-badge {
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 11px;
      border: 1px solid rgba(0, 103, 192, 0.4);
      background-color: rgba(0, 103, 192, 0.2);
      color: ${tokens.colors.foreground.primary.value};
    }

    window.audio-mixer-widget label.audio-mixer-badge.muted {
      border-color: rgba(196, 43, 28, 0.3);
      background-color: rgba(196, 43, 28, 0.1);
      color: ${tokens.colors.state.error.value};
    }

    window.audio-mixer-widget box.audio-mixer-meter-wrapper {
      margin-top: 12px;
    }

    window.audio-mixer-widget label.audio-mixer-volume-label {
      color: ${tokens.colors.foreground.tertiary.value};
      font-size: 11px;
    }

    window.audio-mixer-widget box.audio-mixer-meter {
      min-height: 8px;
    }

    window.audio-mixer-widget box.audio-mixer-meter-segment {
      min-height: 8px;
      border-radius: 2px;
    }

    window.audio-mixer-widget box.audio-mixer-meter-segment.filled {
      background-color: ${tokens.colors.accent.primary.value};
    }

    window.audio-mixer-widget box.audio-mixer-meter-segment.empty {
      background-color: rgba(255, 255, 255, 0.08);
    }

    window.audio-mixer-widget button.audio-mixer-action {
      min-height: 26px;
      padding: 0 8px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background-color: rgba(255, 255, 255, 0.06);
      color: ${tokens.colors.foreground.secondary.value};
      font-size: 11px;
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
    }

    window.audio-mixer-widget button.audio-mixer-action:hover,
    window.audio-mixer-widget button.audio-mixer-action:focus {
      background-color: rgba(255, 255, 255, 0.1);
      color: ${tokens.colors.foreground.primary.value};
    }

    window.audio-mixer-widget box.audio-mixer-empty {
      border: 1px dashed rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      background-color: rgba(32, 32, 32, 0.3);
      padding: 36px;
      min-height: 180px;
    }

    window.audio-mixer-widget box.audio-mixer-empty label.audio-mixer-icon-label {
      color: rgba(153, 153, 153, 0.6);
      font-size: 32px;
    }

    window.audio-mixer-widget label.audio-mixer-empty-label {
      color: ${tokens.colors.foreground.secondary.value};
      font-size: 14px;
      font-weight: 500;
    }
  `,
    false,
  );
}

function initAudioMixerWidget(): void {
  applyStaticCSS();
  audioBackend.init();
}

function handleAudioMixerWidgetRequest(argv: string[], res: (response: string) => void): void {
  const mark = perf.start("audio-mixer-widget", "handleRequest");
  let ok = true;
  let error: string | undefined;
  try {
    const request = argv.join(" ");
    if (!request || request.trim() === "") {
      res("ready");
      return;
    }

    let data: { action?: string; tab?: AudioMixerTab };
    try {
      data = JSON.parse(request);
    } catch (e) {
      console.error("Error parsing audio-mixer-widget request:", e);
      res("error: invalid JSON");
      return;
    }

    switch (data.action) {
      case "show":
        showAudioMixer();
        res("shown");
        return;
      case "hide":
        hideAudioMixer();
        res("hidden");
        return;
      case "toggle":
        toggleAudioMixer();
        res(isVisible ? "shown" : "hidden");
        return;
      case "is-visible":
        res(isVisible ? "true" : "false");
        return;
      case "set-tab":
        if (data.tab && tabs.some((tab) => tab.id === data.tab)) activateTab(data.tab);
        res("ok");
        return;
      default:
        res("unknown action");
        return;
    }
  } catch (e) {
    ok = false;
    error = String(e);
    console.error("Error handling audio-mixer-widget request:", e);
    res(`error: ${e}`);
  } finally {
    mark.end(ok, error);
  }
}

globalThis.AudioMixerWidget = {
  init: initAudioMixerWidget,
  handleRequest: handleAudioMixerWidgetRequest,
  instanceName: "audio-mixer-widget",
};
