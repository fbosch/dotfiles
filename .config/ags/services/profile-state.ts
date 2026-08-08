import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";

export type ProfileSelection = "auto" | "default" | "gaming" | "powersave";
export type ResolvedProfile = "default" | "gaming" | "powersave";

export interface ProfileState {
  generation: number;
  selection: ProfileSelection;
  resolved: ResolvedProfile;
  sources: {
    gaming: Record<string, number>;
    powersave: Record<string, number>;
  };
}

type ProfileStateListener = (state: ProfileState) => void;

const runtimeDir = GLib.getenv("XDG_RUNTIME_DIR") || GLib.get_tmp_dir();
const stateDir = `${runtimeDir}/hypr-profiles`;
const statePath = `${stateDir}/state.json`;
const stateMaxBytes = 65536;
const sourceName = /^[a-z][a-z0-9_-]*$/;
const maxInteger = 2147483647;
const listeners = new Set<ProfileStateListener>();

let state = readState();
let monitor: Gio.FileMonitor | null = null;
let refreshTimer: number | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= maxInteger
  );
}

function parseClaims(value: unknown): Record<string, number> | null {
  if (isRecord(value) === false) return null;

  const claims: Record<string, number> = {};
  for (const [source, count] of Object.entries(value)) {
    if (sourceName.test(source) === false || isInteger(count) === false) {
      return null;
    }
    claims[source] = count;
  }
  return claims;
}

function hasActiveClaim(claims: Record<string, number>): boolean {
  return Object.values(claims).some((count) => count > 0);
}

function expectedResolved(
  selection: ProfileSelection,
  sources: ProfileState["sources"],
): ResolvedProfile {
  if (selection !== "auto") return selection;
  if (hasActiveClaim(sources.gaming)) return "gaming";
  if (hasActiveClaim(sources.powersave)) return "powersave";
  return "default";
}

function parseState(contents: Uint8Array): ProfileState | null {
  if (contents.length > stateMaxBytes) return null;

  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8").decode(contents));
    if (isRecord(parsed) === false || hasExactKeys(parsed, ["generation", "selection", "resolved", "sources"]) === false) {
      return null;
    }

    if (isInteger(parsed.generation) === false) return null;
    if (
      parsed.selection !== "auto" &&
      parsed.selection !== "default" &&
      parsed.selection !== "gaming" &&
      parsed.selection !== "powersave"
    ) {
      return null;
    }
    if (
      parsed.resolved !== "default" &&
      parsed.resolved !== "gaming" &&
      parsed.resolved !== "powersave"
    ) {
      return null;
    }
    if (
      isRecord(parsed.sources) === false ||
      hasExactKeys(parsed.sources, ["gaming", "powersave"]) === false
    ) {
      return null;
    }

    const gaming = parseClaims(parsed.sources.gaming);
    const powersave = parseClaims(parsed.sources.powersave);
    if (gaming === null || powersave === null) return null;

    const snapshot: ProfileState = {
      generation: parsed.generation,
      selection: parsed.selection,
      resolved: parsed.resolved,
      sources: { gaming, powersave },
    };
    return snapshot.resolved === expectedResolved(snapshot.selection, snapshot.sources)
      ? snapshot
      : null;
  } catch {
    return null;
  }
}

function readState(): ProfileState | null {
  if (GLib.file_test(statePath, GLib.FileTest.EXISTS) === false) {
    return null;
  }

  try {
    const [success, contents] = GLib.file_get_contents(statePath);
    const snapshot = success && contents ? parseState(contents) : null;
    if (snapshot !== null) return snapshot;

    console.error("Ignoring invalid profile state");
  } catch (error) {
    console.error("Failed to read profile state:", error);
  }

  return null;
}

function refreshState(): void {
  const next = readState();
  if (next === null || next.generation <= (state?.generation ?? -1)) {
    return;
  }

  state = next;
  for (const listener of listeners) {
    listener(state);
  }
}

function queueRefresh(): void {
  if (refreshTimer !== null) {
    GLib.source_remove(refreshTimer);
  }

  refreshTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 75, () => {
    refreshTimer = null;
    refreshState();
    return GLib.SOURCE_REMOVE;
  });
}

function startMonitor(): void {
  if (monitor !== null) return;

  try {
    GLib.mkdir_with_parents(stateDir, 0o700);
    monitor = Gio.File.new_for_path(stateDir).monitor_directory(Gio.FileMonitorFlags.NONE, null);
    monitor.connect("changed", (_monitor, file) => {
      if (file.get_basename() === "state.json") {
        queueRefresh();
      }
    });
  } catch (error) {
    console.error("Failed to monitor profile state:", error);
  }
}

export function getProfileState(): ProfileState | null {
  return state;
}

export function isGamingResolved(snapshot: ProfileState | null): boolean {
  return snapshot?.resolved === "gaming";
}

export function hasAutomaticGamingClaim(snapshot: ProfileState | null): boolean {
  return snapshot !== null && snapshot.selection !== "gaming" && hasActiveClaim(snapshot.sources.gaming);
}

export function subscribeProfileState(listener: ProfileStateListener): () => void {
  listeners.add(listener);
  startMonitor();
  refreshState();
  return () => listeners.delete(listener);
}
