import app from "ags/gtk4/app";
import { Astal } from "ags/gtk4";
import Gdk from "gi://Gdk?version=4.0";
import GdkPixbuf from "gi://GdkPixbuf?version=2.0";
import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import tokens from "../../../design-system/tokens.json";
import {
  createRecentItemsMenu,
  type RecentItemsMenuModel,
} from "./recent-items-menu";
import { getFallbackLetter } from "../services/app-icons";
import { bindGamingOpacity } from "../services/gaming-opacity";
import { perf } from "../services/performance-monitor";
import {
  clearRecentApplicationFocusHistory,
  getRecentApplications,
  launchRecentApplication,
  startRecentApplicationFocusHistory,
} from "../services/recent-applications";
import {
  clearRecentDocuments,
  getRecentDocuments,
  openRecentDocument,
} from "../services/recent-documents";
import type { RecentDocument } from "../services/recent-documents";
import { parseComponentRequest } from "../services/request";

// Configuration
const ENABLE_ANIMATIONS = false; // Set to false for better performance on slower systems

// Menu item interface - matching design system
interface MenuItem {
  id: string;
  label: string;
  icon: string;
  variant?: "default" | "warning" | "danger" | "purple";
}

// Flake update data interface
interface FlakeUpdate {
  name: string;
  currentRev: string;
  currentShort: string;
  newRev: string;
  newShort: string;
}

interface FlakeUpdatesData {
  count: number;
  updates: FlakeUpdate[];
  timestamp: string;
}

// Flatpak update data interface
interface FlatpakUpdate {
  app: string;
  currentVersion: string;
  newVersion: string;
  branch: string;
}

interface FlatpakUpdatesData {
  count: number;
  updates: FlatpakUpdate[];
  timestamp: string;
}

interface ProfileState {
  mode: "default" | "gaming" | "powersave";
  source: "none" | "manual" | "auto";
  gamingTotal: number;
  gamingManual: number;
  gamingWatchdog: number;
  gamingGamemode: number;
  powersaveTotal: number;
  powersaveManual: number;
}

// Default menu items - matching design system
const defaultMenuItems: MenuItem[] = [
  {
    id: "about-this-pc",
    label: "About This PC",
    icon: "\uE946",
    variant: "default",
  },
  {
    id: "system-settings",
    label: "System Settings",
    icon: "\uE713",
    variant: "default",
  },
  {
    id: "system-updates",
    label: "System Updates",
    icon: "\uE895",
    variant: "default",
  },
  { id: "divider-profile", label: "", icon: "", variant: "default" },
  { id: "profile-controls", label: "", icon: "", variant: "default" },
  { id: "divider-locations", label: "", icon: "", variant: "default" },
  {
    id: "applications",
    label: "Applications",
    icon: "\uE71D", // AllApps
    variant: "default",
  },
  {
    id: "documents",
    label: "Documents",
    icon: "\uE8A5", // Document
    variant: "default",
  },
  {
    id: "pictures",
    label: "Pictures",
    icon: "\uE91B", // Pictures
    variant: "default",
  },
  {
    id: "downloads",
    label: "Downloads",
    icon: "\uE896", // Download
    variant: "default",
  },
  {
    id: "recent-items",
    label: "Recent Items",
    icon: "\uE81C",
    variant: "default",
  },
  { id: "divider-force-quit", label: "", icon: "", variant: "default" },
  {
    id: "force-quit",
    label: "Force Quit",
    icon: "\uE7BA",
    variant: "default",
  },
  { id: "divider-session", label: "", icon: "", variant: "default" },
  {
    id: "suspend",
    label: "Suspend",
    icon: "\uE708", // QuietHours
    variant: "purple",
  },
  {
    id: "restart",
    label: "Restart",
    icon: "\uE777", // UpdateRestore
    variant: "warning",
  },
  {
    id: "shutdown",
    label: "Shutdown",
    icon: "\uE7E8", // PowerButton
    variant: "danger",
  },
  { id: "divider-account", label: "", icon: "", variant: "default" },
  {
    id: "lock-screen",
    label: "Lock Screen",
    icon: "\uE72E",
    variant: "default",
  },
  {
    id: "sign-out",
    label: "Log out",
    icon: "\uE8AB",
    variant: "warning",
  },
];

// Current state
let win: Astal.Window | null = null;
let menuBox: Gtk.Box | null = null;
let isVisible: boolean = false;
let flakeUpdatesCount: number = 0;
let flakeUpdatesData: FlakeUpdatesData | null = null;
let flatpakUpdatesCount: number = 0;
let flatpakUpdatesData: FlatpakUpdatesData | null = null;
let profileState: ProfileState = {
  mode: "default",
  source: "none",
  gamingTotal: 0,
  gamingManual: 0,
  gamingWatchdog: 0,
  gamingGamemode: 0,
  powersaveTotal: 0,
  powersaveManual: 0,
};
const menuItemButtons: Map<string, Gtk.Button> = new Map();
let profileControlsBox: Gtk.Box | null = null;
let profileAutoBadge: Gtk.Box | null = null;
let recentItemsHost: Gtk.Box | null = null;
let recentItemsVisible = false;
let recentDocuments: RecentDocument[] = [];

const updateCacheMaxAgeMs = 24 * 60 * 60 * 1000;
const recentItemsOpenDelayMs = 300;
const recentItemsCloseDelayMs = 200;
const recentItemsGap = 8;
const recentItemButtons: Gtk.Button[] = [];
let recentItemsOpenTimer: number | null = null;
let recentItemsCloseTimer: number | null = null;

function recentItemsModel(): RecentItemsMenuModel {
  return {
    applications: getRecentApplications().map((application) => ({
      id: application.desktopId,
      label: application.name,
      icon: application.icon,
      fallbackLetter: getFallbackLetter({ class: application.name }),
    })),
    documents: recentDocuments.map((document) => ({
      id: document.uri,
      label: document.name,
      detail: document.detail,
      icon: document.icon,
      fallbackLetter: getFallbackLetter({ class: document.name }),
    })),
  };
}

function clearChildren(container: Gtk.Box): void {
  let child = container.get_first_child();
  while (child) {
    container.remove(child);
    child = container.get_first_child();
  }
}

function clearRecentItemsOpenTimer(): void {
  if (recentItemsOpenTimer === null) return;
  GLib.source_remove(recentItemsOpenTimer);
  recentItemsOpenTimer = null;
}

function clearRecentItemsCloseTimer(): void {
  if (recentItemsCloseTimer === null) return;
  GLib.source_remove(recentItemsCloseTimer);
  recentItemsCloseTimer = null;
}

function clearRecentItemsTimers(): void {
  clearRecentItemsOpenTimer();
  clearRecentItemsCloseTimer();
}

