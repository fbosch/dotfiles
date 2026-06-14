import app from "ags/gtk4/app";
import { Astal } from "ags/gtk4";
import Gdk from "gi://Gdk?version=4.0";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import tokens from "../../../design-system/tokens.json";
import { fileExists, getFaugusIconForCandidates, getIconForClass, setImageFile, type IconRef } from "./app-icons";
import { perf } from "./performance-monitor";

type AudioMixerTab = "playback" | "output" | "input";
type BackendStatus = "loading" | "ready" | "unavailable" | "error";
type RowKind = "stream" | "endpoint" | "device";

interface AudioRow {
  id: string;
  name: string;
  icon: string;
  iconRef?: IconRef | null;
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

interface HyprlandClient {
  class?: string;
  initialClass?: string;
  title?: string;
  initialTitle?: string;
  pid?: number;
}

const tabs: Array<{ id: AudioMixerTab; label: string; icon: string }> = [
  { id: "playback", label: "Playback", icon: "\uE768" },
  { id: "output", label: "Output", icon: "\uE995" },
  { id: "input", label: "Input", icon: "\uE720" },
];

const maxVolume = 150;
const meterSegments = 12;
const hyprClientCacheTtlMs = 500;

let win: Astal.Window | null = null;
let mixerBox: Gtk.Box | null = null;
let tabBar: Gtk.Box | null = null;
let rowList: Gtk.Box | null = null;
let isVisible = false;
let lastToggleAtMs = 0;
let pointerStartedInsideMixer = false;
let activeTab: AudioMixerTab = "playback";
let tabButtons = new Map<AudioMixerTab, Gtk.Button>();
let rowCards: Gtk.Box[] = [];
let focusedRowIndex = 0;
let rowFocusVisible = false;
let snapshot: AudioSnapshot = emptySnapshot("Audio backend unavailable", "unavailable");
let iconTheme: Gtk.IconTheme | null = null;
let hyprClientCache: { timestampMs: number; clients: HyprlandClient[] } | null = null;
let wpctlStatusCache: { timestampMs: number; streams: Array<{ id: number; name: string }> } | null = null;
const wpctlInspectCache = new Map<number, { timestampMs: number; properties: Record<string, string> } | null>();

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
      const value = typeof getter === "function" ? getter.call(object) : object?.[key] ?? object?.get_property?.(key);
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
      const value = typeof getter === "function" ? getter.call(object) : object?.[key] ?? object?.get_property?.(key);
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
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
  const numericSerial = getNumber(object, ["serial", "id"]);
  if (numericSerial !== undefined) return String(Math.round(numericSerial));

  const serial = getText(object, ["serial", "id", "name", "description"]);
  return serial ?? fallback;
}

function sameAudioObject(a: any, b: any): boolean {
  if (!a || !b) return false;
  if (a === b) return true;

  const aId = objectId(a, "");
  const bId = objectId(b, "");
  return aId !== "" && aId === bId;
}

function displayName(object: any, fallback: string): string {
  return getText(object, ["description", "name", "nick", "media_name", "application_name"]) ?? fallback;
}

function parseWpctlInspect(id: number): Record<string, string> | null {
  const nowMs = GLib.get_monotonic_time() / 1000;
  const cached = wpctlInspectCache.get(id);
  if (cached && nowMs - cached.timestampMs < hyprClientCacheTtlMs) return cached.properties;

  const mark = perf.start("audio-mixer-widget", "wpctlInspect");
  let ok = true;
  let error: string | undefined;
  try {
    const [, stdout] = GLib.spawn_command_line_sync(`wpctl inspect ${id}`);
    if (!stdout) return null;

    const properties: Record<string, string> = {};
    const text = new TextDecoder().decode(stdout);
    for (const line of text.split("\n")) {
      const match = line.match(/^\s*\*?\s*([a-zA-Z0-9_.-]+)\s*=\s*"(.*)"\s*$/);
      if (match) properties[match[1]] = match[2];
    }

    wpctlInspectCache.set(id, { timestampMs: nowMs, properties });
    return properties;
  } catch (e) {
    ok = false;
    error = String(e);
    wpctlInspectCache.set(id, null);
    return null;
  } finally {
    mark.end(ok, error);
  }
}

