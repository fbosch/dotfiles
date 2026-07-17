import app from "ags/gtk4/app";
import { Astal } from "ags/gtk4";
import Gdk from "gi://Gdk?version=4.0";
import GdkPixbuf from "gi://GdkPixbuf?version=2.0";
import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import tokens from "../../../design-system/tokens.json";
import { execAsync } from "ags/process";
import { getFallbackLetter, getIconForWindow, setImageFile } from "./app-icons";
import { queryHyprlandJson } from "./hyprland-ipc";
import { perf } from "./performance-monitor";

/**
 * Performance Optimizations:
 * 1. Icon caching - Desktop file lookups are cached to avoid repeated I/O
 * 2. Smart UI updates - Only rebuild UI when window list changes; otherwise just update CSS classes
 * 3. Window list caching - During switcher session, reuse window list instead of re-fetching
 * 4. Event-driven modifier monitoring - Uses GDK key events when the switcher has key focus
 *
 * State Machine:
 * - IDLE: Switcher hidden, waiting for a switcher keybind
 * - ACTIVE: Switcher visible, cycling through windows, waiting for trigger modifier release
 *
 * Transitions:
 * - IDLE + (next/prev with >1 windows) -> ACTIVE
 * - ACTIVE + next/prev -> ACTIVE (cycles selection)
 * - ACTIVE + trigger modifier release -> IDLE (commits and hides)
 * - ACTIVE + hide -> IDLE (just hides)
 */

// State machine
enum SwitcherState {
  IDLE = "IDLE",
  ACTIVE = "ACTIVE",
}

// Display mode
enum DisplayMode {
  ICONS = "ICONS",
  PREVIEWS = "PREVIEWS",
}

// Sort mode
enum SortMode {
  ALPHABETICAL = "ALPHABETICAL",
  RECENCY = "RECENCY",
}

// Hyprland client interface
interface HyprlandClient {
  address: string;
  stableId?: string;
  class: string;
  initialClass?: string;
  title: string;
  initialTitle?: string;
  focused?: boolean;
  workspace: {
    id: number;
    name: string;
  };
  at?: [number, number];
  size?: [number, number];
}

// Window info for display
interface WindowInfo {
  address: string;
  stableId?: string;
  class: string;
  initialClass?: string;
  title: string;
  initialTitle?: string;
  workspace: string;
  size?: {
    width: number;
    height: number;
  };
  position?: {
    x: number;
    y: number;
  };
}

// Configuration
const ICON_SIZE = 64;
const PREVIEW_HEIGHT = 180; // Target height for previews
const PREVIEW_MAX_WIDTH = 320; // Maximum width for very wide windows
const PREVIEW_MIN_WIDTH = 30; // Minimum width for very narrow windows
const SWITCHER_PADDING = 24; // Padding inside switcher container
const SWITCHER_MARGIN = 48; // Margin from screen edges (total for both sides)
const MONITOR_EDGE_MARGIN = 30; // Additional margin from monitor edges (per side)
const BUTTON_SPACING = 8; // Spacing between buttons
const BUTTON_PADDING = 8; // Padding inside each button
const WINDOW_CACHE_TTL_MS = 150; // Cache window list briefly for request bursts
const ACTIVE_WINDOW_CACHE_TTL_MS = 100; // Cache active window briefly
const RUNTIME_DIR = GLib.getenv("XDG_RUNTIME_DIR") || GLib.get_tmp_dir();
const PERFORMANCE_OVERLAY_STATE_DIR = `${RUNTIME_DIR}/hypr-profiles`;
const PROFILE_MODE_PATH = `${PERFORMANCE_OVERLAY_STATE_DIR}/profile-overlay.mode`;
const MONITOR_DEBUG_PATH = `${RUNTIME_DIR}/monitor-debug.log`;
const WINDOW_SWITCHER_DEBUG_PATH = `${RUNTIME_DIR}/ags-window-switcher-debug.log`;
const TOGGLE_MINIMIZED_WORKSPACE_SCRIPT = "~/.config/hypr/runtime/windows/toggle-minimized-workspace.sh";
const WARP_CURSOR_TO_ACTIVE_WINDOW_SCRIPT = "lua ~/.config/hypr/runtime/windows/warp-cursor-to-active-window.lua";
const DEBUG = GLib.getenv("AGS_WINDOW_SWITCHER_DEBUG") === "1";

function isGamingProfileActive(): boolean {
  try {
    const [success, contents] = GLib.file_get_contents(PROFILE_MODE_PATH);
    return success && new TextDecoder("utf-8").decode(contents).trim() === "gaming";
  } catch {
    return false;
  }
}

function debugLog(message: string): void {
  if (DEBUG) {
    console.log(message);
  }
}

function debugWriteFile(path: string, contents: string): void {
  if (!DEBUG) return;
  try {
    GLib.file_set_contents(path, contents);
  } catch (e) {
    console.error(`Failed to write debug file ${path}:`, e);
  }
}

// State
let state: SwitcherState = SwitcherState.IDLE;

// Check if performance mode is active on startup
let displayMode: DisplayMode = DisplayMode.PREVIEWS;
let sortMode: SortMode = SortMode.RECENCY; // Default to recency like Windows 11
try {
  const perfModeFile = Gio.File.new_for_path(PERFORMANCE_MODE_PATH);
  if (perfModeFile.query_exists(null)) {
    displayMode = DisplayMode.ICONS;
    debugLog("Performance mode detected, starting in ICONS mode");
  }
} catch (e) {
  // Ignore errors, default to PREVIEWS
}

let win: Astal.Window | null = null;
let containerBox: Gtk.Box | null = null;
let appsRowBox: Gtk.Box | null = null; // Reference to apps-row for wrapping
let selectedNameLabel: Gtk.Label | null = null;
let isVisible = false; // Derived from state, kept for GTK
let windowButtons: Map<string, Gtk.Button> = new Map();
let currentWindows: WindowInfo[] = [];
let currentIndex = 0;
let activeTriggerModifier = "ALT";
let triggerModifierWatchId: number | null = null;

// Icon theme reference (initialized in createWindow)
let iconTheme: Gtk.IconTheme | null = null;

type PreviewCacheEntry = {
  mtime: number;
  width: number;
  height: number;
  texture?: Gdk.Texture;
};

const previewCache = new Map<string, PreviewCacheEntry>();
let previewCacheMonitor: Gio.FileMonitor | null = null;

// Persistent focus history for recency-based sorting
// Most recently focused window is at index 0
let focusHistory: string[] = [];
let focusHistoryVersion = 0;

type WindowCacheEntry = {
  timestampMs: number;
  windows: WindowInfo[];
  sortMode: SortMode;
  focusVersion: number;
};

let windowCache: WindowCacheEntry | null = null;