function scheduleRecentItemsOpen(): void {
  clearRecentItemsCloseTimer();
  if (recentItemsVisible || recentItemsOpenTimer !== null) return;

  recentItemsOpenTimer = GLib.timeout_add(
    GLib.PRIORITY_DEFAULT,
    recentItemsOpenDelayMs,
    () => {
      recentItemsOpenTimer = null;
      showRecentItemsMenu();
      return GLib.SOURCE_REMOVE;
    },
  );
}

function scheduleRecentItemsClose(): void {
  clearRecentItemsOpenTimer();
  clearRecentItemsCloseTimer();
  recentItemsCloseTimer = GLib.timeout_add(
    GLib.PRIORITY_DEFAULT,
    recentItemsCloseDelayMs,
    () => {
      recentItemsCloseTimer = null;
      hideRecentItemsMenu();
      return GLib.SOURCE_REMOVE;
    },
  );
}

function hideRecentItemsMenu(): void {
  clearRecentItemsTimers();
  recentItemsVisible = false;
  recentItemsHost?.set_visible(false);
  recentItemButtons.length = 0;
  menuItemButtons.get("recent-items")?.remove_css_class("submenu-open");
}

function positionRecentItemsMenu(): void {
  if (!win || !recentItemsHost) return;

  const trigger = menuItemButtons.get("recent-items");
  if (!trigger) return;

  recentItemsHost.set_margin_start(0);
  recentItemsHost.set_margin_end(0);

  const [hasBounds, triggerBounds] = trigger.compute_bounds(win);
  if (!hasBounds) {
    recentItemsHost.set_halign(Gtk.Align.START);
    recentItemsHost.set_margin_start(trigger.get_width() + recentItemsGap);
    return;
  }

  const [, submenuWidth] = recentItemsHost.measure(
    Gtk.Orientation.HORIZONTAL,
    -1,
  );
  const workAreaWidth =
    win.get_width() || win.get_gdkmonitor().get_geometry().width;
  const triggerWidth = Math.ceil(triggerBounds.get_width());
  const triggerRight = Math.ceil(triggerBounds.get_x()) + triggerWidth;
  const opensRight =
    triggerRight + recentItemsGap + submenuWidth <= workAreaWidth;

  recentItemsHost.set_halign(opensRight ? Gtk.Align.START : Gtk.Align.END);
  if (opensRight) {
    recentItemsHost.set_margin_start(triggerWidth + recentItemsGap);
    return;
  }

  recentItemsHost.set_margin_end(triggerWidth + recentItemsGap);
}

function showRecentItemsMenu(): void {
  if (!recentItemsHost) return;

  clearRecentItemsTimers();
  recentItemButtons.length = 0;
  clearChildren(recentItemsHost);
  recentItemsHost.append(
    createRecentItemsMenu(recentItemsModel(), {
      onApplicationActivated: (item) => {
        launchRecentApplication(item.id);
        hideMenu();
      },
      onDocumentActivated: (item) => {
        openRecentDocument(item.id);
        hideMenu();
      },
      onClearRecentItems: () => {
        clearRecentApplicationFocusHistory();
        if (clearRecentDocuments()) recentDocuments = [];
        showRecentItemsMenu();
      },
      onButtonCreated: (button) => recentItemButtons.push(button),
    }),
  );
  positionRecentItemsMenu();
  recentItemsHost.set_visible(true);
  recentItemsVisible = true;
  menuItemButtons.get("recent-items")?.add_css_class("submenu-open");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFreshCacheTimestamp(timestamp: string): boolean {
  const checkedAt = Date.parse(timestamp);
  if (!Number.isFinite(checkedAt)) return false;

  const age = Date.now() - checkedAt;
  return age >= 0 && age <= updateCacheMaxAgeMs;
}

function isFlakeUpdate(value: unknown): value is FlakeUpdate {
  if (!isRecord(value)) return false;
  return ["name", "currentRev", "currentShort", "newRev", "newShort"].every(
    (key) => typeof value[key] === "string",
  );
}

function isFlatpakUpdate(value: unknown): value is FlatpakUpdate {
  if (!isRecord(value)) return false;
  return ["app", "currentVersion", "newVersion", "branch"].every(
    (key) => typeof value[key] === "string",
  );
}

function isUpdatesCache<T>(
  value: unknown,
  isUpdate: (update: unknown) => update is T,
): value is { count: number; updates: T[]; timestamp: string } {
  if (!isRecord(value)) return false;
  return (
    typeof value.count === "number" &&
    Number.isInteger(value.count) &&
    value.count >= 0 &&
    Array.isArray(value.updates) &&
    value.updates.every(isUpdate) &&
    typeof value.timestamp === "string" &&
    isFreshCacheTimestamp(value.timestamp)
  );
}

function readUpdatesCache<T>(
  filename: string,
  label: string,
  isUpdate: (update: unknown) => update is T,
): { count: number; updates: T[]; timestamp: string } | null {
  try {
    const cacheDir = GLib.get_user_cache_dir();
    const cachePath = `${cacheDir}/${filename}`;

    if (!GLib.file_test(cachePath, GLib.FileTest.EXISTS)) {
      return null;
    }

    const [success, contents] = GLib.file_get_contents(cachePath);
    if (!success || !contents) {
      return null;
    }

    const decoder = new TextDecoder("utf-8");
    const jsonStr = decoder.decode(contents);
    const parsed: unknown = JSON.parse(jsonStr);
    return isUpdatesCache(parsed, isUpdate) ? parsed : null;
  } catch (e) {
    console.error(`Error reading ${label} cache:`, e);
    return null;
  }
}

const readFlakeUpdatesCache = () =>
  readUpdatesCache("flake-updates.json", "flake updates", isFlakeUpdate);

const readFlatpakUpdatesCache = () =>
  readUpdatesCache(
    "flatpak-updates.json",
    "Flatpak updates",
    isFlatpakUpdate,
  );

// Format time difference for tooltip
function formatTimeSince(timestamp: string): string {
  try {
    const then = new Date(timestamp).getTime();
    const now = Date.now();
    const diffMs = now - then;

    const minutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      const remainingHours = hours % 24;
      if (remainingHours > 0) {
        return `${days} day${days !== 1 ? "s" : ""} and ${remainingHours} hour${remainingHours !== 1 ? "s" : ""} ago`;
      }
      return `${days} day${days !== 1 ? "s" : ""} ago`;
    } else if (hours > 0) {
      const remainingMinutes = minutes % 60;
      if (remainingMinutes > 0) {
        return `${hours} hour${hours !== 1 ? "s" : ""} and ${remainingMinutes} minute${remainingMinutes !== 1 ? "s" : ""} ago`;
      }
      return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
    } else if (minutes > 0) {
      return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
    } else {
      return "just now";
    }
  } catch (e) {
    console.error("Error formatting timestamp:", e);
    return "";
  }
}