function getWpctlStreams(): Array<{ id: number; name: string }> {
  const nowMs = GLib.get_monotonic_time() / 1000;
  if (wpctlStatusCache && nowMs - wpctlStatusCache.timestampMs < hyprClientCacheTtlMs) {
    return wpctlStatusCache.streams;
  }

  const mark = perf.start("audio-mixer-widget", "wpctlStatus");
  let ok = true;
  let error: string | undefined;
  try {
    const [, stdout] = GLib.spawn_command_line_sync("wpctl status");
    if (!stdout) return [];

    const streams: Array<{ id: number; name: string }> = [];
    let inStreams = false;
    for (const line of new TextDecoder().decode(stdout).split("\n")) {
      if (line.includes("Streams:")) {
        inStreams = true;
        continue;
      }

      if (inStreams && /^\S/.test(line)) break;

      const match = inStreams ? line.match(/^\s*(\d+)\.\s+([^<>\[]+?)\s*$/) : null;
      if (!match) continue;

      const id = Number(match[1]);
      const name = match[2].trim();
      if (Number.isFinite(id) && name) streams.push({ id, name });
    }

    wpctlStatusCache = { timestampMs: nowMs, streams };
    return streams;
  } catch (e) {
    ok = false;
    error = String(e);
    return wpctlStatusCache?.streams ?? [];
  } finally {
    mark.end(ok, error);
  }
}

function getPipeWirePropertiesForAudioObject(object: any): Record<string, string> | null {
  const idCandidates = ["id", "node_id", "bound_id"].map((key) => getNumber(object, [key]));
  for (const id of idCandidates) {
    if (id === undefined) continue;
    const properties = parseWpctlInspect(Math.round(id));
    if (properties) return properties;
  }

  const nameCandidates = [displayName(object, ""), getText(object, ["name", "node.name", "application.name"]) ?? ""];
  const normalizedNames = new Set(nameCandidates.map((name) => name.trim()).filter((name) => name !== ""));
  for (const stream of getWpctlStreams()) {
    if (!normalizedNames.has(stream.name)) continue;
    const properties = parseWpctlInspect(stream.id);
    if (properties) return properties;
  }

  return null;
}

function getPipeWireProcessId(object: any): number | undefined {
  const directPid = getNumber(object, ["application.process.id", "application_process_id", "process_id", "pid"]);
  if (directPid !== undefined) return Math.round(directPid);

  const pid = Number(getPipeWirePropertiesForAudioObject(object)?.["application.process.id"]);
  if (Number.isFinite(pid)) return Math.round(pid);

  return undefined;
}

function getHyprlandClients(): HyprlandClient[] {
  const nowMs = GLib.get_monotonic_time() / 1000;
  if (hyprClientCache && nowMs - hyprClientCache.timestampMs < hyprClientCacheTtlMs) {
    return hyprClientCache.clients;
  }

  const mark = perf.start("audio-mixer-widget", "hyprctlClients");
  let ok = true;
  let error: string | undefined;
  try {
    const [, stdout] = GLib.spawn_command_line_sync("hyprctl clients -j");
    if (!stdout) return [];
    const clients = JSON.parse(new TextDecoder().decode(stdout)) as HyprlandClient[];
    hyprClientCache = { timestampMs: nowMs, clients };
    return clients;
  } catch (e) {
    ok = false;
    error = String(e);
    console.error("Failed to read Hyprland clients for audio mixer:", e);
    return hyprClientCache?.clients ?? [];
  } finally {
    mark.end(ok, error);
  }
}

function getHyprClientForAudioObject(object: any): HyprlandClient | null {
  const pid = getPipeWireProcessId(object);
  if (pid === undefined) return null;
  return getHyprlandClients().find((client) => client.pid === pid) ?? null;
}

function windowTitleCandidates(client: HyprlandClient | null): string[] {
  if (!client) return [];
  return [client.title, client.initialTitle, client.class, client.initialClass].filter(
    (candidate): candidate is string => Boolean(candidate && candidate.trim() !== ""),
  );
}

function ensureIconTheme(): Gtk.IconTheme | null {
  if (iconTheme) return iconTheme;
  const display = Gdk.Display.get_default();
  iconTheme = display ? Gtk.IconTheme.get_for_display(display) : null;
  return iconTheme;
}

function getIconForAudioObject(object: any, client: HyprlandClient | null): IconRef | null {
  const mark = perf.start("audio-mixer-widget", "resolveAudioIcon");
  let ok = true;
  let error: string | undefined;
  try {
    const directIcon = getText(object, ["icon_name", "icon", "application_icon_name"]);
    const theme = ensureIconTheme();
    const pipeWireProperties = getPipeWirePropertiesForAudioObject(object);
    const candidates = Array.from(
      new Set(
        [
          ...windowTitleCandidates(client),
          pipeWireProperties?.["application.process.binary"],
          pipeWireProperties?.["application.name"],
          pipeWireProperties?.["node.name"],
          getText(object, ["application_id", "app_id", "application_process_binary", "binary"]),
          getText(object, ["application.process.binary"]),
          getText(object, ["application_name", "app_name", "name", "media_name", "description"]),
          pipeWireProperties?.["media.name"],
          getText(object, ["application.name", "media.name", "node.name"]),
        ].filter((candidate): candidate is string => candidate !== undefined),
      ),
    );

    const faugusIcon = getFaugusIconForCandidates(candidates);
    if (faugusIcon) return faugusIcon;

    for (const candidate of candidates) {
      const icon = getIconForClass(candidate, ensureIconTheme());
      if (icon) return icon;
    }

    if (directIcon && theme?.has_icon(directIcon)) return { kind: "theme", name: directIcon };
    if (directIcon && directIcon.startsWith("/") && fileExists(directIcon)) return { kind: "file", path: directIcon };

    return null;
  } catch (e) {
    ok = false;
    error = String(e);
    throw e;
  } finally {
    mark.end(ok, error);
  }
}

function getEndpointGlyphForAudioObject(object: any, icon: string): string {
  if (icon !== "\uE995") return icon;

  const name = displayName(object, "").toLowerCase();
  return name.includes("ora") || name.includes("kanto") ? "\uE7F5" : icon;
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
  widget.set_hexpand(true);
  widget.set_vexpand(true);
  widget.set_halign(Gtk.Align.CENTER);
  widget.set_valign(Gtk.Align.CENTER);
  widget.set_xalign(0.5);
  widget.set_yalign(0.5);
  return widget;
}

function makeTabIconLabel(label: string): Gtk.Label {
  const widget = makeLabel(label, "audio-mixer-icon-label");
  widget.add_css_class("audio-mixer-tab-icon");
  widget.set_size_request(18, 18);
  widget.set_halign(Gtk.Align.CENTER);
  widget.set_valign(Gtk.Align.CENTER);
  widget.set_xalign(0.5);
  widget.set_yalign(0.45);
  return widget;
}

function makeAudioIconWidget(row: AudioRow): Gtk.Widget {
  if (!row.iconRef) return makeIconLabel(speakerIcon(row));

  const image = row.iconRef.kind === "theme"
    ? Gtk.Image.new_from_icon_name(row.iconRef.name)
    : new Gtk.Image();
  image.set_pixel_size(24);
  image.set_halign(Gtk.Align.CENTER);
  image.set_valign(Gtk.Align.CENTER);
  image.set_hexpand(true);
  image.set_vexpand(true);
  image.add_css_class("audio-mixer-app-icon");

  if (row.iconRef.kind === "file") setImageFile(image, row.iconRef.path);

  return image;
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
    const client = kind === "stream" ? getHyprClientForAudioObject(object) : null;
    const clientTitle = client?.title?.trim();
    const displayIcon = kind === "endpoint" ? getEndpointGlyphForAudioObject(object, icon) : icon;
    return {
      id: `${kind}:${objectId(object, fallback)}`,
      name: kind === "stream" && clientTitle ? clientTitle : displayName(object, fallback),
      icon: displayIcon,
      iconRef: kind === "stream" ? getIconForAudioObject(object, client) : null,
      kind,
      object,
      volume: readVolume(object),
      muted: getBoolean(object, ["mute", "muted"]),
      isDefault,
    };
  }

  function buildSnapshot(): AudioSnapshot {
    const mark = perf.start("audio-mixer-widget", "buildSnapshot");
    let ok = true;
    let error: string | undefined;
    try {
      if (!audio) return emptySnapshot("AstalWP audio unavailable", "unavailable");

      const defaultSpeaker = audio.get_default_speaker?.() ?? audio.default_speaker;
      const defaultMicrophone = audio.get_default_microphone?.() ?? audio.default_microphone;
      const speakers = getList<any>(audio, ["speakers"]);
      const microphones = getList<any>(audio, ["microphones"]);
      const streams = getList<any>(audio, ["streams"]);

      const rows = emptyRows();
      rows.playback = streams.map((stream, index) => makeRow(stream, "stream", `Playback ${index + 1}`, "\uE768"));
      rows.output = speakers.map((speaker, index) => makeRow(speaker, "endpoint", `Output ${index + 1}`, "\uE995", sameAudioObject(speaker, defaultSpeaker)));
      rows.input = microphones.map((microphone, index) => makeRow(microphone, "endpoint", `Input ${index + 1}`, "\uE720", sameAudioObject(microphone, defaultMicrophone)));

      return { status: "ready", message: "", rows };
    } catch (e) {
      ok = false;
      error = String(e);
      throw e;
    } finally {
      mark.end(ok, error);
    }
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
      row.muted = muted;
      if (typeof row.object?.set_mute === "function") row.object.set_mute(muted);
      else if (typeof row.object?.set_muted === "function") row.object.set_muted(muted);
      else row.object.mute = muted;
    },
    setDefault(row: AudioRow) {
      const group = snapshot.rows.output.some((endpoint) => endpoint.id === row.id)
        ? snapshot.rows.output
        : snapshot.rows.input;
      for (const endpoint of group) endpoint.isDefault = endpoint.id === row.id;
      row.isDefault = true;
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
  focusedRowIndex = 0;
  rowFocusVisible = false;
  for (const [tabId, button] of tabButtons) {
    setCssClass(button, "active", tabId === activeTab);
  }
  renderRows();
}

function activateAdjacentTab(direction: 1 | -1): void {
  const currentIndex = tabs.findIndex((tab) => tab.id === activeTab);
  const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
  activateTab(tabs[nextIndex].id);
}

function focusRow(index: number, visible = rowFocusVisible): void {
  if (rowCards.length === 0) return;
  focusedRowIndex = Math.max(0, Math.min(rowCards.length - 1, index));
  rowFocusVisible = visible;
  rowCards.forEach((card, cardIndex) => setCssClass(card, "focused", visible && cardIndex === focusedRowIndex));
  rowCards[focusedRowIndex]?.grab_focus();
}

function activeRows(): AudioRow[] {
  return snapshot.rows[activeTab] ?? [];
}

function handleRowKeyboard(keyval: number, state: Gdk.ModifierType): boolean {
  const rows = activeRows();
  if (rows.length === 0) return false;

  if (keyval === Gdk.KEY_Up || keyval === Gdk.KEY_k || keyval === Gdk.KEY_K) {
    focusRow(focusedRowIndex - 1, true);
    return true;
  }
  if (keyval === Gdk.KEY_Down || keyval === Gdk.KEY_j || keyval === Gdk.KEY_J) {
    focusRow(focusedRowIndex + 1, true);
    return true;
  }

  const row = rows[focusedRowIndex];
  if (!row) return false;

  if (keyval === Gdk.KEY_Left || keyval === Gdk.KEY_Right || keyval === Gdk.KEY_h || keyval === Gdk.KEY_H || keyval === Gdk.KEY_l || keyval === Gdk.KEY_L) {
    const step = (state & Gdk.ModifierType.SHIFT_MASK) !== 0 ? 10 : 5;
    rowFocusVisible = true;
    const decrease = keyval === Gdk.KEY_Left || keyval === Gdk.KEY_h || keyval === Gdk.KEY_H;
    adjustRowVolume(row, decrease ? -step : step);
    focusRow(focusedRowIndex, true);
    return true;
  }
  if (keyval === Gdk.KEY_space) {
    toggleRowMute(row, focusedRowIndex, true);
    return true;
  }

  return false;
}

function adjustRowVolume(row: AudioRow, delta: number, shouldRender = true): void {
  if (row.volume === undefined) return;
  row.volume = clamp(row.volume + delta);
  audioBackend.setVolume(row, row.volume);
  if (shouldRender) renderRows();
}

function toggleRowMute(row: AudioRow, index: number, visible = rowFocusVisible): void {
  audioBackend.toggleMute(row);
  renderRows();
  focusRow(index, visible);
}

function handleRowScroll(index: number, deltaY: number, updateVolume: (delta: number) => void): boolean {
  if (deltaY === 0) return false;
  focusedRowIndex = index;
  rowFocusVisible = false;
  updateVolume(deltaY < 0 ? 5 : -5);
  return true;
}

function makeTabButton(tab: { id: AudioMixerTab; label: string; icon: string }): Gtk.Button {
  const button = new Gtk.Button();
  button.add_css_class("audio-mixer-tab");
  if (tab.id === activeTab) button.add_css_class("active");
  button.set_hexpand(true);
  button.set_cursor_from_name("pointer");
  button.connect("clicked", () => activateTab(tab.id));

  const label = makeLabel("", "audio-mixer-tab-label");
  label.set_use_markup(true);
  label.set_markup(`<span rise="-1800">${tab.icon}</span>  ${tab.label}`);
  label.set_size_request(112, 20);
  label.set_halign(Gtk.Align.CENTER);
  label.set_valign(Gtk.Align.CENTER);
  label.set_xalign(0.5);
  label.set_yalign(0.5);
  label.set_ellipsize(3);
  button.set_child(label);

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

function makeMeter(
  row: AudioRow,
  volumeLabel: Gtk.Label,
  registerScrollHandler?: (handler: (delta: number) => void) => void,
): Gtk.Box | null {
  if (row.volume === undefined) return null;
  let currentVolume = clampFloat(row.volume);
  let dragging = false;
  let throttleSource = 0;

  const meterWrapper = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 4 });
  meterWrapper.add_css_class("audio-mixer-meter-wrapper");
  meterWrapper.set_hexpand(true);
  meterWrapper.set_halign(Gtk.Align.FILL);

  const drawing = new Gtk.DrawingArea();
  drawing.add_css_class("audio-mixer-meter");
  drawing.set_hexpand(true);
  drawing.set_halign(Gtk.Align.FILL);
  drawing.set_size_request(-1, 20);
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

  registerScrollHandler?.((delta: number) => setVisualVolume(currentVolume + delta));

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
    const accent = row.muted ? tokens.colors.foreground.tertiary.value : tokens.colors.accent.primary.value;

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
    roundedRect(cr, thumbX - 3, 3, 6, height - 6, 3);
    cr.fill();
    cr.setSourceRGBA(1, 1, 1, row.muted ? 0.5 : 1);
    roundedRect(cr, thumbX - 2, 4, 4, height - 8, 2);
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

function makeRow(row: AudioRow, index: number): Gtk.Box {
  const card = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0 });
  card.add_css_class("audio-mixer-row");
  if (rowFocusVisible && index === focusedRowIndex) card.add_css_class("focused");
  card.set_hexpand(true);
  card.set_halign(Gtk.Align.FILL);
  card.set_focusable(true);
  if (row.muted) card.add_css_class("muted");

  const focusController = new Gtk.EventControllerFocus();
  focusController.connect("enter", () => {
    focusedRowIndex = index;
    rowCards.forEach((rowCard, cardIndex) => setCssClass(rowCard, "focused", rowFocusVisible && cardIndex === focusedRowIndex));
  });
  card.add_controller(focusController);

  const keyController = new Gtk.EventControllerKey();
  keyController.connect("key-pressed", (_controller, keyval, _keycode, state) => {
    focusedRowIndex = index;
    if (handleRowKeyboard(keyval, state)) return true;
    if (keyval === Gdk.KEY_Tab || keyval === Gdk.KEY_ISO_Left_Tab) {
      const backwards = keyval === Gdk.KEY_ISO_Left_Tab || (state & Gdk.ModifierType.SHIFT_MASK) !== 0;
      activateAdjacentTab(backwards ? -1 : 1);
      return true;
    }
    return false;
  });
  card.add_controller(keyController);

  const clickController = new Gtk.GestureClick();
  clickController.set_button(0);
  clickController.connect("pressed", () => {
    focusRow(index, false);
  });
  card.add_controller(clickController);

  let updateScrolledVolume: ((delta: number) => void) | null = null;
  if (row.volume !== undefined) {
    const scrollController = new Gtk.EventControllerScroll({ flags: Gtk.EventControllerScrollFlags.VERTICAL });
    scrollController.connect("scroll", (_controller, _deltaX, deltaY) => {
      if (!updateScrolledVolume) return false;
      return handleRowScroll(index, deltaY, updateScrolledVolume);
    });
    card.add_controller(scrollController);
  }

  const topRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 10 });
  topRow.set_hexpand(true);
  topRow.set_halign(Gtk.Align.FILL);
  const iconBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL });
  iconBox.add_css_class("audio-mixer-row-icon");
  if (row.isDefault) iconBox.add_css_class("default");
  if (row.muted) iconBox.add_css_class("muted");
  iconBox.set_halign(Gtk.Align.CENTER);
  iconBox.set_valign(Gtk.Align.START);
  iconBox.set_size_request(36, 36);
  iconBox.set_hexpand(false);
  iconBox.set_vexpand(false);
  iconBox.append(makeAudioIconWidget(row));
  topRow.append(iconBox);

  const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0 });
  content.set_hexpand(true);
  content.set_halign(Gtk.Align.FILL);
  content.set_size_request(0, -1);
  const titleRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6 });
  titleRow.set_hexpand(true);
  titleRow.set_halign(Gtk.Align.FILL);
  const title = makeLabel(row.name, "audio-mixer-row-title");
  title.set_hexpand(true);
  title.set_halign(Gtk.Align.START);
  title.set_xalign(0);
  title.set_width_chars(1);
  title.set_max_width_chars(32);
  title.set_ellipsize(3);
  titleRow.append(title);

  let volumeLabel: Gtk.Label | null = null;
  content.append(titleRow);
  if (row.volume !== undefined) {
    volumeLabel = makeLabel(row.muted ? "Muted" : `${clamp(row.volume)}%`, "audio-mixer-volume-label");
    volumeLabel.set_hexpand(true);
    volumeLabel.set_halign(Gtk.Align.START);
    volumeLabel.set_xalign(0);
    content.append(volumeLabel);
  }

  topRow.append(content);

  const actions = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 4 });
  actions.set_halign(Gtk.Align.END);
  actions.set_valign(Gtk.Align.START);
  if (row.volume !== undefined || row.muted !== undefined) {
    const muteButton = new Gtk.Button({ label: row.muted ? "\uE74F" : "\uE995" });
    muteButton.add_css_class("audio-mixer-action");
    muteButton.add_css_class("icon");
    muteButton.set_tooltip_text(row.muted ? "Unmute" : "Mute");
    muteButton.set_focusable(false);
    muteButton.set_cursor_from_name("pointer");
    muteButton.connect("clicked", () => {
      toggleRowMute(row, index);
    });
    actions.append(muteButton);
  }
  if (row.kind === "endpoint") {
    const defaultButton = new Gtk.Button({ label: "\uE8FB" });
    defaultButton.add_css_class("audio-mixer-action");
    defaultButton.add_css_class("icon");
    defaultButton.add_css_class("default-icon");
    if (row.isDefault) defaultButton.add_css_class("active");
    defaultButton.set_tooltip_text(row.isDefault ? "Default" : "Set default");
    defaultButton.set_focusable(false);
    defaultButton.set_cursor_from_name("pointer");
    defaultButton.connect("clicked", () => {
      audioBackend.setDefault(row);
      renderRows();
      focusRow(index, false);
    });
    actions.append(defaultButton);
  }
  if (actions.get_first_child()) topRow.append(actions);

  card.append(topRow);

  const meter = volumeLabel ? makeMeter(row, volumeLabel, (handler) => {
    updateScrolledVolume = handler;
  }) : null;
  if (meter) {
    const meterRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 10 });
    meterRow.set_hexpand(true);
    meterRow.set_halign(Gtk.Align.FILL);

    const meterIndent = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL });
    meterIndent.set_size_request(36, -1);
    meterIndent.set_hexpand(false);
    meterRow.append(meterIndent);
    meterRow.append(meter);
    card.append(meterRow);
  }

  return card;
}