type ActiveWindowCacheEntry = {
  timestampMs: number;
  address: string | null;
};

let activeWindowCache: ActiveWindowCacheEntry | null = null;

// Get current monitor width
function getMonitorWidth(): number {
  try {
    const display = Gdk.Display.get_default();
    if (!display) {
      debugWriteFile(MONITOR_DEBUG_PATH, "No display found\n");
      return 1920; // Fallback
    }
    
    // Get the monitor containing the mouse pointer
    const seat = display.get_default_seat();
    if (!seat) {
      debugWriteFile(MONITOR_DEBUG_PATH, "No seat found\n");
      return 1920;
    }
    
    const pointer = seat.get_pointer() as unknown as { get_position?: () => [unknown, number, number] } | null;
    if (!pointer?.get_position) {
      debugWriteFile(MONITOR_DEBUG_PATH, "No pointer found\n");
      return 1920;
    }
    
    const [, x, y] = pointer.get_position();
    const monitor = display.get_monitor_at_point(x, y);
    
    if (!monitor) {
      debugWriteFile(
        MONITOR_DEBUG_PATH,
        `No monitor at point ${x},${y}\n`,
      );
      return 1920;
    }
    
    const geometry = monitor.get_geometry();
    const model = monitor.get_model() || "unknown";
    const scaleFactor = monitor.get_scale_factor();
    
    const debugInfo = `Monitor: ${model}
Geometry width: ${geometry.width}
Geometry height: ${geometry.height}
Scale factor: ${scaleFactor}
Physical width: ${geometry.width * scaleFactor}
Mouse position: ${x},${y}
`;
    debugWriteFile(MONITOR_DEBUG_PATH, debugInfo);
    
    return geometry.width;
  } catch (e) {
    debugWriteFile(MONITOR_DEBUG_PATH, `Error: ${e}\n`);
    console.error("Failed to get monitor width:", e);
    return 1920; // Fallback to common resolution
  }
}

// Calculate button width based on display mode and window info
// IMPORTANT: This must match the actual button size created in createAppButton
function calculateButtonWidth(window: WindowInfo): number {
  if (displayMode === DisplayMode.ICONS) {
    // Icon mode: button padding (8*2) + border (2*2) + icon size (64) + GTK overhead (12)
    return ICON_SIZE + (BUTTON_PADDING * 2) + 4 + 12;
  } else {
    // Preview mode: calculate from preview dimensions
    const previewPath = captureWindowPreview(window);
    const dimensions = calculatePreviewDimensions(previewPath);
    // Button width = preview content width + button padding + border + GTK layout overhead
    // Preview content includes: preview-header padding (12*2) already in dimensions.width
    // Add extra 48px for GTK's internal layout, focus rings, margins, and box model discrepancies
    return dimensions.width + (BUTTON_PADDING * 2) + 4 + 48;
  }
}

// Directory for window preview screenshots (managed by window-capture-daemon.sh)
// Uses /dev/shm (tmpfs) for faster I/O, falls back to /tmp if unavailable
const PREVIEW_CACHE_DIR = GLib.file_test("/dev/shm", GLib.FileTest.IS_DIR)
  ? "/dev/shm/hypr-window-captures"
  : `${GLib.get_tmp_dir()}/hypr-window-captures`;

function previewMtime(fileInfo: Gio.FileInfo): number {
  const modified = fileInfo.get_modification_time();
  return modified.tv_sec * 1_000_000 + modified.tv_usec;
}

function ensurePreviewCacheMonitor() {
  if (previewCacheMonitor || !GLib.file_test(PREVIEW_CACHE_DIR, GLib.FileTest.IS_DIR)) {
    return;
  }

  const directory = Gio.File.new_for_path(PREVIEW_CACHE_DIR);
  previewCacheMonitor = directory.monitor_directory(Gio.FileMonitorFlags.NONE, null);
  previewCacheMonitor.connect("changed", (_monitor, file, otherFile) => {
    const previewPaths = [file.get_path(), otherFile?.get_path()];
    const previewChanged = previewPaths.some(
      (path) => path?.startsWith(`${PREVIEW_CACHE_DIR}/`) && path.endsWith(".jpg"),
    );
    if (!previewChanged) {
      return;
    }

    for (const path of previewPaths) {
      if (path) {
        previewCache.delete(path);
      }
    }

    if (state === SwitcherState.ACTIVE && displayMode === DisplayMode.PREVIEWS) {
      updateSwitcher();
    }
  });
}

// Get window preview path if it exists (screenshots managed by window-capture-daemon.sh)
// Screenshots are named {stableId}.jpg, with {address}.jpg as a legacy fallback.
function captureWindowPreview(window: WindowInfo): string | null {
  const idCandidates: string[] = [];

  if (window.stableId && window.stableId !== "") {
    idCandidates.push(window.stableId);
  }

  if (window.address) {
    idCandidates.push(window.address.replace(/^0x/, ""));
  }

  for (const id of idCandidates) {
    const previewPath = `${PREVIEW_CACHE_DIR}/${id}.jpg`;
    try {
      const file = Gio.File.new_for_path(previewPath);
      if (file.query_exists(null)) {
        return previewPath;
      }
    } catch (e) {
      console.error(`Failed to find preview for ${id}:`, e);
    }
  }

  return null;
}

/**
 * Truncate title to fit within available width
 * Font: 13px at 500 weight (medium)
 * Average character width: ~6px for proportional fonts
 */
function truncateTitle(title: string, availableWidth: number): string {
  const AVG_CHAR_WIDTH = 6; // Less conservative for better fit
  const ELLIPSIS_WIDTH = 12; // Actual width of "…" 
  
  const maxChars = Math.floor((availableWidth - ELLIPSIS_WIDTH) / AVG_CHAR_WIDTH);
  
  if (maxChars <= 0) {
    return "…";
  }
  
  if (title.length <= maxChars) {
    return title;
  }
  
  // Truncate and add ellipsis
  return title.substring(0, maxChars) + "…";
}