// Menu item commands - matching design system actions
// Cache terminal lookup for performance
let cachedTerminal: string | null = null;
const getTerminal = (): string => {
  if (cachedTerminal) return cachedTerminal;

  // Check for preferred terminal in order: TERMINAL env var, then fallback to common terminals
  const terminal = GLib.getenv("TERMINAL");
  if (terminal) {
    cachedTerminal = terminal;
    return terminal;
  }

  // Check for common terminals
  const terminals = ["foot", "kitty", "wezterm", "alacritty", "gnome-terminal"];
  for (const term of terminals) {
    if (GLib.find_program_in_path(term)) {
      cachedTerminal = term;
      return term;
    }
  }

  cachedTerminal = "xterm"; // Ultimate fallback
  return cachedTerminal;
};

// Cache home directory for performance
const homeDir = GLib.get_home_dir();

const getXdgUserDir = (dirKey: string): string | null => {
  try {
    const configDir = GLib.getenv("XDG_CONFIG_HOME") || `${homeDir}/.config`;
    const configPath = `${configDir}/user-dirs.dirs`;

    if (!GLib.file_test(configPath, GLib.FileTest.EXISTS)) {
      return null;
    }

    const [success, contents] = GLib.file_get_contents(configPath);
    if (!success || !contents) {
      return null;
    }

    const decoder = new TextDecoder("utf-8");
    const configText = decoder.decode(contents);
    const match = configText.match(new RegExp(`^${dirKey}=\"?(.+?)\"?$`, "m"));
    if (!match) {
      return null;
    }

    return match[1].replace(/\$HOME/g, homeDir);
  } catch (e) {
    console.error(`Failed to read ${dirKey} from XDG user dirs:`, e);
    return null;
  }
};

const getXdgUserDirOrDefault = (dirKey: string, fallback: string): string =>
  getXdgUserDir(dirKey) || fallback;

const profileStateDir = `${GLib.getenv("XDG_RUNTIME_DIR") || "/tmp"}/hypr-profiles`;
const profilectlPath = `${homeDir}/.config/hypr/runtime/profiles/profilectl.sh`;

function readProfileCount(profile: string, source: string): number {
  try {
    const path = `${profileStateDir}/${profile}.${source}.count`;
    if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
      return 0;
    }

    const [success, contents] = GLib.file_get_contents(path);
    if (!success || !contents) {
      return 0;
    }

    const value = Number.parseInt(
      new TextDecoder("utf-8").decode(contents),
      10,
    );
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch (_e) {
    return 0;
  }
}

function readProfileTotal(profile: string): number {
  try {
    const dir = Gio.File.new_for_path(profileStateDir);
    const enumerator = dir.enumerate_children(
      "standard::name",
      Gio.FileQueryInfoFlags.NONE,
      null,
    );
    let total = 0;
    let fileInfo;
    while ((fileInfo = enumerator.next_file(null)) !== null) {
      const name = fileInfo.get_name();
      if (!name.startsWith(`${profile}.`) || !name.endsWith(".count")) {
        continue;
      }

      total += readProfileCount(
        profile,
        name.slice(profile.length + 1, -".count".length),
      );
    }
    return total;
  } catch (_e) {
    return 0;
  }
}

function readProfileState(): ProfileState {
  const gamingManual = readProfileCount("gaming", "manual");
  const gamingWatchdog = readProfileCount("gaming", "watchdog");
  const gamingGamemode = readProfileCount("gaming", "gamemode");
  const powersaveManual = readProfileCount("powersave", "manual");
  const gamingTotal = readProfileTotal("gaming");
  const powersaveTotal = readProfileTotal("powersave");

  if (gamingTotal > 0) {
    return {
      mode: "gaming",
      source: gamingManual > 0 ? "manual" : "auto",
      gamingTotal,
      gamingManual,
      gamingWatchdog,
      gamingGamemode,
      powersaveTotal,
      powersaveManual,
    };
  }

  if (powersaveTotal > 0) {
    return {
      mode: "powersave",
      source: powersaveManual > 0 ? "manual" : "auto",
      gamingTotal,
      gamingManual,
      gamingWatchdog,
      gamingGamemode,
      powersaveTotal,
      powersaveManual,
    };
  }

  return {
    mode: "default",
    source: "none",
    gamingTotal,
    gamingManual,
    gamingWatchdog,
    gamingGamemode,
    powersaveTotal,
    powersaveManual,
  };
}

function refreshProfileState() {
  profileState = readProfileState();
}

function refreshProfileControls() {
  refreshProfileState();

  const gamingActive = profileState.gamingManual > 0;
  const powersaveActive = profileState.powersaveManual > 0;
  const autoActive = !gamingActive && !powersaveActive;
  const activeStates: Record<string, boolean> = {
    "profile-auto": autoActive,
    "profile-gaming": gamingActive,
    "profile-powersave": powersaveActive,
  };

  for (const [id, active] of Object.entries(activeStates)) {
    const button = menuItemButtons.get(id);
    if (!button) continue;

    if (active) {
      button.add_css_class("profile-active");
    } else {
      button.remove_css_class("profile-active");
    }
  }

  const automaticGamingActive = autoActive && profileState.mode === "gaming";
  profileAutoBadge?.set_visible(automaticGamingActive);
  menuItemButtons
    .get("profile-auto")
    ?.set_tooltip_text(
      automaticGamingActive
        ? "Automatic profile rules; Game Mode is active"
        : "Use automatic profile rules",
    );
  profileControlsBox?.set_tooltip_text(profileTooltip());
}

let profileStateMonitor: Gio.FileMonitor | null = null;
let profileRefreshTimer: number | null = null;

function queueProfileRefresh() {
  if (profileRefreshTimer !== null) {
    GLib.source_remove(profileRefreshTimer);
  }

  profileRefreshTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 75, () => {
    profileRefreshTimer = null;
    refreshProfileControls();
    return GLib.SOURCE_REMOVE;
  });
}

function startProfileStateMonitor() {
  if (profileStateMonitor) return;

  try {
    GLib.mkdir_with_parents(profileStateDir, 0o700);
    const dir = Gio.File.new_for_path(profileStateDir);
    profileStateMonitor = dir.monitor_directory(
      Gio.FileMonitorFlags.NONE,
      null,
    );
    profileStateMonitor.connect("changed", (_monitor, file) => {
      const name = file.get_basename();
      if (name?.endsWith(".count")) {
        queueProfileRefresh();
      }
    });
  } catch (e) {
    console.error("Failed to monitor profile state:", e);
  }
}

function profileModeLabel(): string {
  if (profileState.mode === "gaming") return "Gaming";
  if (profileState.mode === "powersave") return "Saver";
  return "Balanced";
}

function profileSourceLabel(): string {
  if (profileState.source === "manual") return "Manual";
  return "Auto";
}

function profileTooltip(): string {
  return [
    `Profile: ${profileModeLabel()} · ${profileSourceLabel()}`,
    `Gaming: total=${profileState.gamingTotal} manual=${profileState.gamingManual} watchdog=${profileState.gamingWatchdog} gamemode=${profileState.gamingGamemode}`,
    `Powersave: total=${profileState.powersaveTotal} manual=${profileState.powersaveManual}`,
  ].join("\n");
}