function makeEmptyState(): Gtk.Box {
  const empty = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0 });
  empty.add_css_class("audio-mixer-empty");
  empty.set_hexpand(true);
  empty.set_vexpand(true);
  empty.set_halign(Gtk.Align.FILL);

  const topSpacer = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
  topSpacer.set_vexpand(true);
  empty.append(topSpacer);

  const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 8 });
  content.add_css_class("audio-mixer-empty-content");
  content.set_halign(Gtk.Align.CENTER);
  content.append(makeIconLabel("\uE7F4"));
  const label = makeLabel(snapshot.status === "loading" ? "Loading audio" : snapshot.message || "No audio objects", "audio-mixer-empty-label");
  label.set_halign(Gtk.Align.CENTER);
  content.append(label);
  empty.append(content);

  const bottomSpacer = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
  bottomSpacer.set_vexpand(true);
  empty.append(bottomSpacer);
  return empty;
}

function renderRows(): void {
  const mark = perf.start("audio-mixer-widget", "renderRows");
  let ok = true;
  let error: string | undefined;
  try {
    if (!rowList) return;
    clearBox(rowList);
    rowCards = [];
    const rows = snapshot.rows[activeTab] ?? [];
    if (rows.length === 0) {
      focusedRowIndex = 0;
      rowList.append(makeEmptyState());
      return;
    }
    focusedRowIndex = Math.max(0, Math.min(focusedRowIndex, rows.length - 1));
    rows.forEach((row, index) => {
      const card = makeRow(row, index);
      rowCards.push(card);
      rowList.append(card);
    });
    if (isVisible) {
      GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        focusRow(focusedRowIndex);
        return GLib.SOURCE_REMOVE;
      });
    }
  } catch (e) {
    ok = false;
    error = String(e);
    throw e;
  } finally {
    mark.end(ok, error);
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

  const body = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 8 });
  body.add_css_class("audio-mixer-body");
  body.set_size_request(500, -1);
  rowList = body;
  mixerBox.append(body);

  const footer = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 0 });
  footer.add_css_class("audio-mixer-footer");
  const nav = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 4, homogeneous: true });
  nav.add_css_class("audio-mixer-tabs");
  nav.set_hexpand(true);
  nav.set_size_request(476, -1);
  tabBar = nav;
  footer.append(nav);
  mixerBox.append(footer);
  buildTabs();
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
        keyController.connect("key-pressed", (_controller, keyval, _keycode, state) => {
          if (keyval === Gdk.KEY_Escape) {
            hideAudioMixer();
            return true;
          }
          if (keyval === Gdk.KEY_Tab || keyval === Gdk.KEY_ISO_Left_Tab) {
            const backwards = keyval === Gdk.KEY_ISO_Left_Tab || (state & Gdk.ModifierType.SHIFT_MASK) !== 0;
            activateAdjacentTab(backwards ? -1 : 1);
            return true;
          }
          if (handleRowKeyboard(keyval, state)) return true;
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

    window.audio-mixer-widget box.audio-mixer-footer {
      border-top: 1px solid rgba(255, 255, 255, 0.1);
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
      font-family: "SF Pro Text", "Segoe Fluent Icons", system-ui, sans-serif;
      font-size: 12px;
      color: inherit;
    }

    window.audio-mixer-widget box.audio-mixer-body {
      padding: 8px 12px 6px;
      min-height: 70px;
    }

    window.audio-mixer-widget box.audio-mixer-row {
      background-color: rgba(32, 32, 32, 0.45);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      padding: 8px 10px;
      margin-bottom: 2px;
    }

    window.audio-mixer-widget box.audio-mixer-row:hover {
      border-color: rgba(255, 255, 255, 0.16);
      background-color: rgba(42, 42, 42, 0.62);
    }

    window.audio-mixer-widget box.audio-mixer-row.muted {
      opacity: 0.72;
    }

    window.audio-mixer-widget box.audio-mixer-row.focused {
      border-color: rgba(0, 103, 192, 0.65);
      background-color: rgba(32, 32, 32, 0.62);
    }

    window.audio-mixer-widget box.audio-mixer-row-icon {
      background-color: rgba(255, 255, 255, 0.06);
      border-radius: 8px;
      min-width: 36px;
      max-width: 36px;
      min-height: 36px;
      max-height: 36px;
      padding: 0;
    }

    window.audio-mixer-widget box.audio-mixer-row-icon.default {
      background-color: rgba(0, 103, 192, 0.25);
      color: #ffffff;
    }

    window.audio-mixer-widget box.audio-mixer-row-icon.muted {
      background-color: rgba(196, 43, 28, 0.12);
      color: ${tokens.colors.state.error.value};
    }

    window.audio-mixer-widget box.audio-mixer-row-icon label.audio-mixer-icon-label {
      font-size: 17px;
    }

    window.audio-mixer-widget image.audio-mixer-app-icon {
      -gtk-icon-size: 24px;
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
      margin-top: 2px;
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
      min-height: 24px;
      padding: 0 8px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background-color: rgba(255, 255, 255, 0.06);
      color: ${tokens.colors.foreground.secondary.value};
      font-size: 11px;
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
    }

    window.audio-mixer-widget button.audio-mixer-action.icon {
      min-width: 28px;
      min-height: 28px;
      padding: 0;
      font-size: 15px;
    }

    window.audio-mixer-widget button.audio-mixer-action.icon label {
      font-family: "Segoe Fluent Icons";
      font-size: 15px;
    }

    window.audio-mixer-widget button.audio-mixer-action.default-icon.active {
      color: #ffffff;
      border-color: rgba(0, 103, 192, 0.55);
      background-color: ${tokens.colors.accent.primary.value};
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
      padding: 0;
      min-height: 180px;
    }

    window.audio-mixer-widget box.audio-mixer-empty-content {
      padding: 36px;
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