// Get preview dimensions and cached texture directly from image file
// Uses PREVIEW_HEIGHT as the target, constrains width to PREVIEW_MAX_WIDTH
function getPreviewInfo(imagePath: string | null): PreviewCacheEntry {
  const mark = perf.start("window-switcher", "getPreviewInfo");
  if (!imagePath) {
    const result = {
      mtime: 0,
      width: PREVIEW_MIN_WIDTH,
      height: PREVIEW_HEIGHT,
    };
    mark.end(true);
    return result;
  }

  try {
    const file = Gio.File.new_for_path(imagePath);
    const fileInfo = file.query_info(
      "time::modified,time::modified-usec",
      Gio.FileQueryInfoFlags.NONE,
      null,
    );
    const mtime = previewMtime(fileInfo);

    const cached = previewCache.get(imagePath);
    if (cached && cached.mtime === mtime) {
      mark.end(true);
      return cached;
    }

    const [success, contents] = file.load_contents(null);
    if (!success || !contents) {
      const result = { mtime, width: PREVIEW_MIN_WIDTH, height: PREVIEW_HEIGHT };
      mark.end(true);
      return result;
    }

    const stream = Gio.MemoryInputStream.new_from_bytes(new GLib.Bytes(contents));
    const pixbuf = GdkPixbuf.Pixbuf.new_from_stream(stream, null);
    if (!pixbuf) {
      const result = { mtime, width: PREVIEW_MIN_WIDTH, height: PREVIEW_HEIGHT };
      mark.end(true);
      return result;
    }

    const imageWidth = pixbuf.get_width();
    const imageHeight = pixbuf.get_height();
    const aspectRatio = imageWidth / imageHeight;

    let height = PREVIEW_HEIGHT;
    let width = Math.round(height * aspectRatio);
    if (width > PREVIEW_MAX_WIDTH) {
      width = PREVIEW_MAX_WIDTH;
      height = Math.round(width / aspectRatio);
    }
    width = Math.max(PREVIEW_MIN_WIDTH, width);

    const scaledPixbuf = pixbuf.scale_simple(
      width,
      height,
      GdkPixbuf.InterpType.BILINEAR,
    );
    const texture = scaledPixbuf ? Gdk.Texture.new_for_pixbuf(scaledPixbuf) : undefined;

    const entry: PreviewCacheEntry = { mtime, width, height, texture };
    previewCache.set(imagePath, entry);
    if (previewCache.size > 100) {
      previewCache.clear();
    }

    mark.end(true);
    return entry;
  } catch (e) {
    console.error("Failed to get preview info:", e);
    const result = { mtime: 0, width: PREVIEW_MIN_WIDTH, height: PREVIEW_HEIGHT };
    mark.end(false, String(e));
    return result;
  }
}

function calculatePreviewDimensions(imagePath: string | null): {
  width: number;
  height: number;
} {
  const info = getPreviewInfo(imagePath);
  return { width: info.width, height: info.height };
}

// Get windows from hyprctl
async function getWindows(): Promise<WindowInfo[]> {
  const nowMs = GLib.get_monotonic_time() / 1000;
  if (windowCache) {
    const fresh = nowMs - windowCache.timestampMs < WINDOW_CACHE_TTL_MS;
    const sameSortMode = windowCache.sortMode === sortMode;
    const sameFocusVersion =
      sortMode !== SortMode.RECENCY || windowCache.focusVersion === focusHistoryVersion;
    if (fresh && sameSortMode && sameFocusVersion) {
      return windowCache.windows;
    }
  }
  try {
    const clients = queryHyprlandJson<HyprlandClient[]>("j/clients", {
      component: "window-switcher",
      metric: "hyprSocketClients",
    }) ?? JSON.parse(await execAsync("hyprctl clients -j")) as HyprlandClient[];
    const focusedClient = clients.find((client) => client.focused);
    if (focusedClient?.address) {
      activeWindowCache = { timestampMs: nowMs, address: focusedClient.address };
    }

    // Keep minimized windows visible in switcher, but exclude other special workspaces
    const filteredClients = clients
      .filter((c) => {
        const workspaceName = c.workspace.name || "";
        if (workspaceName === "special:minimized") {
          return true;
        }

        return workspaceName.startsWith("special:") === false;
      })
      .map((c) => ({
        address: c.address,
        stableId: c.stableId,
        class: c.class || "",
        initialClass: c.initialClass || undefined,
        title: c.title || "",
        initialTitle: c.initialTitle || undefined,
        workspace: c.workspace.name || c.workspace.id.toString(),
        size: c.size
          ? { width: c.size[0], height: c.size[1] }
          : undefined,
        position: c.at
          ? { x: c.at[0], y: c.at[1] }
          : undefined,
      }));

    // Sort based on current sort mode
    let result: WindowInfo[];
    if (sortMode === SortMode.RECENCY) {
      // Get focus history for recency-based sorting
      const focusHistory = getWindowFocusHistory();
      
      result = filteredClients.sort((a, b) => {
        const indexA = focusHistory.indexOf(a.address);
        const indexB = focusHistory.indexOf(b.address);
        
        // Windows in history come first, sorted by recency (lower index = more recent)
        // Windows not in history come last, sorted alphabetically
        if (indexA !== -1 && indexB !== -1) {
          return indexA - indexB; // Most recent first
        } else if (indexA !== -1) {
          return -1; // a is in history, b is not
        } else if (indexB !== -1) {
          return 1; // b is in history, a is not
        } else {
          // Neither in history, sort alphabetically as fallback
          if (a.class !== b.class) return a.class.localeCompare(b.class);
          if (a.title !== b.title) return a.title.localeCompare(b.title);
          return a.address.localeCompare(b.address);
        }
      });
    } else {
      // ALPHABETICAL mode - original behavior
      result = filteredClients.sort((a, b) => {
        if (a.class !== b.class) return a.class.localeCompare(b.class);
        if (a.title !== b.title) return a.title.localeCompare(b.title);
        return a.address.localeCompare(b.address);
      });
    }
    windowCache = {
      timestampMs: nowMs,
      windows: result,
      sortMode,
      focusVersion: focusHistoryVersion,
    };
    return result;
  } catch (e) {
    console.error("Error getting windows from hyprctl:", e);
    return [];
  }
}

// Get window focus history from Hyprland event logs
// Returns array of window addresses sorted by recency (most recent first)
function getWindowFocusHistory(): string[] {
  return focusHistory;
}

// Update focus history when a window is focused
// Most recently focused window goes to index 0
function updateFocusHistory(address: string) {
  if (!address) return;
  
  // Remove address if it exists (to avoid duplicates)
  const index = focusHistory.indexOf(address);
  if (index !== -1) {
    focusHistory.splice(index, 1);
  }
  
  // Add to front (most recent)
  focusHistory.unshift(address);
  
  // Limit history size to 50 windows
  if (focusHistory.length > 50) {
    focusHistory = focusHistory.slice(0, 50);
  }

  focusHistoryVersion += 1;
  
  debugLog(`Focus history updated: [${focusHistory.slice(0, 5).join(", ")}...]`);
}

// Get currently active window address
async function getActiveWindowAddress(): Promise<string | null> {
  const nowMs = GLib.get_monotonic_time() / 1000;
  if (activeWindowCache) {
    const fresh = nowMs - activeWindowCache.timestampMs < ACTIVE_WINDOW_CACHE_TTL_MS;
    if (fresh) {
      return activeWindowCache.address;
    }
  }
  try {
    const activeWindow = queryHyprlandJson<{ address?: string }>("j/activewindow", {
      component: "window-switcher",
      metric: "hyprSocketActiveWindow",
    }) ?? JSON.parse(await execAsync("hyprctl activewindow -j"));
    const address = activeWindow.address || null;
    activeWindowCache = { timestampMs: nowMs, address };
    return address;
  } catch (e) {
    console.error("Error getting active window:", e);
    return null;
  }
}