function runProfileCommand(command: string) {
  try {
    GLib.spawn_command_line_async(command);
  } catch (e) {
    console.error("Failed to update profile:", e);
  }

  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
    refreshProfileControls();
    return GLib.SOURCE_REMOVE;
  });
}

// Build terminal command with correct flags based on terminal
const getSystemUpdatesCommand = (): string => {
  return `${homeDir}/.config/ags/scripts/flake-update-terminal.sh`;
};

const menuCommands: Record<string, string> = {
  "system-updates": getSystemUpdatesCommand(),
  "system-settings": (() => {
    const terminal = getTerminal();
    const nixosPath = `${homeDir}/nixos`;

    // Different terminals use different flags for command execution
    switch (terminal) {
      case "foot":
        return `${terminal} sh -c "cd ${nixosPath} && nvim"`;
      case "kitty":
        return `${terminal} sh -c "cd ${nixosPath} && nvim"`;
      case "alacritty":
        return `${terminal} -e sh -c "cd ${nixosPath} && nvim"`;
      case "wezterm":
        return `${terminal} start --cwd ${nixosPath} -- nvim`;
      case "gnome-terminal":
        return `${terminal} --working-directory=${nixosPath} -- nvim`;
      default:
        // Fallback for xterm and others
        return `${terminal} -e sh -c "cd ${nixosPath} && nvim"`;
    }
  })(),
  "lock-screen": "hyprlock",
  applications: "com.github.tchx84.Flatseal",
  documents: `nemo --existing-window "${getXdgUserDirOrDefault("XDG_DOCUMENTS_DIR", `${homeDir}/Documents`)}"`,
  pictures: `nemo --existing-window "${getXdgUserDirOrDefault("XDG_PICTURES_DIR", `${homeDir}/Pictures`)}"`,
  downloads: `nemo --existing-window "${getXdgUserDirOrDefault("XDG_DOWNLOAD_DIR", `${homeDir}/Downloads`)}"`,
  suspend: `${homeDir}/.config/hypr/runtime/session/confirm-suspend.sh`,
  "sign-out": `${homeDir}/.config/hypr/runtime/session/confirm-exit.sh`,
  restart: `${homeDir}/.config/hypr/runtime/session/confirm-restart.sh`,
  shutdown: `${homeDir}/.config/hypr/runtime/session/confirm-shutdown.sh`,
  "nixos-updates": getSystemUpdatesCommand(),
  "flatpak-updates": getSystemUpdatesCommand(), // Both updated during NixOS rebuild
};
const sessionActionIds = new Set([
  "lock-screen",
  "sign-out",
  "suspend",
  "restart",
  "shutdown",
]);

// Cache monitoring (fallback to polling if file monitor fails)
let cacheDirMonitor: Gio.FileMonitor | null = null;
let cacheRefreshTimer: number | null = null;

function startCacheRefreshTimer() {
  if (cacheRefreshTimer !== null) {
    GLib.source_remove(cacheRefreshTimer);
  }

  cacheRefreshTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300000, () => {
    refreshCacheData();
    return GLib.SOURCE_CONTINUE;
  });
}

function startCacheMonitor() {
  if (cacheDirMonitor) return;

  try {
    const cacheDir = GLib.get_user_cache_dir();
    const dir = Gio.File.new_for_path(cacheDir);
    cacheDirMonitor = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
    cacheDirMonitor.connect("changed", (_monitor, file) => {
      const name = file.get_basename();
      if (name === "flake-updates.json" || name === "flatpak-updates.json") {
        refreshCacheData();
      }
    });
  } catch (e) {
    console.error(
      "Failed to monitor cache directory, falling back to polling:",
      e,
    );
    startCacheRefreshTimer();
  }
}

function refreshCacheData(updateVisibleMenu = true) {
  const flakeCacheData = readFlakeUpdatesCache();
  const flatpakCacheData = readFlatpakUpdatesCache();

  flakeUpdatesCount = flakeCacheData?.count ?? 0;
  flakeUpdatesData = flakeUpdatesCount > 0 ? flakeCacheData : null;
  flatpakUpdatesCount = flatpakCacheData?.count ?? 0;
  flatpakUpdatesData = flatpakUpdatesCount > 0 ? flatpakCacheData : null;

  if (updateVisibleMenu && menuBox) {
    updateMenuItems();
  }
}

function hideMenu() {
  hideRecentItemsMenu();
  if (win) {
    win.set_visible(false);
    isVisible = false;
    // Clear any focused elements
    const focused = win.get_focus();
    if (focused) {
      win.set_focus(null);
    }
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
    if (monitor) win.set_gdkmonitor(monitor);
  } catch (e) {
    console.error("Failed to resolve Start Menu trigger monitor:", e);
  }
}

function showMenu() {
  const mark = perf.start("start-menu", "showMenu");
  let ok = true;
  let error: string | undefined;
  try {
    refreshCacheData(false);
    recentDocuments = getRecentDocuments();

    if (!win) {
      createWindow();
    } else {
      updateMenuItems();
    }

    if (win) {
      setTriggerMonitor();
      win.set_visible(true);
      isVisible = true;
      // Clear any existing focus to ensure clean state
      const currentFocus = win.get_focus();
      if (currentFocus) {
        win.set_focus(null);
      }
      // Also remove focus styling from all buttons
      for (const button of menuItemButtons.values()) {
        button.remove_css_class("focused");
        // Force style update
        button.get_style_context().remove_class("focused");
      }
      // Ensure Waybar stays visible while menu is open
      try {
        GLib.spawn_command_line_async("pkill -SIGUSR1 waybar");
      } catch (e) {
        console.error("Failed to show waybar:", e);
      }
    }
  } catch (e) {
    ok = false;
    error = String(e);
    throw e;
  } finally {
    mark.end(ok, error);
  }
}

// Generate tooltip text for updates menu item
function generateUpdatesTooltip(): string {
  const tooltipParts: string[] = [];

  if (flakeUpdatesCount > 0) {
    if (flakeUpdatesData && flakeUpdatesData.updates.length > 0) {
      const tooltipText = flakeUpdatesData.updates
        .map((u) => `• ${u.name}: ${u.currentShort} → ${u.newShort}`)
        .join("\n");
      const timeAgo = formatTimeSince(flakeUpdatesData.timestamp);
      const lastCheckedText = timeAgo ? ` (checked ${timeAgo})` : "";
      tooltipParts.push(`NixOS Updates${lastCheckedText}:\n${tooltipText}`);
    } else {
      tooltipParts.push(
        `${flakeUpdatesCount} NixOS update${flakeUpdatesCount !== 1 ? "s" : ""} available`,
      );
    }
  }

  if (flatpakUpdatesCount > 0) {
    if (flatpakUpdatesData && flatpakUpdatesData.updates.length > 0) {
      const tooltipText = flatpakUpdatesData.updates
        .map((u) => `• ${u.app}: ${u.currentVersion} → ${u.newVersion}`)
        .join("\n");
      const timeAgo = formatTimeSince(flatpakUpdatesData.timestamp);
      const lastCheckedText = timeAgo ? ` (checked ${timeAgo})` : "";
      tooltipParts.push(`Flatpak Updates${lastCheckedText}:\n${tooltipText}`);
    } else {
      tooltipParts.push(
        `${flatpakUpdatesCount} Flatpak update${flatpakUpdatesCount !== 1 ? "s" : ""} available`,
      );
    }
  }

  return tooltipParts.join("\n\n");
}