function focusAndWarpWindow(address: string): void {
  const home = GLib.getenv("HOME");
  const script = home ? `lua ${home}/.config/hypr/runtime/windows/warp-cursor-to-active-window.lua` : WARP_CURSOR_TO_ACTIVE_WINDOW_SCRIPT;
  GLib.spawn_command_line_async(`${script} --window ${GLib.shell_quote(address)}`);
}

function focusWindow(address: string): void {
  focusAndWarpWindow(address);
}

function focusAndCenterWindow(window: WindowInfo): void {
  focusAndWarpWindow(window.address);
}

function restoreMinimizedAndFocus(address: string): void {
  const home = GLib.getenv("HOME");
  const script = home ? `${home}/.config/hypr/runtime/windows/toggle-minimized-workspace.sh` : TOGGLE_MINIMIZED_WORKSPACE_SCRIPT;
  GLib.spawn_command_line_sync(`${script} ${GLib.shell_quote(address)}`);
  focusWindow(address);
}

// Create an app icon button
function createAppButton(
  window: WindowInfo,
  isSelected: boolean,
  index: number,
): Gtk.Button {
  const mark = perf.start("window-switcher", "createAppButton");
  let ok = true;
  let error: string | undefined;
  try {
    const icon = getIconForWindow(window, iconTheme);
    const fallbackLetter = getFallbackLetter(window);

    debugLog(`Creating button for ${window.class} in ${displayMode} mode`);

    // Determine content based on display mode
    let content: JSX.Element;

    if (displayMode === DisplayMode.PREVIEWS) {
      // Preview mode: show aspect-ratio box with header
      const previewPath = captureWindowPreview(window);
      const previewInfo = getPreviewInfo(previewPath);
      const dimensions = { width: previewInfo.width, height: previewInfo.height };

      content = (
        <box
          orientation={Gtk.Orientation.VERTICAL}
          spacing={0}
          halign={Gtk.Align.CENTER}
          valign={Gtk.Align.CENTER}
          class="preview-wrapper"
        >
          {/* Preview container with header and body */}
          <box
            orientation={Gtk.Orientation.VERTICAL}
            spacing={0}
            class="window-preview"
            css={`
              max-width: ${dimensions.width}px;
            `}
          >
            {/* Header with icon and title */}
            <box
              orientation={Gtk.Orientation.HORIZONTAL}
              spacing={8}
              class="preview-header"
              halign={Gtk.Align.FILL}
              widthRequest={dimensions.width}
            >
              {/* App icon */}
              {icon ? (
                icon.kind === "theme" ? (
                  <image
                    iconName={icon.name}
                    pixelSize={20}
                    class="preview-header-icon"
                  />
                ) : (
                  <image
                    pixelSize={20}
                    class="preview-header-icon"
                    $={(self: Gtk.Image) => setImageFile(self, icon.path)}
                  />
                )
              ) : (
                <box class="preview-header-icon-fallback">
                  <label
                    label={fallbackLetter}
                    class="preview-header-letter"
                  />
                </box>
              )}

              {/* App title - truncated to fit available width */}
              <label
                label={truncateTitle(window.title, dimensions.width - 28 - 24)}
                xalign={0}
                class="preview-header-title"
                wrap={false}
              />
            </box>

            {/* Preview body with screenshot or gradient fallback */}
            <box
              class="preview-body"
              halign={Gtk.Align.CENTER}
              valign={Gtk.Align.CENTER}
              css={`
                min-width: ${dimensions.width}px;
                min-height: ${dimensions.height}px;
                max-width: ${dimensions.width}px;
                max-height: ${dimensions.height}px;
              `}
              $={(self: Gtk.Box) => {
                if (!previewPath) return;
                try {
                  const info = getPreviewInfo(previewPath);
                  if (info.texture) {
                    const picture = Gtk.Picture.new_for_paintable(info.texture);
                    picture.set_halign(Gtk.Align.FILL);
                    picture.set_valign(Gtk.Align.FILL);
                    picture.set_can_shrink(false);
                    picture.set_content_fit(Gtk.ContentFit.FILL);
                    picture.add_css_class("preview-image");
                    self.append(picture);
                  }
                } catch (e) {
                  console.error("Failed to load preview image:", e);
                }
              }}
            />
          </box>
        </box>
      );
    } else {
      // Icon mode: original behavior
      content = (
        <box
          orientation={Gtk.Orientation.VERTICAL}
          spacing={0}
          halign={Gtk.Align.CENTER}
          valign={Gtk.Align.CENTER}
        >
          {/* Icon container with fixed size */}
          <box
            orientation={Gtk.Orientation.HORIZONTAL}
            halign={Gtk.Align.CENTER}
            valign={Gtk.Align.CENTER}
            class={`icon-container ${icon ? "" : "letter-icon"}`}
          >
            {icon ? (
              icon.kind === "theme" ? (
                <image
                  iconName={icon.name}
                  pixelSize={ICON_SIZE}
                  class="app-icon-image"
                />
              ) : (
                <image
                  pixelSize={ICON_SIZE}
                  class="app-icon-image"
                  $={(self: Gtk.Image) => setImageFile(self, icon.path)}
                />
              )
            ) : (
              <box class="app-icon-wrapper">
                <label
                  label={fallbackLetter}
                  halign={Gtk.Align.CENTER}
                  valign={Gtk.Align.CENTER}
                  class="app-icon-letter"
                />
              </box>
            )}
          </box>
        </box>
      );
    }

    const button = (
      <button
        canFocus={false}
        class={`app-button ${isSelected ? "selected" : ""}`}
        onClicked={() => {
          currentIndex = index;
          commitSwitch();
        }}
      >
        {content}
      </button>
    ) as Gtk.Button;

    return button;
  } catch (e) {
    ok = false;
    error = String(e);
    throw e;
  } finally {
    mark.end(ok, error);
  }
}

// Previous window list to detect changes
let previousWindowAddresses: string[] = [];
let previousDisplayMode: DisplayMode = displayMode;
let previousPreviewMtimes: Map<string, number> = new Map();

function getPreviewMtime(previewPath: string | null): number | null {
  if (!previewPath) return null;
  try {
    const file = Gio.File.new_for_path(previewPath);
    const fileInfo = file.query_info(
      "time::modified,time::modified-usec",
      Gio.FileQueryInfoFlags.NONE,
      null,
    );
    return previewMtime(fileInfo);
  } catch (e) {
    console.error("Failed to read preview mtime:", e);
    return null;
  }
}