// Create update badges for the updates menu item
function createUpdateBadges(): JSX.Element[] {
  const badges: JSX.Element[] = [];

  // Add flake updates badge if applicable
  if (flakeUpdatesCount > 0) {
    badges.push(
      <box
        orientation={Gtk.Orientation.HORIZONTAL}
        halign={Gtk.Align.END}
        valign={Gtk.Align.CENTER}
        class="updates-badge"
      >
        <label
          label={`\uE843  ${flakeUpdatesCount.toString()}`}
          halign={Gtk.Align.CENTER}
          valign={Gtk.Align.CENTER}
        />
      </box>,
    );
  }

  // Add flatpak updates badge if applicable
  if (flatpakUpdatesCount > 0) {
    badges.push(
      <box
        orientation={Gtk.Orientation.HORIZONTAL}
        halign={Gtk.Align.END}
        valign={Gtk.Align.CENTER}
        class="updates-badge"
      >
        <label
          label={`\uF1B2  ${flatpakUpdatesCount.toString()}`}
          halign={Gtk.Align.CENTER}
          valign={Gtk.Align.CENTER}
        />
      </box>,
    );
  }

  return badges;
}

// Create a menu item button
function createMenuItem(item: MenuItem): Gtk.Widget {
  // Create badges if this is the updates item
  const badges = item.id === "system-updates" ? createUpdateBadges() : [];

  // Create menu item button using JSX
  const button = (
    <button
      canFocus={true}
      class={`menu-item menu-variant-${item.variant || "default"}`}
      onClicked={() => executeMenuCommand(item.id)}
      $={(self: Gtk.Button) => {
        self.set_cursor_from_name("pointer");
        menuItemButtons.set(item.id, self);

        if (item.id === "recent-items") {
          const motion = new Gtk.EventControllerMotion();
          motion.connect("enter", scheduleRecentItemsOpen);
          motion.connect("leave", scheduleRecentItemsClose);
          self.add_controller(motion);
        }

        // Set tooltip if this is the updates item
        if (item.id === "system-updates") {
          const tooltip = generateUpdatesTooltip();
          if (tooltip) {
            self.set_tooltip_text(tooltip);
          }
        }
      }}
    >
      <box
        orientation={Gtk.Orientation.HORIZONTAL}
        spacing={10}
        halign={Gtk.Align.FILL}
        class="menu-item-content"
      >
        <label label={item.icon} class="menu-item-icon" />
        <label
          label={item.label}
          halign={Gtk.Align.START}
          hexpand={true}
          class="menu-item-label"
        />
        {badges}
        {item.id === "recent-items" ? (
          <label label={"\uE76C"} class="menu-item-chevron" />
        ) : null}
      </box>
    </button>
  ) as Gtk.Button;

  if (item.id !== "recent-items") return button;

  return (
    <overlay>
      {button}
      <box
        $type="overlay"
        orientation={Gtk.Orientation.VERTICAL}
        halign={Gtk.Align.START}
        valign={Gtk.Align.END}
        visible={false}
        class="recent-items-host"
        $={(self: Gtk.Box) => {
          recentItemsHost = self;
          const motion = new Gtk.EventControllerMotion();
          motion.connect("enter", clearRecentItemsCloseTimer);
          motion.connect("leave", scheduleRecentItemsClose);
          self.add_controller(motion);
        }}
      />
    </overlay>
  ) as Gtk.Overlay;
}

// Create a menu divider
function createDivider(): Gtk.Separator {
  const separator = new Gtk.Separator({
    orientation: Gtk.Orientation.HORIZONTAL,
  });
  separator.add_css_class("menu-divider");
  return separator;
}

function createProfileToggle(
  id: string,
  icon: string,
  active: boolean,
  commandMode: "default" | "gaming" | "powersave",
  tooltip: string,
  badge?: string,
  badgeVisible = false,
): Gtk.Button {
  return (
    <button
      canFocus={true}
      class={`profile-toggle ${active ? "profile-active" : ""}`}
      onClicked={() =>
        runProfileCommand(`${profilectlPath} set-manual ${commandMode}`)
      }
      $={(self: Gtk.Button) => {
        self.set_cursor_from_name("pointer");
        self.set_tooltip_text(tooltip);
        menuItemButtons.set(id, self);
      }}
    >
      <overlay>
        <label
          label={icon}
          class={`profile-toggle-icon profile-${commandMode}-icon`}
        />
        {badge ? (
          <box
            $type="overlay"
            class="profile-auto-badge"
            halign={Gtk.Align.END}
            valign={Gtk.Align.END}
            widthRequest={14}
            heightRequest={14}
            visible={badgeVisible}
            $={(self: Gtk.Box) => {
              profileAutoBadge = self;
            }}
          >
            <label
              label={badge}
              class="profile-auto-badge-icon"
              halign={Gtk.Align.CENTER}
              valign={Gtk.Align.CENTER}
              hexpand={true}
              vexpand={true}
              xalign={0.5}
              yalign={0.5}
            />
          </box>
        ) : null}
      </overlay>
    </button>
  ) as Gtk.Button;
}

function createProfileControls(): Gtk.Box {
  const gamingActive = profileState.gamingManual > 0;
  const powersaveActive = profileState.powersaveManual > 0;
  const autoActive = !gamingActive && !powersaveActive;
  const automaticGamingActive = autoActive && profileState.mode === "gaming";

  const profileBox = (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={4} class="profile-row">
      <box
        orientation={Gtk.Orientation.HORIZONTAL}
        spacing={44}
        class="profile-actions"
      >
        {createProfileToggle(
          "profile-auto",
          "\uF8B0",
          autoActive,
          "default",
          automaticGamingActive
            ? "Automatic profile rules; Game Mode is active"
            : "Use automatic profile rules",
          "\u{F02B4}",
          automaticGamingActive,
        )}
        {createProfileToggle(
          "profile-gaming",
          "\u{F02B4}",
          gamingActive,
          "gaming",
          "Select manual Gaming profile",
        )}
        {createProfileToggle(
          "profile-powersave",
          "\uEA95",
          powersaveActive,
          "powersave",
          "Select manual Power Saver profile",
        )}
      </box>
      <box orientation={Gtk.Orientation.HORIZONTAL} class="profile-labels">
        <label label="Auto" widthRequest={40} />
        <box widthRequest={32} />
        <label label="Gaming" widthRequest={48} />
        <box widthRequest={32} />
        <label label="Saver" widthRequest={40} />
      </box>
    </box>
  ) as Gtk.Box;

  profileControlsBox = profileBox;
  profileBox.set_tooltip_text(profileTooltip());
  return profileBox;
}