// Update the switcher display with new data
function updateSwitcher() {
  if (!containerBox || !selectedNameLabel) return;
  const mark = perf.start("window-switcher", "updateSwitcher");
  let ok = true;
  let error: string | undefined;

  try {
    // Check if window list has changed
    const currentAddresses = currentWindows.map((w) => w.address);
    const windowListChanged =
      previousWindowAddresses.length !== currentAddresses.length ||
      previousWindowAddresses.some((addr, idx) => addr !== currentAddresses[idx]);

    // Check if display mode has changed
    const modeChanged = previousDisplayMode !== displayMode;

    let previewChanged = false;
    let currentPreviewMtimes: Map<string, number> | null = null;
    if (displayMode === DisplayMode.PREVIEWS && !windowListChanged && !modeChanged) {
      currentPreviewMtimes = new Map();
      for (const window of currentWindows) {
        const previewPath = captureWindowPreview(window);
        const mtime = getPreviewMtime(previewPath);
        if (mtime !== null) {
          currentPreviewMtimes.set(window.address, mtime);
          const previous = previousPreviewMtimes.get(window.address);
          if (previous === undefined || previous !== mtime) {
            previewChanged = true;
            break;
          }
        }
      }
    }

    // In preview mode, rebuild only when previews changed, mode changed, or window list changed
    const shouldRebuild = windowListChanged || modeChanged || previewChanged;

    if (shouldRebuild) {
      // Clear existing UI
      let child = containerBox.get_first_child();
      while (child) {
        containerBox.remove(child);
        child = containerBox.get_first_child();
      }
      windowButtons.clear();

      // Calculate available width for buttons
      const monitorWidth = getMonitorWidth();
      // Use 75% of monitor width - conservative limit to prevent overflow
      // GTK adds significant overhead (borders, focus rings, spacing) that's hard to calculate precisely
      const maxWidth = Math.floor(monitorWidth * 0.75);
      
      // Calculate button widths
      const buttonWidths = currentWindows.map(w => calculateButtonWidth(w));
      
      // Write debug info to file for inspection
      const debugInfo = `[Window Switcher Debug - ${new Date().toISOString()}]
Monitor: ${monitorWidth}px
Max width (75% of monitor): ${maxWidth}px
Button widths: [${buttonWidths.join(', ')}]
Total width needed: ${buttonWidths.reduce((sum, w) => sum + w, 0) + (currentWindows.length - 1) * BUTTON_SPACING}px
Will wrap: ${(buttonWidths.reduce((sum, w) => sum + w, 0) + (currentWindows.length - 1) * BUTTON_SPACING) > maxWidth}
`;
      debugWriteFile(WINDOW_SWITCHER_DEBUG_PATH, debugInfo);
      
      debugLog(`[Window Switcher] Button widths: [${buttonWidths.join(', ')}]`);
      
      const totalWidth = buttonWidths.reduce((sum, w) => sum + w, 0) + 
                        (currentWindows.length - 1) * BUTTON_SPACING;
      
      debugLog(`[Window Switcher] Monitor: ${monitorWidth}px, Available (75%): ${maxWidth}px, Total needed: ${totalWidth}px, Will wrap: ${totalWidth > maxWidth}`);
      
      // Determine if we need to wrap
      if (totalWidth > maxWidth) {
        // Multi-row layout
        debugLog("Using multi-row layout");
        
        // Create rows and distribute windows
        const rows: WindowInfo[][] = [];
        let currentRow: WindowInfo[] = [];
        let currentRowWidth = 0;
        
        currentWindows.forEach((window, idx) => {
          const buttonWidth = buttonWidths[idx];
          const widthWithSpacing = currentRowWidth > 0 ? buttonWidth + BUTTON_SPACING : buttonWidth;
          
          debugLog(`[Window Switcher] Window ${idx} (${window.class}): width=${buttonWidth}px, currentRowWidth=${currentRowWidth}px, will add=${widthWithSpacing}px, fits=${currentRowWidth + widthWithSpacing <= maxWidth}`);
          
          if (currentRowWidth + widthWithSpacing <= maxWidth) {
            // Fits in current row
            currentRow.push(window);
            currentRowWidth += widthWithSpacing;
          } else {
            // Start new row
            if (currentRow.length > 0) {
              debugLog(`[Window Switcher] Row ${rows.length} complete with ${currentRow.length} windows, total width: ${currentRowWidth}px`);
              rows.push(currentRow);
            }
            currentRow = [window];
            currentRowWidth = buttonWidth;
          }
        });
        
        // Add last row
        if (currentRow.length > 0) {
          debugLog(`[Window Switcher] Row ${rows.length} (final) complete with ${currentRow.length} windows, total width: ${currentRowWidth}px`);
          rows.push(currentRow);
        }
        
        debugLog(`[Window Switcher] Created ${rows.length} rows, max allowed width per row: ${maxWidth}px`);
        
        // Build rows
        rows.forEach(rowWindows => {
          const rowBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: BUTTON_SPACING,
            halign: Gtk.Align.CENTER,
          });
          rowBox.add_css_class("apps-row");
          
          rowWindows.forEach(window => {
            const windowIndex = currentWindows.indexOf(window);
            const isSelected = windowIndex === currentIndex;
            const button = createAppButton(window, isSelected, windowIndex);
            rowBox.append(button);
            windowButtons.set(window.address, button);
          });
          
          containerBox!.append(rowBox);
        });
      } else {
        // Single-row layout (original behavior)
        debugLog("Using single-row layout");
        
        const rowBox = new Gtk.Box({
          orientation: Gtk.Orientation.HORIZONTAL,
          spacing: BUTTON_SPACING,
          halign: Gtk.Align.CENTER,
        });
        rowBox.add_css_class("apps-row");
        
        currentWindows.forEach((window, index) => {
          const isSelected = index === currentIndex;
          const button = createAppButton(window, isSelected, index);
          rowBox.append(button);
          windowButtons.set(window.address, button);
        });
        
        containerBox!.append(rowBox);
      }

      previousWindowAddresses = currentAddresses;
      previousDisplayMode = displayMode;
      if (displayMode === DisplayMode.PREVIEWS) {
        if (!currentPreviewMtimes) {
          currentPreviewMtimes = new Map();
          for (const window of currentWindows) {
            const previewPath = captureWindowPreview(window);
            const mtime = getPreviewMtime(previewPath);
            if (mtime !== null) {
              currentPreviewMtimes.set(window.address, mtime);
            }
          }
        }
        previousPreviewMtimes = currentPreviewMtimes;
      } else {
        previousPreviewMtimes = new Map();
      }
    } else {
      // Just update selection classes (only in icon mode when window list unchanged)
      currentWindows.forEach((window, index) => {
        const button = windowButtons.get(window.address);
        if (!button) return;

        const isSelected = index === currentIndex;
        const classes = button.get_css_classes();
        const hasSelected = classes.includes("selected");

        if (isSelected && !hasSelected) {
          button.add_css_class("selected");
        } else if (!isSelected && hasSelected) {
          button.remove_css_class("selected");
        }
      });
    }

    // Update selected app name
    const selectedWindow = currentWindows[currentIndex];
    if (selectedWindow) {
      selectedNameLabel.set_label(selectedWindow.title);
    }
  } catch (e) {
    ok = false;
    error = String(e);
    throw e;
  } finally {
    mark.end(ok, error);
  }
}

// ============================================================================
// State Machine Transitions
// ============================================================================

function modifierMaskFor(name: string): Gdk.ModifierType {
  const normalized = name.toUpperCase();
  if (normalized === "SUPER") return Gdk.ModifierType.SUPER_MASK;
  if (normalized === "ALT") return Gdk.ModifierType.ALT_MASK;
  if (normalized === "CTRL" || normalized === "CONTROL") return Gdk.ModifierType.CONTROL_MASK;
  if (normalized === "SHIFT") return Gdk.ModifierType.SHIFT_MASK;

  return Gdk.ModifierType.ALT_MASK;
}

function isModifierPressed(name: string): boolean {
  const display = Gdk.Display.get_default();
  if (!display) return false;

  const seat = display.get_default_seat();
  if (!seat) return false;

  const device = seat.get_keyboard();
  if (!device) return false;

  const modifiers = device.get_modifier_state();
  return (modifiers & modifierMaskFor(name)) !== 0;
}

function isTriggerModifierKey(keyval: number): boolean {
  const normalized = activeTriggerModifier.toUpperCase();
  if (normalized === "SUPER") return keyval === 65515 || keyval === 65516;
  if (normalized === "ALT") return keyval === 65513 || keyval === 65514;
  if (normalized === "CTRL" || normalized === "CONTROL") return keyval === 65507 || keyval === 65508;
  if (normalized === "SHIFT") return keyval === 65505 || keyval === 65506;

  return keyval === 65513 || keyval === 65514;
}

function stopTriggerModifierWatch() {
  if (triggerModifierWatchId === null) return;

  GLib.source_remove(triggerModifierWatchId);
  triggerModifierWatchId = null;
}

function startTriggerModifierWatch() {
  stopTriggerModifierWatch();
  triggerModifierWatchId = GLib.timeout_add(GLib.PRIORITY_HIGH, 25, () => {
    if (state !== SwitcherState.ACTIVE) {
      triggerModifierWatchId = null;
      return GLib.SOURCE_REMOVE;
    }

    if (!isModifierPressed(activeTriggerModifier)) {
      debugLog(`${activeTriggerModifier} released, committing switch`);
      triggerModifierWatchId = null;
      onCommit();
      return GLib.SOURCE_REMOVE;
    }

    return GLib.SOURCE_CONTINUE;
  });
}

// Transition to ACTIVE state
function enterActiveState(windows: WindowInfo[], index: number, triggerModifier = "ALT") {
  debugLog(
    `[State] IDLE -> ACTIVE (${windows.length} windows, index ${index})`,
  );
  state = SwitcherState.ACTIVE;
  currentWindows = windows;
  currentIndex = index;
  isVisible = true;
  activeTriggerModifier = triggerModifier;

  if (win) {
    applyStaticCSS();
    updateSwitcher();
    win.set_keymode(Astal.Keymode.EXCLUSIVE);
    win.set_visible(true);
    startTriggerModifierWatch();
  }
}

// Transition to IDLE state
function enterIdleState() {
  debugLog(`[State] ${state} -> IDLE`);
  stopTriggerModifierWatch();
  state = SwitcherState.IDLE;
  isVisible = false;

  if (win) {
    win.set_visible(false);
    win.set_keymode(Astal.Keymode.NONE);
  }
}

// ============================================================================
// Event Handlers
// ============================================================================

// Handle next window event
async function onNext(triggerModifier = "ALT") {
  if (state === SwitcherState.IDLE) {
    // Fetch windows and initialize
    const windows = await getWindows();

    if (windows.length === 0) return;
    if (windows.length === 1) return;

    // Update focus history with currently active window before switching
    const activeAddress = await getActiveWindowAddress();
    if (activeAddress) {
      updateFocusHistory(activeAddress);
    }

    let index: number;
    
    if (sortMode === SortMode.RECENCY) {
      // In recency mode, start at index 1 (second most recent window)
      // This gives Windows-like Alt+Tab behavior
      index = 1;
    } else {
      // In alphabetical mode, find current window and cycle to next
      index = windows.findIndex((w) => w.address === activeAddress);
      
      // If current window not found, start from first
      if (index === -1) {
        index = 0;
      }
      
      // Cycle to next
      index = (index + 1) % windows.length;
    }

    enterActiveState(windows, index, triggerModifier);
  } else if (state === SwitcherState.ACTIVE) {
    // Cycle within current session
    if (currentWindows.length === 0) return;
    if (currentWindows.length === 1) return;

    currentIndex = (currentIndex + 1) % currentWindows.length;
    updateSwitcher();
  }
}

// Handle previous window event
async function onPrev(triggerModifier = "ALT") {
  if (state === SwitcherState.IDLE) {
    // Fetch windows and initialize
    const windows = await getWindows();

    if (windows.length === 0) return;
    if (windows.length === 1) return;

    // Update focus history with currently active window before switching
    const activeAddress = await getActiveWindowAddress();
    if (activeAddress) {
      updateFocusHistory(activeAddress);
    }

    let index: number;
    
    if (sortMode === SortMode.RECENCY) {
      // In recency mode, Shift+Tab should go to second most recent (same as Tab)
      // This matches Windows behavior where first Shift+Tab goes to same place as Tab
      index = 1;
    } else {
      // In alphabetical mode, find current window and cycle to previous
      index = windows.findIndex((w) => w.address === activeAddress);
      
      // If current window not found, start from last
      if (index === -1) {
        index = windows.length - 1;
      }
      
      // Cycle to previous
      index = (index - 1 + windows.length) % windows.length;
    }

    enterActiveState(windows, index, triggerModifier);
  } else if (state === SwitcherState.ACTIVE) {
    // Cycle within current session
    if (currentWindows.length === 0) return;
    if (currentWindows.length === 1) return;

    currentIndex =
      (currentIndex - 1 + currentWindows.length) % currentWindows.length;
    updateSwitcher();
  }
}