// Create user profile header (non-interactive)
function createUserProfile(): Gtk.Box {
  const username = GLib.get_real_name() || GLib.get_user_name() || "User";
  const cacheDir = GLib.get_user_cache_dir();
  const avatarSize = 32;

  // Find the avatar file with pattern ags-avatar-*.png
  let avatarPath: string | null = null;
  try {
    const dir = Gio.File.new_for_path(cacheDir);
    const enumerator = dir.enumerate_children(
      "standard::name",
      Gio.FileQueryInfoFlags.NONE,
      null,
    );
    let fileInfo;
    while ((fileInfo = enumerator.next_file(null)) !== null) {
      const name = fileInfo.get_name();
      if (name.startsWith("ags-avatar-") && name.endsWith(".png")) {
        avatarPath = `${cacheDir}/${name}`;
        break;
      }
    }
  } catch (e) {
    console.error("Failed to find avatar:", e);
  }

  const profileBox = (
    <box
      orientation={Gtk.Orientation.HORIZONTAL}
      spacing={14}
      halign={Gtk.Align.FILL}
      class="user-profile"
    >
      <box
        class="user-avatar-image"
        $={(self: Gtk.Box) => {
          self.set_size_request(avatarSize, avatarSize);
          if (avatarPath && GLib.file_test(avatarPath, GLib.FileTest.EXISTS)) {
            const pixbuf = GdkPixbuf.Pixbuf.new_from_file(avatarPath);
            const image = Gtk.Image.new_from_pixbuf(pixbuf);
            image.set_size_request(avatarSize, avatarSize);
            image.set_pixel_size(avatarSize);
            self.append(image);
          }
        }}
      />
      <label
        label={username}
        halign={Gtk.Align.START}
        valign={Gtk.Align.CENTER}
        hexpand={true}
        class="user-name"
      />
    </box>
  ) as Gtk.Box;

  return profileBox;
}

function executeMenuCommand(itemId: string) {
  if (itemId === "recent-items") {
    showRecentItemsMenu();
    return;
  }

  if (itemId === "force-quit") {
    // Dismiss the menu before opening a competing exclusive surface.
    hideMenu();
    globalThis.ForceQuit?.show?.();
    return;
  }

  if (itemId === "about-this-pc") {
    hideMenu();
    globalThis.AboutThisPC?.show?.();
    return;
  }

  const command = menuCommands[itemId];
  if (!command) {
    console.error(`No command found for ${itemId}`);
    hideMenu();
    return;
  }

  const hidesBeforeDispatch = sessionActionIds.has(itemId);
  if (hidesBeforeDispatch) hideMenu();

  try {
    // Use sh -c to properly handle complex commands with pipes and arguments
    GLib.spawn_command_line_async(`sh -c '${command}'`);
  } catch (e) {
    console.error(`Failed to execute command for ${itemId}:`, e);
  }

  if (hidesBeforeDispatch === false) hideMenu();
}

function updateMenuItems() {
  const mark = perf.start("start-menu", "updateMenuItems");
  let ok = true;
  let error: string | undefined;
  try {
    if (!menuBox) return;
    hideRecentItemsMenu();
    refreshProfileState();
    // Type assertion to help TypeScript understand menuBox is non-null after guard
    const box = menuBox as Gtk.Box;
    // Clear existing items
    let child = box.get_first_child();
    while (child) {
      box.remove(child);
      child = box.get_first_child();
    }

    // Clear button references
    menuItemButtons.clear();
    profileControlsBox = null;
    profileAutoBadge = null;

    // Add user profile at the top
    box.append(createUserProfile());
    box.append(createDivider());

    // Add menu items
    defaultMenuItems.forEach((item) => {
      if (item.id.startsWith("divider")) {
        box.append(createDivider());
      } else if (item.id === "profile-controls") {
        box.append(createProfileControls());
      } else {
        box.append(createMenuItem(item));
      }
    });
  } catch (e) {
    ok = false;
    error = String(e);
    throw e;
  } finally {
    mark.end(ok, error);
  }
}

// Handle keyboard navigation in the menu
function handleKeyboardNavigation(keyval: number): boolean {
  const focusedWidget = win?.get_focus() ?? null;
  const recentItemIndex = recentItemButtons.findIndex(
    (button) => button === focusedWidget,
  );

  if (
    recentItemsVisible &&
    (keyval === Gdk.KEY_Escape || keyval === Gdk.KEY_Left)
  ) {
    hideRecentItemsMenu();
    menuItemButtons.get("recent-items")?.grab_focus();
    return true;
  }

  if (recentItemsVisible && recentItemIndex >= 0) {
    if (keyval === Gdk.KEY_Down || keyval === Gdk.KEY_Tab) {
      const nextIndex = (recentItemIndex + 1) % recentItemButtons.length;
      recentItemButtons[nextIndex]?.grab_focus();
      return true;
    }
    if (keyval === Gdk.KEY_Up || keyval === Gdk.KEY_ISO_Left_Tab) {
      const previousIndex =
        recentItemIndex === 0
          ? recentItemButtons.length - 1
          : recentItemIndex - 1;
      recentItemButtons[previousIndex]?.grab_focus();
      return true;
    }
    if (keyval === Gdk.KEY_Return || keyval === Gdk.KEY_space) {
      recentItemButtons[recentItemIndex]?.activate();
      return true;
    }
  }

  if (keyval === Gdk.KEY_Escape) {
    hideMenu();
    return true;
  }

  const focusableButtons = Array.from(menuItemButtons.values()).filter(
    (btn) => btn.can_focus,
  );

  if (focusableButtons.length === 0) return false;

  const currentFocus = focusableButtons.find((btn) => btn.has_focus);
  const currentIndex = currentFocus
    ? focusableButtons.indexOf(currentFocus)
    : -1;

  if (
    keyval === Gdk.KEY_Right &&
    currentFocus === menuItemButtons.get("recent-items")
  ) {
    showRecentItemsMenu();
    recentItemButtons[0]?.grab_focus();
    return true;
  }

  if (keyval === Gdk.KEY_Tab || keyval === Gdk.KEY_Down) {
    // Move to next item
    const nextIndex = (currentIndex + 1) % focusableButtons.length;
    focusableButtons[nextIndex].grab_focus();
    return true;
  } else if (keyval === Gdk.KEY_ISO_Left_Tab || keyval === Gdk.KEY_Up) {
    // Move to previous item (Shift+Tab or Up arrow)
    const prevIndex =
      currentIndex <= 0 ? focusableButtons.length - 1 : currentIndex - 1;
    focusableButtons[prevIndex].grab_focus();
    return true;
  } else if (keyval === Gdk.KEY_Return || keyval === Gdk.KEY_space) {
    // Activate current item
    if (currentFocus) {
      currentFocus.activate();
      return true;
    }
  }

  return false;
}