// Handle commit and hide
function onCommit() {
  if (state !== SwitcherState.ACTIVE) {
    enterIdleState();
    return;
  }

  if (currentWindows.length === 0) {
    enterIdleState();
    return;
  }

  const targetWindow = currentWindows[currentIndex];
  if (!targetWindow) {
    enterIdleState();
    return;
  }

  try {
    if (targetWindow.workspace === "special:minimized") {
      restoreMinimizedAndFocus(targetWindow.address);
    } else {
      focusAndCenterWindow(targetWindow);
    }
    
    // Update focus history when committing a switch
    updateFocusHistory(targetWindow.address);
  } catch (e) {
    console.error("Error focusing window:", e);
  }

  enterIdleState();
}

// Handle hide without commit
function onHide() {
  enterIdleState();
}

function onTriggerModifierRelease() {
  if (state !== SwitcherState.ACTIVE) return;
  debugLog(`${activeTriggerModifier} key released, committing switch`);
  onCommit();
}

// ============================================================================
// Legacy function wrappers (for compatibility during transition)
// ============================================================================

function commitSwitch() {
  onCommit();
}

function setupTriggerModifierMonitoring() {
  if (!win) return;

  // Create a key event controller
  const controller = new Gtk.EventControllerKey();

  // Listen for key release events
  controller.connect(
    "key-released",
    (
      _ctrl: Gtk.EventControllerKey,
      keyval: number,
      _keycode: number,
      _state: Gdk.ModifierType,
    ) => {
      if (isTriggerModifierKey(keyval)) {
        onTriggerModifierRelease();
      }
      
      // Handle Print key for screenshots (Print = 0xff61 = 65377)
      if (keyval === 65377) {
        try {
          GLib.spawn_command_line_async("bash ~/.config/hypr/runtime/capture/screenshot.sh screen");
          debugLog("Screenshot triggered from window-switcher");
        } catch (e) {
          console.error("Failed to trigger screenshot:", e);
        }
      }
    },
  );

  win.add_controller(controller);
}

// Create the switcher window
function createWindow() {
  // Initialize icon theme
  const display = Gdk.Display.get_default();
  if (display) {
    iconTheme = Gtk.IconTheme.get_for_display(display);
  }

  win = (
    <window
      name="window-switcher"
      namespace="ags-window-switcher"
      visible={false}
      anchor={
        Astal.WindowAnchor.TOP |
        Astal.WindowAnchor.BOTTOM |
        Astal.WindowAnchor.LEFT |
        Astal.WindowAnchor.RIGHT
      }
      layer={Astal.Layer.OVERLAY}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.NONE}
      application={app}
      class="window-switcher"
    >
      <box
        orientation={Gtk.Orientation.VERTICAL}
        halign={Gtk.Align.CENTER}
        valign={Gtk.Align.CENTER}
      >
        <box
          orientation={Gtk.Orientation.VERTICAL}
          spacing={12}
          class="switcher-container"
        >
          {/* Apps container - can have multiple rows */}
          <box
            orientation={Gtk.Orientation.VERTICAL}
            spacing={8}
            halign={Gtk.Align.CENTER}
            class="apps-container"
            $={(self: Gtk.Box) => {
              containerBox = self;
            }}
          />

          {/* Selected app name */}
          <label
            label=""
            halign={Gtk.Align.CENTER}
            class="app-name"
            ellipsize={3}
            maxWidthChars={50}
            $={(self: Gtk.Label) => {
              selectedNameLabel = self;
            }}
          />
        </box>
      </box>
    </window>
  ) as Astal.Window;

  setupTriggerModifierMonitoring();
}

// Apply static CSS
function applyStaticCSS() {
const transparencyDisabled = isGamingProfileActive();

  const switcherBackground = transparencyDisabled
    ? "rgb(25, 25, 25)"
    : "rgba(25, 25, 25, 0.5)";
  const switcherBorder = transparencyDisabled
    ? "1px solid rgb(52, 52, 52)"
    : "1px solid rgba(255, 255, 255, 0.12)";
  const switcherBackdrop = transparencyDisabled ? "none" : "blur(20px)";
  const previewBackground = transparencyDisabled
    ? "rgb(30, 30, 30)"
    : "rgba(30, 30, 30, 0.95)";
  const previewHeaderBackground = transparencyDisabled
    ? "rgb(40, 40, 40)"
    : "rgba(40, 40, 40, 0.95)";
  const previewBodyBackground = transparencyDisabled
    ? "rgb(25, 25, 25)"
    : "linear-gradient(135deg, rgba(40, 40, 40, 0.9) 0%, rgba(25, 25, 25, 0.9) 100%)";

  app.apply_css(
    `
  window.window-switcher {
    background-color: transparent;
    border: none;
  }
  
  window.window-switcher box.switcher-container {
    background-color: ${switcherBackground};
    backdrop-filter: ${switcherBackdrop};
    -webkit-backdrop-filter: ${switcherBackdrop};
    border: ${switcherBorder};
    border-radius: 18px;
    padding: 24px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2),
                0 0 0 1px rgba(255, 255, 255, 0.05) inset;
  }
  
  window.window-switcher box.apps-container {
    /* Container for potentially multiple rows */
  }
  
  window.window-switcher box.apps-row {
    min-height: ${ICON_SIZE + 16}px;
  }
  
  window.window-switcher button.app-button {
    padding: 8px;
    border-radius: 12px;
    border: 2px solid transparent;
    background-color: transparent;
    transition: all 150ms ease;
  }
  
  window.window-switcher button.app-button:hover {
    background-color: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.2);
  }
  
  window.window-switcher button.app-button.selected {
    background-color: rgba(55, 55, 55, 0.7);
    border-color: ${tokens.colors.accent.active.value};
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2),
                0 0 0 1px ${tokens.colors.accent.active.value}33 inset;
  }
  
  window.window-switcher button.app-button.selected:hover {
    background-color: rgba(65, 65, 65, 0.8);
    border-color: ${tokens.colors.accent.active.value};
  }
  
  window.window-switcher box.icon-container {
    min-width: ${ICON_SIZE}px;
    min-height: ${ICON_SIZE}px;
    border-radius: 12px;
  }
  
  window.window-switcher box.icon-container.letter-icon {
    background-color: ${tokens.colors.accent.primary.value};
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }
  
  window.window-switcher image.app-icon-image {
    min-width: ${ICON_SIZE}px;
    min-height: ${ICON_SIZE}px;
  }
  
  window.window-switcher label.app-icon-letter {
    font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
    font-weight: 600;
    font-size: 28px;
    color: ${tokens.colors.foreground.primary.value};
    min-width: ${ICON_SIZE}px;
    min-height: ${ICON_SIZE}px;
  }
  
  window.window-switcher label.app-name {
    font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
    font-size: 14px;
    color: ${tokens.colors.foreground.primary.value};
    max-width: 600px;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  }
  
  /* Preview mode styles */
  window.window-switcher box.window-preview {
    background-color: ${previewBackground};
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3),
                0 0 0 1px rgba(255, 255, 255, 0.05) inset;
  }
  
  window.window-switcher box.preview-header {
    background-color: ${previewHeaderBackground};
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px 8px 0 0;
    padding: 8px 12px;
    box-sizing: border-box;
  }
  
  window.window-switcher image.preview-header-icon {
    min-width: 20px;
    min-height: 20px;
  }
  
  window.window-switcher box.preview-header-icon-fallback {
    min-width: 20px;
    min-height: 20px;
    border-radius: 4px;
    background-color: ${tokens.colors.accent.primary.value};
  }
  
  window.window-switcher label.preview-header-letter {
    font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
    font-weight: 600;
    font-size: 12px;
    color: ${tokens.colors.foreground.primary.value};
  }
  
  window.window-switcher label.preview-header-title {
    font-family: "${tokens.typography.fontFamily.primary.value}", system-ui, sans-serif;
    font-size: 13px;
    font-weight: 500;
    color: ${tokens.colors.foreground.primary.value};
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  window.window-switcher box.preview-body {
    background: ${previewBodyBackground};
    overflow: hidden;
  }
  
  window.window-switcher picture.preview-image {
    min-width: 100%;
    min-height: 100%;
    border-radius: 0 0 8px 8px;
  }
    `,
    false,
  );
}