// Handle clicks outside the menu to close it
function handleOutsideClick(x: number, y: number): void {
  if (!isVisible || !win) return;

  const target = win.pick(x, y, Gtk.PickFlags.DEFAULT);
  if (
    menuBox &&
    (target === menuBox || target?.is_ancestor(menuBox) === true)
  ) {
    return;
  }
  if (
    recentItemsVisible &&
    recentItemsHost &&
    (target === recentItemsHost || target?.is_ancestor(recentItemsHost) === true)
  ) {
    return;
  }

  hideMenu();
}

function createWindow() {
  // Create window with JSX
  win = (
    <window
      name="start-menu"
      namespace="ags-start-menu"
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
      class="start-menu"
      $={(self: Astal.Window) => {
        bindGamingOpacity(self);
        // Add escape key handler and keyboard navigation
        const keyController = new Gtk.EventControllerKey();
        keyController.connect(
          "key-pressed",
          (_: Gtk.EventControllerKey, keyval: number) => {
            return handleKeyboardNavigation(keyval);
          },
        );
        self.add_controller(keyController);

        // Add click-anywhere handler - close menu on any click when visible
        // Use 'released' instead of 'pressed' to let button clicks process first
        const clickController = new Gtk.GestureClick();
        clickController.connect("released", (_controller, _n_press, x, y) => {
          handleOutsideClick(x, y);
        });
        self.add_controller(clickController);
      }}
    >
      <box
        orientation={Gtk.Orientation.VERTICAL}
        valign={Gtk.Align.END}
        halign={Gtk.Align.START}
      >
        <box
          orientation={Gtk.Orientation.VERTICAL}
          spacing={0}
          class="start-menu-container"
          $={(self: Gtk.Box) => {
            menuBox = self;
            // Initialize menu items
            updateMenuItems();
          }}
        />
      </box>
    </window>
  ) as Astal.Window;
}

// Apply static CSS once on module load
function applyStaticCSS() {
  const transitionStyle = ENABLE_ANIMATIONS
    ? "transition: all 150ms ease;"
    : "";

  app.apply_css(
    `
    /* Window container - fullscreen transparent to capture clicks */
    window.start-menu {
      background-color: transparent;
      border: none;
      padding: 0;
    }

    /* Menu container - matches design-system StartMenu component */
    window.start-menu box.start-menu-container {
      background-color: rgba(45, 45, 45, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.10);
      border-radius: 8px;
      padding: 8px;
      min-width: 270px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.28), 0 4px 12px rgba(0, 0, 0, 0.14);
      margin-bottom: 54px;
      margin-left: 5px;
    }

    /* User profile header */
    window.start-menu box.user-profile {
      padding: 8px 10px;
    }

    window.start-menu box.user-avatar-image {
      min-width: 32px;
      min-height: 32px;
    }
    
    window.start-menu box.user-avatar-image image {
      min-width: 32px;
      min-height: 32px;
      -gtk-icon-size: 32px;
    }

    window.start-menu label.user-name {
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      font-size: 16px;
      font-weight: 500;
      color: ${tokens.colors.foreground.primary.value};
    }

    window.start-menu box.profile-row {
      margin: 12px 39px;
    }

    window.start-menu box.profile-actions {
      padding: 4px;
      border-radius: 999px;
      background-color: ${tokens.colors.background.primary.value}80;
    }

    window.start-menu button.profile-toggle {
      min-width: 32px;
      min-height: 32px;
      padding: 0;
      border-radius: 999px;
      border: none;
      background-color: transparent;
      color: ${tokens.colors.foreground.secondary.value};
    }

    window.start-menu button.profile-toggle:hover {
      background-color: rgba(255, 255, 255, 0.10);
      color: ${tokens.colors.foreground.primary.value};
    }

    window.start-menu button.profile-toggle.profile-active {
      color: ${tokens.colors.foreground.primary.value};
      background-color: ${tokens.colors.accent.primary.value};
    }

    window.start-menu label.profile-toggle-icon {
      font-family: "Segoe Fluent Icons", "Segoe UI Symbol", sans-serif;
      font-size: 16px;
      color: inherit;
    }

    window.start-menu label.profile-gaming-icon,
    window.start-menu label.profile-auto-badge-icon {
      font-family: "Symbols Nerd Font";
    }

    window.start-menu box.profile-auto-badge {
      min-width: 14px;
      min-height: 14px;
      padding: 0;
      border: 2px solid ${tokens.colors.accent.primary.value};
      border-radius: 999px;
      background-color: ${tokens.colors.state.success.value};
    }

    window.start-menu label.profile-auto-badge-icon {
      padding: 0;
      color: ${tokens.colors.state["success-text"].value};
      font-size: 9px; 
    }

    window.start-menu box.profile-labels label {
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      font-size: 12px;
      font-weight: 500;
      color: ${tokens.colors.foreground.primary.value};
    }

    /* Menu item base */
    window.start-menu button.menu-item {
      padding: 0 10px;
      font-size: 14px;
      border-radius: 6px;
      min-height: 36px;
      ${transitionStyle}
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      border: none;
      background-color: transparent;
    }

    window.start-menu button.menu-item:hover {
      background-color: rgba(255, 255, 255, 0.1);
    }

    window.start-menu button.menu-item.submenu-open {
      background-color: ${tokens.colors.accent.primary.value};
      color: ${tokens.colors.foreground.primary.value};
    }

    window.start-menu button.menu-item:focus {
      outline: 2px solid rgba(255, 255, 255, 0.3);
      outline-offset: 2px;
    }

    window.start-menu button.menu-item:active {
      transform: scale(0.98);
    }

    /* Variant-specific styles */
    window.start-menu button.menu-variant-default {
      color: ${tokens.colors.foreground.primary.value};
    }
    window.start-menu button.menu-variant-default:hover {
      background-color: #ffffff1a;
    }
    window.start-menu button.menu-variant-default:focus {
      background-color: #ffffff1a;
    }

    window.start-menu button.menu-variant-warning {
      color: ${tokens.colors.foreground.primary.value};
    }
    window.start-menu button.menu-variant-warning:hover {
      color: ${tokens.colors.state.warning.value};
      background-color: ${tokens.colors.state.warning.value}1a;
    }
    window.start-menu button.menu-variant-warning:focus {
      color: ${tokens.colors.state.warning.value};
      background-color: ${tokens.colors.state.warning.value}1a;
    }

    window.start-menu button.menu-variant-danger {
      color: ${tokens.colors.foreground.primary.value};
    }
    window.start-menu button.menu-variant-danger:hover {
      color: ${tokens.colors.state.error.value};
      background-color: ${tokens.colors.state.error.value}1a;
    }
    window.start-menu button.menu-variant-danger:focus {
      color: ${tokens.colors.state.error.value};
      background-color: ${tokens.colors.state.error.value}1a;
    }

    window.start-menu button.menu-variant-purple {
      color: ${tokens.colors.foreground.primary.value};
    }
    window.start-menu button.menu-variant-purple:hover {
      color: ${tokens.colors.state.purple.value};
      background-color: ${tokens.colors.state.purple.value}1a;
    }
    window.start-menu button.menu-variant-purple:focus {
      color: ${tokens.colors.state.purple.value};
      background-color: ${tokens.colors.state.purple.value}1a;
    }

    /* Icon styling */
    window.start-menu label.menu-item-icon {
      font-family: "Segoe Fluent Icons", "Segoe UI Symbol", sans-serif;
      font-size: 12px;
      min-width: 16px;
    }

    window.start-menu label.menu-item-chevron {
      font-family: "Segoe Fluent Icons", "Segoe UI Symbol", sans-serif;
      font-size: 10px;
    }

    /* Label styling */
    window.start-menu label.menu-item-label {
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      font-size: 14px;
      color: inherit;
    }

    /* Update badges */
    window.start-menu box.updates-badge {
      background-color: ${tokens.colors.accent.primary.value};
      color: ${tokens.colors.foreground.primary.value};
      padding: 1px 4px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
      margin-left: 6px;
    }

    window.start-menu box.updates-badge label {
      font-family: "${tokens.typography.fontFamily.symbols.value}", "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      font-size: 11px;
      font-weight: 600;
      color: inherit;
      letter-spacing: 0.5px;
    }

    /* Menu dividers */
    window.start-menu separator.menu-divider {
      background-color: rgba(255, 255, 255, 0.1);
      min-height: 1px;
      margin: 6px 0;
    }

    window.start-menu box.recent-items-menu {
      min-width: 320px;
      padding: 8px;
      border: 1px solid rgba(255, 255, 255, 0.10);
      border-radius: 8px;
      background-color: rgba(45, 45, 45, 0.85);
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.28), 0 4px 12px rgba(0, 0, 0, 0.14);
    }

    window.start-menu label.recent-items-heading {
      padding: 6px 10px 4px;
      color: ${tokens.colors.foreground.secondary.value};
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
      font-size: 12px;
      font-weight: 600;
    }

    window.start-menu button.recent-item,
    window.start-menu button.recent-items-clear {
      min-height: 36px;
      padding: 0 10px;
      border: none;
      border-radius: 6px;
      background-color: transparent;
      color: ${tokens.colors.foreground.primary.value};
      font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
    }

    window.start-menu button.recent-item:hover,
    window.start-menu button.recent-items-clear:hover {
      background-color: rgba(255, 255, 255, 0.10);
    }

    window.start-menu button.recent-item:focus,
    window.start-menu button.recent-items-clear:focus {
      outline: 2px solid rgba(255, 255, 255, 0.3);
      outline-offset: -2px;
    }

    window.start-menu button.recent-item:active,
    window.start-menu button.recent-items-clear:active {
      background-color: rgba(255, 255, 255, 0.16);
    }

    window.start-menu button.recent-item:disabled,
    window.start-menu button.recent-items-clear:disabled {
      opacity: 0.72;
    }

    window.start-menu image.recent-item-icon,
    window.start-menu box.recent-item-fallback {
      min-width: 18px;
      min-height: 18px;
    }

    window.start-menu box.recent-item-fallback {
      border-radius: 4px;
      background-color: rgba(255, 255, 255, 0.10);
    }

    window.start-menu box.recent-item-fallback label {
      color: ${tokens.colors.foreground.primary.value};
      font-size: 11px;
      font-weight: 600;
    }

    window.start-menu label.recent-item-label {
      color: ${tokens.colors.foreground.primary.value};
      font-size: 14px;
    }

    window.start-menu label.recent-item-detail {
      color: ${tokens.colors.foreground.tertiary.value};
      font-size: 11px;
    }

    window.start-menu label.recent-items-empty {
      padding: 16px 10px;
      color: ${tokens.colors.foreground.tertiary.value};
      font-size: 14px;
    }

    window.start-menu box.recent-items-divider {
      min-height: 1px;
      margin: 6px 0;
      background-color: rgba(255, 255, 255, 0.1);
    }

    window.start-menu label.recent-items-clear-icon {
      font-family: "Segoe Fluent Icons", "Segoe UI Symbol", sans-serif;
      font-size: 12px;
    }
  `,
    false,
  );
}

// Functions for bundled mode (using global namespace pattern)
function initStartMenu() {
  applyStaticCSS();
  startRecentApplicationFocusHistory();
  // Generate circular avatar from .face file
  const scriptPath = `${GLib.get_home_dir()}/.config/ags/scripts/generate-circular-avatar.sh`;
  if (GLib.file_test(scriptPath, GLib.FileTest.EXISTS)) {
    try {
      GLib.spawn_command_line_async(scriptPath);
    } catch (e) {
      console.error("Failed to generate circular avatar:", e);
    }
  }

  // Window created lazily on first show (see showMenu line 393)
  startCacheMonitor();
  startProfileStateMonitor();
  refreshCacheData();
}

function handleStartMenuRequest(
  argv: string[],
  res: (response: string) => void,
) {
  const mark = perf.start("start-menu", "handleRequest");
  let ok = true;
  let error: string | undefined;
  try {
    const data = parseComponentRequest<{ action?: string }>(
      "start-menu",
      argv,
      res,
    );
    if (!data) return;

    if (data.action === "is-visible") {
      res(isVisible ? "true" : "false");
      return;
    }

    try {
      if (data.action === "show") {
        showMenu();
        res("shown");
        return;
      }

      if (data.action === "hide") {
        hideMenu();
        res("hidden");
        return;
      }

      if (data.action === "toggle") {
        if (isVisible) {
          hideMenu();
          res("hidden");
        } else {
          showMenu();
          res("shown");
        }
        return;
      }

      if (data.action === "refresh") {
        const reopenRecentItems = recentItemsVisible;
        refreshCacheData(false);
        recentDocuments = getRecentDocuments();
        if (menuBox) updateMenuItems();
        if (reopenRecentItems) showRecentItemsMenu();
        res("refreshed");
        return;
      }

      res("unknown action");
    } catch (e) {
      console.error("Error handling start-menu action:", e);
      res(`error: ${e}`);
    }
  } catch (e) {
    ok = false;
    error = String(e);
    console.error("Error in start-menu request handler:", e);
    res(`error: ${e}`);
  } finally {
    mark.end(ok, error);
  }
}

// Make component available globally
globalThis.StartMenu = {
  init: initStartMenu,
  handleRequest: handleStartMenuRequest,
  instanceName: "start-menu",
};