// Helper functions for request handler
async function handleShowAction() {
  ensurePreviewCacheMonitor();
  // Window is pre-created at init for Alt monitoring
  const windows = await getWindows();
  if (windows.length <= 1) {
    return;
  }

  const activeAddress = await getActiveWindowAddress();
  let index = windows.findIndex((w) => w.address === activeAddress);
  index = index === -1 ? 0 : index;

  enterActiveState(windows, index);
}

function handleSetMode(mode: string | undefined): string {
  const normalizedMode = mode?.toUpperCase();

  if (normalizedMode !== "ICONS" && normalizedMode !== "PREVIEWS") {
    return "invalid mode, use 'icons' or 'previews'";
  }

  displayMode =
    normalizedMode === "ICONS" ? DisplayMode.ICONS : DisplayMode.PREVIEWS;
  rebuildUIIfActive();

  return `mode set to ${normalizedMode}`;
}

function handleToggleMode() {
  displayMode =
    displayMode === DisplayMode.ICONS
      ? DisplayMode.PREVIEWS
      : DisplayMode.ICONS;
  rebuildUIIfActive();
}

async function handleSetSortMode(mode: string | undefined): Promise<string> {
  const normalizedMode = mode?.toUpperCase();

  if (normalizedMode !== "ALPHABETICAL" && normalizedMode !== "RECENCY") {
    return "invalid sort mode, use 'alphabetical' or 'recency'";
  }

  sortMode =
    normalizedMode === "ALPHABETICAL" ? SortMode.ALPHABETICAL : SortMode.RECENCY;
  
  // If active, refresh window list with new sort order
  if (state === SwitcherState.ACTIVE) {
    const windows = await getWindows();
    currentWindows = windows;
    currentIndex = 0; // Reset to first window with new sort
    previousWindowAddresses = [];
    windowButtons.clear();
    updateSwitcher();
  }

  return `sort mode set to ${normalizedMode}`;
}

function rebuildUIIfActive() {
  if (state === SwitcherState.ACTIVE) {
    // Force rebuild by clearing previous addresses
    previousWindowAddresses = [];
    windowButtons.clear();
    updateSwitcher();
  }
}

// Functions for bundled mode (using global namespace pattern)
function initWindowSwitcher() {
  // Window-switcher needs to be created immediately for Alt monitoring to work
  // This is the only component that can't be lazy-loaded due to its Alt key event handling
  applyStaticCSS();
  createWindow();
}

function handleWindowSwitcherRequest(argv: string[], res: (response: string) => void) {
  const mark = perf.start("window-switcher", "handleRequest");
  let ok = true;
  let error: string | undefined;
  let asyncHandled = false;
  try {
    const request = argv.join(" ");

    if (!request || request.trim() === "") {
      res("ready");
      return;
    }

    const data = JSON.parse(request);
    const action = data.action;

    if (action === "show") {
      asyncHandled = true;
      handleShowAction()
        .then(() => {
          res("shown");
          mark.end(ok, error);
        })
        .catch((e) => {
          ok = false;
          error = String(e);
          res(`error: ${e}`);
          mark.end(ok, error);
        });
      return;
    }

    if (action === "next") {
      asyncHandled = true;
      onNext(data.triggerModifier)
        .then(() => {
          res("cycled next");
          mark.end(ok, error);
        })
        .catch((e) => {
          ok = false;
          error = String(e);
          res(`error: ${e}`);
          mark.end(ok, error);
        });
      return;
    }

    if (action === "prev") {
      asyncHandled = true;
      onPrev(data.triggerModifier)
        .then(() => {
          res("cycled prev");
          mark.end(ok, error);
        })
        .catch((e) => {
          ok = false;
          error = String(e);
          res(`error: ${e}`);
          mark.end(ok, error);
        });
      return;
    }

    if (action === "commit") {
      onCommit();
      res("committed");
      return;
    }

    if (action === "hide") {
      onHide();
      res("hidden");
      return;
    }

    if (action === "set-mode") {
      const response = handleSetMode(data.mode);
      applyStaticCSS();
      res(response);
      return;
    }

    if (action === "toggle-mode") {
      handleToggleMode();
      res(`mode toggled to ${displayMode}`);
      return;
    }

    if (action === "set-sort-mode") {
      asyncHandled = true;
      handleSetSortMode(data.mode)
        .then((response) => {
          res(response);
          mark.end(ok, error);
        })
        .catch((e) => {
          ok = false;
          error = String(e);
          res(`error: ${e}`);
          mark.end(ok, error);
        });
      return;
    }

    if (action === "get-sort-mode") {
      res(`current sort mode: ${sortMode}`);
      return;
    }

    if (action === "get-mode") {
      res(`current mode: ${displayMode}`);
      return;
    }

    if (action === "get-visibility") {
      res(isVisible ? "visible" : "hidden");
      return;
    }

    res("unknown action");
  } catch (e) {
    ok = false;
    error = String(e);
    console.error("Error handling window-switcher request:", e);
    res(`error: ${e}`);
  } finally {
    if (!asyncHandled) {
      mark.end(ok, error);
    }
  }
}

// Make component available globally
globalThis.WindowSwitcher = {
  init: initWindowSwitcher,
  handleRequest: handleWindowSwitcherRequest,
  instanceName: "window-switcher"
};
